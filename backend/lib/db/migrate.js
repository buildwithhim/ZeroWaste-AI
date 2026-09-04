/**
 * Forward-only SQL migrations.
 *
 * Deliberately small and dependency-free. A migration is a `.sql` file whose
 * name begins with a zero-padded ordinal; the runner applies the ones that have
 * not been applied yet, in filename order, each inside its own transaction, and
 * records the result in `schema_migrations`.
 *
 * WHY NO DOWN MIGRATIONS
 * ----------------------
 * A down migration is a promise to reverse a schema change without losing data,
 * and for anything that drops a column that promise cannot be kept. Rolling
 * back a bad deploy means deploying the previous image and writing a new
 * forward migration; a `down` script is a rollback plan that has never been
 * tested against production data.
 *
 * WHY EACH FILE IS CHECKSUMMED
 * ----------------------------
 * Editing a migration that has already run is the most common way to get two
 * environments that claim the same schema version and do not have the same
 * schema. The runner records a hash and refuses to continue if a file it has
 * already applied has changed since.
 *
 * WHY AN ADVISORY LOCK
 * --------------------
 * Rolling deployments start several replicas at once. Without a lock they would
 * all try to migrate simultaneously, and the ones that lost would fail on
 * "relation already exists" and crash-loop. The lock makes migration safe to
 * run on every container start, which is what makes it reliable.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { readConfig } = require("../config");
const { getPool } = require("./pool");
const { logger } = require("../logger");

/** Arbitrary but fixed: identifies this application's migration lock. */
const ADVISORY_LOCK_KEY = 8323127;

const MIGRATION_FILE = /^(\d+)[_-].+\.sql$/;

const LEDGER_DDL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version      TEXT PRIMARY KEY,
    name         TEXT        NOT NULL,
    checksum     TEXT        NOT NULL,
    applied_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    duration_ms  INTEGER     NOT NULL
  )
`;

const checksum = (contents) => crypto.createHash("sha256").update(contents).digest("hex");

/** Reads the migration files from disk, ordered by their numeric prefix. */
function loadMigrations(directory) {
  if (!fs.existsSync(directory)) return [];

  return fs
    .readdirSync(directory)
    .filter((name) => MIGRATION_FILE.test(name))
    .sort((a, b) => Number(a.match(MIGRATION_FILE)[1]) - Number(b.match(MIGRATION_FILE)[1]))
    .map((name) => {
      const sql = fs.readFileSync(path.join(directory, name), "utf8");
      return { version: name.match(MIGRATION_FILE)[1], name, sql, checksum: checksum(sql) };
    });
}

/**
 * Applies every pending migration.
 *
 * Returns what it did rather than logging and swallowing, so a CI job can
 * assert on the result and the boot sequence can report it.
 */
async function migrate({ config = readConfig(), directory } = {}) {
  const pool = getPool(config);
  if (!pool) throw new Error("Cannot migrate: DATABASE_URL is unset");

  const dir = directory || config.database.migrationsDir;
  const migrations = loadMigrations(dir);
  const client = await pool.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [ADVISORY_LOCK_KEY]);
    await client.query(LEDGER_DDL);

    const { rows } = await client.query("SELECT version, name, checksum FROM schema_migrations");
    const applied = new Map(rows.map((row) => [row.version, row]));

    for (const migration of migrations) {
      const previous = applied.get(migration.version);
      if (previous && previous.checksum !== migration.checksum) {
        throw new Error(
          `Migration ${migration.name} has changed since it was applied (recorded ${previous.checksum.slice(0, 12)}, on disk ${migration.checksum.slice(0, 12)}). Applied migrations are immutable; add a new one instead.`
        );
      }
    }

    const pending = migrations.filter((migration) => !applied.has(migration.version));
    const executed = [];

    for (const migration of pending) {
      const startedAt = Date.now();
      logger.info("applying migration", { version: migration.version, name: migration.name });

      // Each migration is its own transaction: a failure leaves the ones
      // before it applied and recorded, so a re-run resumes rather than
      // repeating work that already succeeded.
      try {
        await client.query("BEGIN");
        await client.query(migration.sql);
        await client.query(
          "INSERT INTO schema_migrations (version, name, checksum, duration_ms) VALUES ($1, $2, $3, $4)",
          [migration.version, migration.name, migration.checksum, Date.now() - startedAt]
        );
        await client.query("COMMIT");
      } catch (error) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(`Migration ${migration.name} failed: ${error.message}`);
      }

      executed.push({ version: migration.version, name: migration.name, durationMs: Date.now() - startedAt });
    }

    return { applied: executed, alreadyApplied: applied.size, total: migrations.length };
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [ADVISORY_LOCK_KEY]).catch(() => {});
    client.release();
  }
}

/** Migrations on disk that the database has not recorded. */
async function pendingMigrations({ config = readConfig(), directory } = {}) {
  const pool = getPool(config);
  if (!pool) return loadMigrations(directory || config.database.migrationsDir);

  await pool.query(LEDGER_DDL);
  const { rows } = await pool.query("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((row) => row.version));
  return loadMigrations(directory || config.database.migrationsDir).filter((item) => !applied.has(item.version));
}

module.exports = { migrate, pendingMigrations, loadMigrations, ADVISORY_LOCK_KEY };
