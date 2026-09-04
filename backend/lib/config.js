/**
 * One place that knows what the environment is asking for.
 *
 * Configuration used to be read wherever it was needed: `process.env.PORT` in
 * server.js, `process.env.ADMIN_TOKEN` in requireAdmin.js, `process.env.PYTHON_PATH`
 * in two different modules, each with its own inline fallback. That is workable
 * on a laptop and dangerous in production, because the fallbacks are the
 * problem: a missing variable does not fail, it silently selects a development
 * default. `ADMIN_TOKEN` defaulting to a value that is also committed to the
 * frontend bundle is exactly how an admin API ends up open to the internet.
 *
 * This module resolves every variable in one pass and, in production, refuses
 * to hand back a configuration that is unsafe. A container that is misconfigured
 * exits on boot with a list of what is wrong, which an orchestrator surfaces as
 * a failed rollout. The alternative -- booting happily with a known token -- is
 * a silent breach.
 *
 * RESOLVED PER CALL, NOT AT IMPORT
 * --------------------------------
 * `readConfig()` reads the environment each time it is called, for the same
 * reason `dataDir()` does: freezing values into the module registry at first
 * import makes behaviour depend on import order, and makes tests that set an
 * environment variable silently ineffective. `loadConfig()` is the boot-time
 * entry point that validates and throws; application code calls `readConfig()`.
 */

const path = require("path");

/**
 * Values that ship in the repository and must never reach production.
 *
 * These are not "weak passwords" to be scored heuristically -- they are known
 * strings, published in a public git history, and one of them is also embedded
 * in the compiled frontend. Matching them exactly is the point.
 */
const DEVELOPMENT_DEFAULTS = {
  ADMIN_TOKEN: "zerowaste-local-admin-token",
  FEEDBACK_HASH_SALT: "zerowaste-local-development-salt",
};

/** Minimum length for a secret that is the only thing protecting admin data. */
const MIN_SECRET_LENGTH = 32;

const DEFAULT_PORT = 5000;
const DEFAULT_SHUTDOWN_GRACE_MS = 15000;
const DEFAULT_BODY_LIMIT = "1mb";

/** Log levels, ordered. Anything below the configured level is dropped. */
const LOG_LEVELS = ["debug", "info", "warn", "error"];

