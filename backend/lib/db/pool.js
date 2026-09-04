/**
 * PostgreSQL connection pool.
 *
 * WHY THIS EXISTS BEFORE ANYTHING READS FROM IT
 * ---------------------------------------------
 * The application still keeps its state in JSON files under `data/`. That is
 * workable for one container with a volume and wrong for anything that scales:
 * two replicas doing read-modify-write on the same `bookings.json` will lose
 * writes, because the file is rewritten wholesale rather than updated in place.
 *
 * Moving nine stores onto Postgres is a data-layer rewrite, and doing it in the
 * same change as the deployment work would make both impossible to review. So
 * this pass provisions the database, ships the schema and a migration runner,
 * and defines the repository interface the stores will be cut over onto -- while
 * the JSON stores remain the system of record. `DATABASE_URL` is optional: with
 * it unset the pool is never created and nothing here runs.
 *
 * The pool is lazily created and memoised, so importing this module costs
 * nothing in a process that never touches the database.
 */

const { readConfig } = require("../config");
const { logger } = require("../logger");

let pool = null;
let poolConfigUrl = null;

/** Loaded lazily so `pg` is not required in a deployment that has no database. */
function pgModule() {
  try {
    // eslint-disable-next-line global-require
    return require("pg");
  } catch {
    throw new Error(
      "DATABASE_URL is set but the 'pg' package is not installed. Run `npm install` in backend/, or unset DATABASE_URL to keep using the JSON stores."
    );
  }
}

/**
 * The shared pool, or null when no database is configured.
 *
 * Recreated if `DATABASE_URL` changes, which only happens in tests; a stale
 * pool pointing at a previous database would be a confusing failure.
 */
function getPool(config = readConfig()) {
  if (!config.database.enabled) return null;

  if (pool && poolConfigUrl === config.database.url) return pool;
  if (pool) {
    const stale = pool;
    pool = null;
    stale.end().catch(() => {});
  }

  const { Pool } = pgModule();
  pool = new Pool({
    connectionString: config.database.url,
    max: config.database.poolMax,
    connectionTimeoutMillis: config.database.connectionTimeoutMs,
    // Managed Postgres almost always terminates TLS with a certificate the
    // container does not have a root for. Verification is opt-in through
    // DATABASE_SSL_REJECT_UNAUTHORIZED rather than silently disabled.
    ssl: config.database.ssl
      ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "false" }
      : false,
  });
  poolConfigUrl = config.database.url;

  // An idle client erroring is a pool-level event with no request to attach it
  // to. Unhandled, it takes the process down.
  pool.on("error", (error) => logger.error("postgres idle client error", { error }));

  return pool;
}

/** Runs a parameterised query. Always parameterised -- never string-built SQL. */
async function query(text, params = []) {
  const active = getPool();
  if (!active) throw new Error("No database configured (DATABASE_URL is unset)");
  return active.query(text, params);
}

/** Runs `fn` inside a transaction, rolling back if it throws. */
async function transaction(fn) {
  const active = getPool();
  if (!active) throw new Error("No database configured (DATABASE_URL is unset)");

  const client = await active.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Readiness check. Returns a plain result rather than throwing, because the
 * readiness probe reports on every dependency and must not stop at the first
 * one that is down.
 */
async function checkHealth(config = readConfig()) {
  if (!config.database.enabled) {
    return {
      name: "postgres",
      status: "skipped",
      detail: "DATABASE_URL is unset; the JSON stores are the system of record",
    };
  }

  const startedAt = Date.now();
  try {
    await query("SELECT 1");
    return { name: "postgres", status: "ok", latencyMs: Date.now() - startedAt };
  } catch (error) {
    return { name: "postgres", status: "error", detail: error.message, latencyMs: Date.now() - startedAt };
  }
}

/** Closes the pool. Called from the shutdown sequence. */
async function close() {
  if (!pool) return;
  const closing = pool;
  pool = null;
  poolConfigUrl = null;
  await closing.end();
}

module.exports = { getPool, query, transaction, checkHealth, close };
