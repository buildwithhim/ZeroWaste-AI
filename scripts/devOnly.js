/**
 * The guard every seed script must pass through.
 *
 * WHY A SHARED GUARD AND NOT A CHECK IN EACH SCRIPT
 * ------------------------------------------------
 * Seed scripts write fabricated data. `seed_feedback.js` invents a term of
 * responses and then refreshes the learning signals from them, which directly
 * moves what the kitchen is told to cook; `seed_operations.js` replaces the
 * booking and service history the accuracy report is computed from. Running
 * either against a production dataset does not "add demo data" -- it silently
 * replaces the record of what actually happened with fiction, and the dashboard
 * carries on reporting confidently.
 *
 * The obvious protection is a note in the README, which is not a protection.
 * The next most obvious is a check inside each script, which works until
 * somebody adds a tenth script and forgets. So the check lives here, and a
 * script opts in by calling it -- one line, at the top, before anything is read
 * or written.
 *
 * WHAT COUNTS AS PRODUCTION
 * -------------------------
 * NODE_ENV=production is the primary signal, but it is not sufficient on its
 * own: somebody running a script by hand against a production database will
 * very often have NODE_ENV unset in their shell. So a configured DATABASE_URL
 * or an S3 storage driver also count -- both are things a development machine
 * does not normally have -- and either requires the same explicit override.
 */

const path = require("path");

const { readConfig } = require(path.join(__dirname, "..", "backend", "lib", "config"));

const OVERRIDE = "ALLOW_DESTRUCTIVE_SEED";

/** Reasons this environment looks like it holds real data. */
function productionSignals(config = readConfig()) {
  const signals = [];

  if (config.isProduction) signals.push("NODE_ENV=production");
  if (config.database.enabled) signals.push("DATABASE_URL is set");
  if (config.storage.driver === "s3") signals.push(`STORAGE_DRIVER=s3 (bucket ${config.storage.bucket || "unnamed"})`);

  return signals;
}

/**
 * Aborts unless this is plainly a development environment.
 *
 * The override is deliberately awkward -- an environment variable that has to
 * be typed out in full -- because the only legitimate use is a deliberate
 * reseed of a staging environment, and that should be hard to do by accident
 * and impossible to do by tab-completion.
 */
function assertSafeToSeed(scriptName) {
  const config = readConfig();
  const signals = productionSignals(config);

  if (signals.length === 0) return config;

  if (process.env[OVERRIDE] === "yes-i-am-sure") {
    process.stderr.write(
      `WARNING: ${scriptName} is writing fabricated data to an environment that looks like production (${signals.join("; ")}). Continuing because ${OVERRIDE} is set.\n`
    );
    return config;
  }

  process.stderr.write(
    [
      "",
      `Refusing to run ${scriptName}.`,
      "",
      "This script writes fabricated data and replaces existing records. This",
      "environment looks like it holds real data:",
      "",
      ...signals.map((signal) => `  - ${signal}`),
      "",
      `If this is genuinely a disposable environment, set ${OVERRIDE}=yes-i-am-sure.`,
      "",
    ].join("\n")
  );

  process.exit(1);
}

module.exports = { assertSafeToSeed, productionSignals, OVERRIDE };