class ConfigurationError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}`);
    this.name = "ConfigurationError";
    this.problems = problems;
  }
}

const trimmed = (value) => (typeof value === "string" ? value.trim() : "");

/** Parses a comma or whitespace separated list, dropping empties. */
function list(value) {
  return trimmed(value)
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** Environment booleans are strings; treat the usual affirmatives as true. */
function bool(value, fallback = false) {
  const raw = trimmed(value).toLowerCase();
  if (!raw) return fallback;
  return ["1", "true", "yes", "on"].includes(raw);
}

function integer(value, fallback) {
  const parsed = Number.parseInt(trimmed(value), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Builds the configuration object. Never throws: an invalid value is reported
 * by `validateConfig`, so a caller can collect every problem at once rather
 * than fixing them one restart at a time.
 */
function readConfig(env = process.env) {
  const nodeEnv = trimmed(env.NODE_ENV) || "development";
  const isProduction = nodeEnv === "production";
  const isTest = nodeEnv === "test";

  const adminToken = trimmed(env.ADMIN_TOKEN) || DEVELOPMENT_DEFAULTS.ADMIN_TOKEN;
  const hashSalt = trimmed(env.FEEDBACK_HASH_SALT) || DEVELOPMENT_DEFAULTS.FEEDBACK_HASH_SALT;

  // Development talks to a Vite dev server on 5173 and the Playwright harness
  // on 5273. Production is given no default at all -- see validateConfig.
  const corsOrigins = list(env.CORS_ALLOWED_ORIGINS);

  return {
    nodeEnv,
    isProduction,
    isTest,
    isDevelopment: !isProduction && !isTest,

    server: {
      port: integer(env.PORT, DEFAULT_PORT),
      host: trimmed(env.HOST) || "0.0.0.0",
      // Behind an ingress or load balancer the client IP is in X-Forwarded-For.
      // Off by default: trusting the header when nothing sets it lets a client
      // spoof its own address.
      trustProxy: bool(env.TRUST_PROXY, false),
      bodyLimit: trimmed(env.BODY_LIMIT) || DEFAULT_BODY_LIMIT,
      shutdownGraceMs: integer(env.SHUTDOWN_GRACE_MS, DEFAULT_SHUTDOWN_GRACE_MS),
    },

    cors: {
      allowedOrigins: corsOrigins,
      // Wildcard is only ever a development convenience.
      allowAll: !isProduction && corsOrigins.length === 0,
      allowCredentials: bool(env.CORS_ALLOW_CREDENTIALS, false),
    },

    security: {
      adminToken,
      hashSalt,
      adminTokenIsDefault: adminToken === DEVELOPMENT_DEFAULTS.ADMIN_TOKEN,
      hashSaltIsDefault: hashSalt === DEVELOPMENT_DEFAULTS.FEEDBACK_HASH_SALT,
    },

    logging: {
      level: LOG_LEVELS.includes(trimmed(env.LOG_LEVEL)) ? trimmed(env.LOG_LEVEL) : isProduction ? "info" : "debug",
      // Machine-readable in production so a log shipper can index fields;
      // human-readable on a terminal, where JSON is unreadable noise.
      format: trimmed(env.LOG_FORMAT) || (isProduction ? "json" : "pretty"),
      silent: bool(env.LOG_SILENT, isTest),
      serviceName: trimmed(env.SERVICE_NAME) || "zerowaste-backend",
      version: trimmed(env.APP_VERSION) || trimmed(env.GIT_SHA) || "dev",
    },

    data: {
      // Mirrors backend/lib/dataDir.js. Kept here so the boot banner and the
      // readiness probe can report the resolved location.
      dir: trimmed(env.ZEROWASTE_DATA_DIR) || null,
    },

    database: {
      // Postgres is provisioned and migratable ahead of the data-layer cutover;
      // until a URL is supplied the JSON stores remain the system of record.
      url: trimmed(env.DATABASE_URL) || null,
      enabled: Boolean(trimmed(env.DATABASE_URL)),
      ssl: bool(env.DATABASE_SSL, isProduction),
      poolMax: integer(env.DATABASE_POOL_MAX, 10),
      connectionTimeoutMs: integer(env.DATABASE_CONNECTION_TIMEOUT_MS, 5000),
      migrationsDir: trimmed(env.DATABASE_MIGRATIONS_DIR) || path.join(__dirname, "..", "migrations"),
    },

    storage: {
      // "local" writes the invoice vault to the data directory, which is fine
      // for a single container with a volume and wrong for more than one.
      driver: trimmed(env.STORAGE_DRIVER) || "local",
      bucket: trimmed(env.STORAGE_BUCKET) || null,
      region: trimmed(env.STORAGE_REGION) || null,
      endpoint: trimmed(env.STORAGE_ENDPOINT) || null,
      prefix: trimmed(env.STORAGE_PREFIX) || "invoice-vault",
      accessKeyId: trimmed(env.STORAGE_ACCESS_KEY_ID) || null,
      secretAccessKey: trimmed(env.STORAGE_SECRET_ACCESS_KEY) || null,
      // MinIO and most self-hosted S3 gateways need path-style addressing.
      forcePathStyle: bool(env.STORAGE_FORCE_PATH_STYLE, true),
    },

    ai: {
      // "spawn" runs predict.py as a child process, which is what development
      // and the whole test suite rely on. "http" talks to the containerised
      // service, which is the production shape.
      mode: trimmed(env.AI_SERVICE_URL) ? "http" : trimmed(env.AI_SERVICE_MODE) || "spawn",
      url: trimmed(env.AI_SERVICE_URL) || null,
      timeoutMs: integer(env.AI_SERVICE_TIMEOUT_MS, 20000),
      pythonPath: trimmed(env.PYTHON_PATH) || null,
    },
  };
}

/**
 * Production-only safety rules.
 *
 * Development is deliberately permissive -- the defaults exist so a new
 * contributor can clone and run. Every rule below exists because the
 * corresponding default is unsafe once the service is reachable by anyone
 * other than the person who started it.
 */
function validateConfig(config) {
  const problems = [];

  if (!Number.isFinite(config.server.port) || config.server.port <= 0 || config.server.port > 65535) {
    problems.push(`PORT must be a valid port number (got "${config.server.port}")`);
  }

  if (!["json", "pretty"].includes(config.logging.format)) {
    problems.push(`LOG_FORMAT must be "json" or "pretty" (got "${config.logging.format}")`);
  }

  if (!["local", "s3"].includes(config.storage.driver)) {
    problems.push(`STORAGE_DRIVER must be "local" or "s3" (got "${config.storage.driver}")`);
  }

  if (!["spawn", "http"].includes(config.ai.mode)) {
    problems.push(`AI_SERVICE_MODE must be "spawn" or "http" (got "${config.ai.mode}")`);
  }

  if (config.ai.mode === "http" && !config.ai.url) {
    problems.push("AI_SERVICE_URL is required when AI_SERVICE_MODE is \"http\"");
  }

  if (config.storage.driver === "s3") {
    if (!config.storage.bucket) problems.push("STORAGE_BUCKET is required when STORAGE_DRIVER is \"s3\"");
    if (!config.storage.region && !config.storage.endpoint) {
      problems.push("STORAGE_REGION or STORAGE_ENDPOINT is required when STORAGE_DRIVER is \"s3\"");
    }
  }

  if (!config.isProduction) return problems;

  // --- Production-only ----------------------------------------------------

  if (config.security.adminTokenIsDefault) {
    problems.push(
      "ADMIN_TOKEN is still the committed development default. It is published in this repository's git history and compiled into the frontend bundle; set a unique secret."
    );
  } else if (config.security.adminToken.length < MIN_SECRET_LENGTH) {
    problems.push(`ADMIN_TOKEN must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }

  if (config.security.hashSaltIsDefault) {
    problems.push(
      "FEEDBACK_HASH_SALT is still the committed development default. With a known salt the employee pseudonyms in bookings and feedback can be reversed by hashing a staff list; set a unique secret."
    );
  } else if (config.security.hashSalt.length < MIN_SECRET_LENGTH) {
    problems.push(`FEEDBACK_HASH_SALT must be at least ${MIN_SECRET_LENGTH} characters in production`);
  }

  if (config.cors.allowedOrigins.length === 0) {
    problems.push(
      "CORS_ALLOWED_ORIGINS is required in production. Leaving it unset previously meant Access-Control-Allow-Origin: *, which lets any website on the internet call this API with a user's browser."
    );
  }

  if (config.cors.allowedOrigins.includes("*")) {
    problems.push("CORS_ALLOWED_ORIGINS must name explicit origins in production; \"*\" is not permitted");
  }

  for (const origin of config.cors.allowedOrigins) {
    if (!/^https?:\/\/[^/]+$/.test(origin)) {
      problems.push(`CORS_ALLOWED_ORIGINS entry "${origin}" must be a scheme and host with no trailing path`);
    } else if (origin.startsWith("http://") && !/^http:\/\/(localhost|127\.0\.0\.1)(:|$)/.test(origin)) {
      problems.push(`CORS_ALLOWED_ORIGINS entry "${origin}" uses plaintext http in production`);
    }
  }

  if (config.storage.driver === "local") {
    problems.push(
      "STORAGE_DRIVER \"local\" writes the invoice vault to the container filesystem. Use \"s3\" in production, or set STORAGE_ALLOW_LOCAL=true if a single replica with a persistent volume is genuinely intended."
    );
  }

  if (!config.data.dir) {
    problems.push(
      "ZEROWASTE_DATA_DIR is required in production. Without it runtime state is written inside the application directory, which is lost on every deploy."
    );
  }

  return problems;
}

