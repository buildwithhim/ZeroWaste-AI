/**
 * Builds the disposable data directory the backend under test writes into.
 *
 * The trained model, the encoders and a starting history are copied from the
 * repository so the prediction and accuracy journeys have something real to
 * work with; the mutable stores are copied too, so the plan the admin sees is
 * built from genuine history rather than from an empty file.
 *
 * Nothing here writes back to the repository.
 */

import fs from "node:fs";
import path from "node:path";

import { E2E_DATA_DIR } from "./env";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const SOURCE_DATA = path.join(REPO_ROOT, "data");

/** Everything the backend or predict.py reads out of the data directory. */
const SEED_FILES = [
  "model.pkl",
  "day_encoder.pkl",
  "menu_encoder.pkl",
  "history_dataset.csv",
  "roster.json",
  "service_log.json",
  "bookings.json",
  "prediction_log.json",
];

export default function globalSetup() {
  fs.rmSync(E2E_DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(E2E_DATA_DIR, { recursive: true });

  for (const name of SEED_FILES) {
    const source = path.join(SOURCE_DATA, name);
    if (fs.existsSync(source)) fs.copyFileSync(source, path.join(E2E_DATA_DIR, name));
  }

  // The drop folder the "scan server folder" button reads. Left empty so a
  // journey that scans it observes a deterministic result.
  fs.mkdirSync(path.join(E2E_DATA_DIR, "invoices"), { recursive: true });

  process.env.ZEROWASTE_DATA_DIR = E2E_DATA_DIR;
}
