/**
 * Close-of-service actuals.
 *
 * Stage 4 and 5 of the loop (Consumption, Waste). Forecast accuracy and
 * "prediction vs actual" are only meaningful if something records what actually
 * happened, so the kitchen closes each service by reporting how much it cooked
 * and how much went out. Without these rows the dashboard reports "not yet
 * measured" rather than inventing an accuracy figure.
 *
 * Leftovers are derived (cooked - served) rather than entered, so the three
 * numbers can never contradict each other.
 */

const fs = require("fs");
const path = require("path");

const { isKnownDish, portionKgFor } = require("./menu");

const DATA_DIR = path.join(__dirname, "..", "..", "..", "data");
const STORE_PATH = path.join(DATA_DIR, "service_log.json");

const emptyStore = () => ({ version: 1, entries: [] });

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(STORE_PATH, "utf8"));
    return Array.isArray(parsed.entries) ? parsed : emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  ensureDataDir();
  const tempPath = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
  fs.renameSync(tempPath, STORE_PATH);
}

const { toDateKey } = require("./serviceDate");
const round = (value, places = 2) => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

function rejectionReason({ dish, cookedPortions, servedPortions }) {
  if (!dish) return "dish is required";
  if (!isKnownDish(dish)) return `unknown dish: ${dish}`;
  if (!Number.isFinite(Number(cookedPortions)) || Number(cookedPortions) < 0) return "cookedPortions must be zero or more";
  if (!Number.isFinite(Number(servedPortions)) || Number(servedPortions) < 0) return "servedPortions must be zero or more";
  if (Number(servedPortions) > Number(cookedPortions)) return "servedPortions cannot exceed cookedPortions";
  return null;
}

/**
 * Records what a service actually produced. Re-recording the same dish and date
 * replaces the earlier row, because a correction should supersede the mistake
 * rather than be averaged with it.
 */
function recordService({ servedOn, dishes }) {
  if (!Array.isArray(dishes)) throw new Error("dishes must be an array");

  const dateKey = toDateKey(servedOn || Date.now());
  if (Number.isNaN(new Date(`${dateKey}T00:00:00Z`).getTime())) throw new Error("servedOn must be a valid date");

  const accepted = [];
  const rejected = [];

  for (const row of dishes) {
    const reason = rejectionReason(row || {});
    if (reason) {
      rejected.push({ dish: row?.dish ?? null, reason });
      continue;
    }

    const cookedPortions = Math.round(Number(row.cookedPortions));
    const servedPortions = Math.round(Number(row.servedPortions));
    accepted.push({
      servedOn: dateKey,
      dish: row.dish,
      cookedPortions,
      servedPortions,
      leftoverPortions: cookedPortions - servedPortions,
      leftoverKg: round((cookedPortions - servedPortions) * portionKgFor(row.dish)),
      recordedAt: new Date().toISOString(),
    });
  }

  const store = readStore();
  const replacing = new Set(accepted.map((row) => `${row.servedOn}|${row.dish}`));
  store.entries = store.entries.filter((entry) => !replacing.has(`${entry.servedOn}|${entry.dish}`));
  store.entries.push(...accepted);
  writeStore(store);

  return { servedOn: dateKey, accepted: accepted.length, rejected };
}

const listAll = () => readStore().entries;

const listForDate = (dateKey) => listAll().filter((entry) => entry.servedOn === dateKey);

/** Service dates that have at least one recorded dish, oldest first. */
const recordedDates = () => [...new Set(listAll().map((entry) => entry.servedOn))].sort();

/** Actual served portions per dish for one date, keyed for planner lookups. */
function actualsByDish(dateKey) {
  return new Map(listForDate(dateKey).map((entry) => [entry.dish, entry]));
}

function replaceAll(entries) {
  writeStore({ version: 1, entries });
  return entries.length;
}

module.exports = { recordService, listAll, listForDate, recordedDates, actualsByDish, replaceAll, toDateKey, STORE_PATH };
