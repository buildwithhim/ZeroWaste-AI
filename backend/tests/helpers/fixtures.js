/**
 * Test data builders and invoice PDF fixtures.
 *
 * The invoice fixtures are produced by scripts/make_test_invoice.py rather than
 * being checked in as binaries. That script already builds exactly the shapes
 * the pipeline needs to be tested against -- a corrected invoice that collides
 * with a stored order number, a multi-item order, a scan with no text layer, an
 * unreadable date -- and generating them keeps the fixtures honest: they are
 * real PDFs parsed by the real extractor, not stubbed parser output.
 */

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { REPO_ROOT } from "./setup.js";

/** Dishes that exist in lib/operations/menu.js. Bookings of anything else are refused. */
export const DISHES = {
  breakfast: "Masala Dosa",
  lunch: "Veg Biryani",
  otherLunch: "Rajma Chawal",
  snack: "Fruit Bowl",
};

/** A weekday service date. The cafeteria is closed at weekends, so tests must not drift onto one. */
export function nextWeekday(offsetWeeks = 0) {
  const date = new Date();
  date.setUTCHours(12, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + offsetWeeks * 7);
  while (date.getUTCDay() === 0 || date.getUTCDay() === 6) {
    date.setUTCDate(date.getUTCDate() + 1);
  }
  return date.toISOString().slice(0, 10);
}

/** The five service dates of the week containing `from`. */
export function serviceWeek(from = nextWeekday()) {
  const monday = new Date(`${from}T12:00:00Z`);
  monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
  return Array.from({ length: 5 }, (_, index) => {
    const day = new Date(monday);
    day.setUTCDate(monday.getUTCDate() + index);
    return day.toISOString().slice(0, 10);
  });
}

let uniqueCounter = 0;
/** A fresh employee pseudonym. Mirrors the client, which generates a UUID per browser. */
export const employeeId = (label = "emp") => `${label}-${process.pid}-${(uniqueCounter += 1)}`;

export const booking = (overrides = {}) => ({
  id: `bk-${(uniqueCounter += 1)}`,
  dish: DISHES.lunch,
  category: "Lunch",
  servedOn: nextWeekday(),
  appetite: "Regular",
  ...overrides,
});

// ---------------------------------------------------------------------------
// Invoice PDFs
// ---------------------------------------------------------------------------

/** Bundled SmartQ invoices that ship with the repository. */
const BUNDLED_DIR = path.join(REPO_ROOT, "data", "invoices");

/** Generated once per process, then reused: the script costs ~200ms to run. */
let generatedDir = null;

/**
 * Builds the synthetic fixture set and returns its directory.
 * Throws if Python is unavailable, so suites should guard with pythonAvailable().
 */
export function generatedFixtureDir() {
  if (generatedDir && fs.existsSync(generatedDir)) return generatedDir;

  const target = fs.mkdtempSync(path.join(os.tmpdir(), "zerowaste-fixtures-"));
  const script = path.join(REPO_ROOT, "scripts", "make_test_invoice.py");
  const result = spawnSync(process.env.PYTHON_PATH, [script, target], { encoding: "utf8" });

  if (result.status !== 0) {
    throw new Error(`Could not build invoice fixtures: ${result.stderr || result.stdout}`);
  }

  generatedDir = target;
  return target;
}

/** One generated fixture, by file name, as raw bytes. */
export const generatedInvoice = (name) => fs.readFileSync(path.join(generatedFixtureDir(), name));

/** One bundled SmartQ invoice, by file name, as raw bytes. */
export const bundledInvoice = (name) => fs.readFileSync(path.join(BUNDLED_DIR, name));

/** All bundled SmartQ invoice file names. */
export const bundledInvoiceNames = () =>
  fs.readdirSync(BUNDLED_DIR).filter((name) => name.toLowerCase().endsWith(".pdf"));

/** The first bundled invoice, which the conflict fixtures are built to collide with. */
export const BUNDLED_CONFLICT_TARGET = "invoice_G1004987.pdf";

export const FIXTURES = {
  /** Same order number as BUNDLED_CONFLICT_TARGET, different amount. */
  conflict: "conflict_G1004987.pdf",
  /** A third version of that same order. */
  conflictAgain: "conflict2_G1004987.pdf",
  multiItem: "multi_item_N2001987.pdf",
  otherCafe: "other_cafe_P3001987.pdf",
  scannedNoText: "scanned_no_text.pdf",
  badDate: "bad_date_Q4001987.pdf",
  notAnInvoice: "not_an_invoice.pdf",
};

/** Bytes that are not a PDF at all, for the magic-byte check. */
export const NOT_A_PDF = Buffer.from("<html><body>this is not a pdf</body></html>", "utf8");
