/**
 * Where runtime state lives.
 *
 * Every store in this application persists to a JSON or CSV file under one
 * directory. That directory used to be hardcoded in nine separate modules as
 * `path.join(__dirname, "..", "..", "..", "data")`, which meant there was no
 * way to run the application -- or a test -- against anything other than the
 * checked-out source tree. A test suite had no choice but to read and overwrite
 * the same files the repository ships.
 *
 * `ZEROWASTE_DATA_DIR` overrides the location. Two things depend on it:
 *
 *   - the test harness, which points every suite at its own temp directory so
 *     tests are hermetic and can run in parallel without fighting each other;
 *   - any real deployment, where writing mutable state into the application
 *     directory is the wrong default.
 *
 * RESOLVED PER CALL, NOT AT IMPORT
 * --------------------------------
 * `dataDir()` is a function rather than a constant on purpose. Resolving at
 * import time would freeze the path into the module registry the first time
 * anything required a store, so a test that set the environment variable after
 * that first import would silently write to the real data directory. Reading
 * the variable on each access removes that ordering hazard entirely.
 */

const path = require("path");

/** The active data directory. Absolute. */
function dataDir() {
  const override = process.env.ZEROWASTE_DATA_DIR;
  return override ? path.resolve(override) : path.join(__dirname, "..", "..", "data");
}

/** A path inside the active data directory. */
function dataPath(...segments) {
  return path.join(dataDir(), ...segments);
}

module.exports = { dataDir, dataPath };
