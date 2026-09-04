/**
 * Global test environment.
 *
 * Vitest runs this before the test module graph is imported, which is the only
 * window in which some of these matter: `lib/requireAdmin.js` reads ADMIN_TOKEN
 * once at module load, so setting it inside a test would be too late.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_DIR = path.resolve(HERE, "..", "..");
export const REPO_ROOT = path.resolve(BACKEND_DIR, "..");

/**
 * A deliberately non-default administrator token.
 *
 * The application ships "zerowaste-local-admin-token" as a fallback. Tests run
 * against a different value on purpose, so the suite proves the gate honours
 * its configuration rather than passing by accident because the hardcoded
 * default happened to match. See tests/api/authorization.test.js.
 */
process.env.ADMIN_TOKEN = "test-admin-token-8f41c2";
process.env.FEEDBACK_HASH_SALT = "test-only-salt-not-the-shipped-default";

/** The interpreter that backs predict.py and parse_invoices.py. */
if (!process.env.PYTHON_PATH) {
  process.env.PYTHON_PATH =
    process.platform === "win32"
      ? path.join(REPO_ROOT, ".venv", "Scripts", "python.exe")
      : path.join(REPO_ROOT, ".venv", "bin", "python");
}

/**
 * Safety net.
 *
 * Every suite installs its own sandbox, but pointing the default somewhere
 * disposable means a suite that forgets still cannot read or overwrite the
 * repository's committed data files.
 */
process.env.ZEROWASTE_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "zerowaste-unsandboxed-"));
