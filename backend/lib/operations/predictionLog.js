/**
 * What the system predicted, kept so it can be graded later.
 *
 * Forecast accuracy is a claim about the past, and a claim about the past needs
 * a record made before the outcome was known. Recomputing yesterday's forecast
 * today would grade the model against a prediction it never actually issued --
 * with the current feedback signals baked in, which is how a system ends up
 * reporting flattering accuracy it never earned.
 *
 * Rows are therefore written once, when a plan is first produced for a date, and
 * are never revised afterwards.
 */

const fs = require("fs");

const { dataDir, dataPath } = require("../dataDir");

const storePath = () => dataPath("prediction_log.json");

const emptyStore = () => ({ version: 1, entries: [] });

function ensureDataDir() {
  const directory = dataDir();
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
}

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return Array.isArray(parsed.entries) ? parsed : emptyStore();
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  ensureDataDir();
  const target = storePath();
  const tempPath = `${target}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
  fs.renameSync(tempPath, target);
}

/**
 * Records the plan for a date, ignoring dishes already logged for it.
 *
 * Returns the number of rows actually written so callers can tell a first
 * capture from a no-op. Re-planning the same day is expected -- an admin may
 * open the dashboard repeatedly -- and must not overwrite the original figures.
 */
function recordPlan({ servedOn, weekday, dishes }) {
  if (!servedOn || !Array.isArray(dishes) || !dishes.length) return { written: 0, alreadyLogged: 0 };

  const store = readStore();
  const existing = new Set(
    store.entries.filter((entry) => entry.servedOn === servedOn).map((entry) => entry.dish)
  );

  const fresh = dishes
    .filter((row) => !existing.has(row.dish))
    .map((row) => ({
      servedOn,
      weekday: weekday || null,
      dish: row.dish,
      preBooked: row.preBooked,
      predictedDemand: row.predictedDemand,
      recommendedCook: row.recommendedCook,
      preparedFoodPortions: row.preparedFoodPortions,
      baselineFoodPortions: row.baselineFoodPortions,
      portionMultiplier: row.portionMultiplier,
      loggedAt: new Date().toISOString(),
    }));

  if (fresh.length) {
    store.entries.push(...fresh);
    writeStore(store);
  }

  return { written: fresh.length, alreadyLogged: dishes.length - fresh.length };
}

const listAll = () => readStore().entries;

const listForDate = (dateKey) => listAll().filter((entry) => entry.servedOn === dateKey);

const loggedDates = () => [...new Set(listAll().map((entry) => entry.servedOn))].sort();

/** True when a date already has a frozen plan, so callers can skip re-logging. */
const hasPlanFor = (dateKey) => listAll().some((entry) => entry.servedOn === dateKey);

function replaceAll(entries) {
  writeStore({ version: 1, entries });
  return entries.length;
}

module.exports = { recordPlan, listAll, listForDate, loggedDates, hasPlanFor, replaceAll, storePath };
