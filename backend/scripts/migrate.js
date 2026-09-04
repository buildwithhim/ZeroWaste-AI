#!/usr/bin/env node
/**
 * Applies pending database migrations.
 *
 * Run as an init container, a pre-deploy job, or by hand:
 *
 *   node scripts/migrate.js          apply everything pending
 *   node scripts/migrate.js --check  report pending, change nothing
 *
 * `--check` exists for CI and for a deploy gate: it exits non-zero when
 * migrations are outstanding, so a pipeline can refuse to promote an image
 * whose schema has not been applied, without the pipeline itself being able to
 * alter the database.
 *
 * WHY THIS IS NOT RUN FROM server.js
 * ----------------------------------
 * Migrating on boot means every replica in a rolling deploy attempts it, and
 * means the application's database user needs DDL rights permanently. Running
 * it as a separate step lets the migration job use a privileged role while the
 * long-running service connects with one that can only read and write rows.
 * The advisory lock in lib/db/migrate.js makes concurrent attempts safe anyway,
 * but "safe" is not a reason to grant permissions that are not needed.
 */

const { loadConfig, ConfigurationError } = require("../lib/config");
const { migrate, pendingMigrations } = require("../lib/db/migrate");
const { close } = require("../lib/db/pool");
const { logger } = require("../lib/logger");

async function main() {
  const checkOnly = process.argv.includes("--check");

  let config;
  try {
    config = loadConfig();
  } catch (error) {
    if (error instanceof ConfigurationError) {
      logger.error("invalid configuration", { problems: error.problems });
      return 78; // EX_CONFIG
    }
    throw error;
  }

  if (!config.database.enabled) {
    logger.error("DATABASE_URL is not set; there is no database to migrate");
    return 1;
  }

  if (checkOnly) {
    const pending = await pendingMigrations({ config });
    if (pending.length === 0) {
      logger.info("database schema is up to date");
      return 0;
    }
    logger.error("pending migrations", { count: pending.length, names: pending.map((item) => item.name) });
    return 1;
  }

  const result = await migrate({ config });
  logger.info("migration complete", {
    applied: result.applied.length,
    alreadyApplied: result.alreadyApplied,
    total: result.total,
    names: result.applied.map((item) => item.name),
  });
  return 0;
}

main()
  .then(async (code) => {
    await close();
    process.exit(code);
  })
  .catch(async (error) => {
    logger.error("migration failed", { error });
    await close().catch(() => {});
    process.exit(1);
  });
