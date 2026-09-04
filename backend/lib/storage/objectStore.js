/**
 * Where original invoice PDFs live.
 *
 * The vault currently writes into `data/invoice_vault/` on the local disk. That
 * is correct for development and wrong for any deployment with more than one
 * replica or an ephemeral filesystem: a PDF uploaded to one container is a 404
 * from the next, and a redeploy loses the lot. The originals are the evidence
 * behind every stored invoice, so losing them is not a cache miss.
 *
 * This module puts the vault behind a two-method interface -- `put` and `get`
 * -- with a local-filesystem driver for development and an S3-compatible driver
 * for production. S3-compatible covers AWS S3, MinIO, Cloudflare R2 and most
 * self-hosted gateways, which is why the driver is not named for a vendor.
 *
 * WHAT DOES NOT CHANGE
 * --------------------
 * Objects stay content-addressed: the key is the SHA-256 of the bytes, and the
 * `^[a-f0-9]{64}$` check stays in front of every lookup. That check is what
 * stops a caller steering a read outside the vault, and it matters more with a
 * remote store, not less -- a key is concatenated into a URL path, so an
 * unvalidated one is a request-splitting problem as well as a traversal one.
 *
 * The interface is async because a network call is. The local driver is
 * synchronous underneath and simply resolves.
 */

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");

const { readConfig } = require("../config");
const { dataPath } = require("../dataDir");
const { logger } = require("../logger");

/** The only key shape the vault accepts. Validated before every operation. */
const CONTENT_HASH = /^[a-f0-9]{64}$/;

class InvalidObjectKey extends Error {
  constructor(key) {
    super(`Object key must be a 64-character SHA-256 hex digest (got "${String(key).slice(0, 80)}")`);
    this.name = "InvalidObjectKey";
  }
}

const assertValidKey = (key) => {
  if (!CONTENT_HASH.test(String(key || ""))) throw new InvalidObjectKey(key);
  return String(key);
};

/**
 * Local filesystem driver.
 *
 * Resolves the vault directory per call, for the same reason `dataDir()` does:
 * the test harness points it at a temp directory, and freezing it at import
 * would make that depend on module load order.
 */
function localDriver(config) {
  const vaultDir = () => dataPath("invoice_vault");

  return {
    name: "local",
    describe: () => ({ driver: "local", location: vaultDir() }),

    async put(key, buffer) {
      const hash = assertValidKey(key);
      const dir = vaultDir();
      await fsp.mkdir(dir, { recursive: true });
      const target = path.join(dir, `${hash}.pdf`);

      // Identical content is stored once; the hash guarantees the bytes match.
      if (!fs.existsSync(target)) {
        await fsp.writeFile(target, buffer, { mode: 0o600 });
      }
      return `${hash}.pdf`;
    },

    async get(key) {
      let hash;
      try {
        hash = assertValidKey(key);
      } catch {
        // A malformed key is "not found", not an error the caller must handle:
        // the route turns both into the same 404, and reporting them
        // differently would confirm which hashes exist.
        return null;
      }

      const target = path.join(vaultDir(), `${hash}.pdf`);
      try {
        return await fsp.readFile(target);
      } catch {
        return null;
      }
    },

    async health() {
      const dir = vaultDir();
      try {
        await fsp.mkdir(dir, { recursive: true });
        await fsp.access(dir, fs.constants.R_OK | fs.constants.W_OK);
        return { name: "storage", status: "ok", detail: `local:${dir}` };
      } catch (error) {
        return { name: "storage", status: "error", detail: error.message };
      }
    },

    async close() {},
  };
}

/**
 * S3-compatible driver.
 *
 * `@aws-sdk/client-s3` is required lazily so a local or development deployment
 * that never selects this driver does not need the dependency installed.
 */