/**
 * Boot-time entry point. Returns a validated configuration or throws with
 * every problem listed, so one restart reveals the whole picture.
 */
function loadConfig(env = process.env) {
  const config = readConfig(env);

  // A deliberate, documented escape hatch for the single-replica-with-a-volume
  // deployment. It has to be asked for by name; it is not a default.
  const problems = validateConfig(config).filter(
    (problem) => !(bool(env.STORAGE_ALLOW_LOCAL) && problem.startsWith("STORAGE_DRIVER \"local\""))
  );

  if (problems.length) throw new ConfigurationError(problems);
  return config;
}

/**
 * Non-secret configuration, safe to log at boot and to return from a readiness
 * probe. Secrets are reported as booleans: whether one is set, never its value.
 */
function describeConfig(config) {
  return {
    nodeEnv: config.nodeEnv,
    version: config.logging.version,
    port: config.server.port,
    logLevel: config.logging.level,
    logFormat: config.logging.format,
    corsAllowedOrigins: config.cors.allowAll ? ["*"] : config.cors.allowedOrigins,
    dataDir: config.data.dir,
    databaseEnabled: config.database.enabled,
    storageDriver: config.storage.driver,
    storageBucket: config.storage.bucket,
    aiMode: config.ai.mode,
    aiUrl: config.ai.url,
    adminTokenConfigured: !config.security.adminTokenIsDefault,
    hashSaltConfigured: !config.security.hashSaltIsDefault,
  };
}

module.exports = {
  readConfig,
  validateConfig,
  loadConfig,
  describeConfig,
  ConfigurationError,
  DEVELOPMENT_DEFAULTS,
  MIN_SECRET_LENGTH,
  LOG_LEVELS,
};
