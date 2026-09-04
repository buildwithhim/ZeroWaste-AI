/**
 * Per-suite data sandbox.
 *
 * Every store in the backend writes into the directory named by
 * ZEROWASTE_DATA_DIR (see lib/dataDir.js). This helper points that at a fresh
 * temp directory for each test, so:
 *
 *   - no test can read or corrupt the repository's committed data files;
 *   - no test inherits state from the test before it, which is what makes the
 *     duplicate-detection and waste-recording assertions trustworthy;
 *   - suites can run in parallel processes without fighting over one file.
 *
 * Paths are resolved per call inside lib/dataDir.js, so simply reassigning the
 * environment variable is enough -- no module-registry juggling is required.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach } from "vitest";

import { REPO_ROOT } from "./setup.js";

/** Artefacts predict.py loads from the data directory at import time. */
const MODEL_ARTEFACTS = ["model.pkl", "day_encoder.pkl", "menu_encoder.pkl"];

const SOURCE_DATA_DIR = path.join(REPO_ROOT, "data");

/** True when the configured interpreter exists and can import its dependencies. */
export function pythonAvailable() {
  const interpreter = process.env.PYTHON_PATH;
  if (!interpreter || !fs.existsSync(interpreter)) return false;
  const probe = spawnSync(interpreter, ["-c", "import joblib, pandas, sklearn, pdfplumber"], { encoding: "utf8" });
  return probe.status === 0;
}

/** True when the trained model artefacts are present to be copied in. */
export const modelAvailable = () => MODEL_ARTEFACTS.every((name) => fs.existsSync(path.join(SOURCE_DATA_DIR, name)));

/**
 * Installs a fresh data directory around each test in the calling suite.
 *
 * @param {{ withModel?: boolean }} options
 *   `withModel` copies the trained model and encoders in, which the prediction
 *   and planner suites need because predict.py loads them from the same
 *   directory the sandbox redirects.
 * @returns {{ dir: string }} live handle; `dir` is reassigned before each test.
 */
export function useDataSandbox({ withModel = false } = {}) {
  const handle = { dir: "" };

  beforeEach(() => {
    handle.dir = fs.mkdtempSync(path.join(os.tmpdir(), "zerowaste-test-"));
    process.env.ZEROWASTE_DATA_DIR = handle.dir;

    if (withModel) {
      for (const name of MODEL_ARTEFACTS) {
        fs.copyFileSync(path.join(SOURCE_DATA_DIR, name), path.join(handle.dir, name));
      }
    }
  });

  afterEach(() => {
    if (handle.dir) fs.rmSync(handle.dir, { recursive: true, force: true });
    handle.dir = "";
  });

  return handle;
}

/** Writes a file into the active sandbox, creating parent directories. */
export function writeSandboxFile(handle, relativePath, contents) {
  const target = path.join(handle.dir, relativePath);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents);
  return target;
}

/** Reads a file from the active sandbox, or null when it was never written. */
export function readSandboxFile(handle, relativePath, encoding = "utf8") {
  try {
    return fs.readFileSync(path.join(handle.dir, relativePath), encoding);
  } catch {
    return null;
  }
}

export const sandboxHas = (handle, relativePath) => fs.existsSync(path.join(handle.dir, relativePath));
