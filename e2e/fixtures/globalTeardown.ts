/**
 * Removes the disposable data directory once the run is over.
 *
 * Kept when KEEP_E2E_DATA is set, which is how a failing invoice or waste
 * journey is debugged: the JSON the backend actually wrote is the evidence.
 */

import fs from "node:fs";

import { E2E_DATA_DIR } from "./env";

export default function globalTeardown() {
  if (process.env.KEEP_E2E_DATA) {
    console.log(`[e2e] keeping data directory: ${E2E_DATA_DIR}`);
    return;
  }
  // On Windows the backend and its Python child can still hold handles for a
  // moment after Playwright signals them to stop, so a single rm races and
  // throws EPERM. Retry briefly, and never fail a green run over cleanup.
  try {
    fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.warn(`[e2e] could not remove ${E2E_DATA_DIR}: ${(error as Error).message}`);
  }
}