function s3Driver(config) {
  const { bucket, region, endpoint, prefix, accessKeyId, secretAccessKey, forcePathStyle } = config.storage;

  let client = null;
  let sdk = null;

  function ensureClient() {
    if (client) return { client, sdk };

    try {
      // eslint-disable-next-line global-require
      sdk = require("@aws-sdk/client-s3");
    } catch {
      throw new Error(
        'STORAGE_DRIVER is "s3" but @aws-sdk/client-s3 is not installed. Run `npm install` in backend/, or set STORAGE_DRIVER=local.'
      );
    }

    client = new sdk.S3Client({
      region: region || "us-east-1",
      ...(endpoint ? { endpoint, forcePathStyle } : {}),
      // With no explicit keys the SDK falls back to its default credential
      // chain, which is how IRSA, instance roles and workload identity work.
      // Supplying static keys is the exception, not the default.
      ...(accessKeyId && secretAccessKey ? { credentials: { accessKeyId, secretAccessKey } } : {}),
    });

    return { client, sdk };
  }

  const objectKey = (hash) => `${prefix.replace(/\/+$/, "")}/${hash}.pdf`;

  return {
    name: "s3",
    describe: () => ({ driver: "s3", bucket, region, endpoint, prefix }),

    async put(key, buffer) {
      const hash = assertValidKey(key);
      const { client: s3, sdk: aws } = ensureClient();

      // Content-addressed, so an object that exists already has these exact
      // bytes. Skipping the write saves a round trip and makes re-import of a
      // large batch cheap.
      try {
        await s3.send(new aws.HeadObjectCommand({ Bucket: bucket, Key: objectKey(hash) }));
        return objectKey(hash);
      } catch (error) {
        if (error?.$metadata?.httpStatusCode !== 404 && error?.name !== "NotFound") throw error;
      }

      await s3.send(
        new aws.PutObjectCommand({
          Bucket: bucket,
          Key: objectKey(hash),
          Body: buffer,
          ContentType: "application/pdf",
          // Belt and braces: the bucket should also enforce this, but a
          // request-level header means a misconfigured bucket policy does not
          // silently store invoices unencrypted.
          ServerSideEncryption: process.env.STORAGE_SSE || undefined,
          ChecksumSHA256: Buffer.from(hash, "hex").toString("base64"),
        })
      );

      return objectKey(hash);
    },

    async get(key) {
      let hash;
      try {
        hash = assertValidKey(key);
      } catch {
        return null;
      }

      const { client: s3, sdk: aws } = ensureClient();
      try {
        const response = await s3.send(new aws.GetObjectCommand({ Bucket: bucket, Key: objectKey(hash) }));
        return Buffer.from(await response.Body.transformToByteArray());
      } catch (error) {
        if (error?.$metadata?.httpStatusCode === 404 || error?.name === "NoSuchKey") return null;
        logger.error("invoice vault read failed", { error, driver: "s3" });
        throw error;
      }
    },

    async health() {
      try {
        const { client: s3, sdk: aws } = ensureClient();
        await s3.send(new aws.HeadBucketCommand({ Bucket: bucket }));
        return { name: "storage", status: "ok", detail: `s3:${bucket}` };
      } catch (error) {
        return { name: "storage", status: "error", detail: error.message };
      }
    },

    async close() {
      client?.destroy?.();
      client = null;
    },
  };
}

let cached = null;
let cachedFor = null;

/** The configured driver, memoised per driver selection. */
function objectStore(config = readConfig()) {
  const selector = `${config.storage.driver}:${config.storage.bucket || ""}:${config.storage.endpoint || ""}`;
  if (cached && cachedFor === selector) return cached;

  cached = config.storage.driver === "s3" ? s3Driver(config) : localDriver(config);
  cachedFor = selector;
  return cached;
}

/** Readiness check for the vault. */
const checkHealth = async (config = readConfig()) => objectStore(config).health();

async function close() {
  await cached?.close?.();
  cached = null;
  cachedFor = null;
}

module.exports = { objectStore, checkHealth, close, assertValidKey, InvalidObjectKey, CONTENT_HASH };
