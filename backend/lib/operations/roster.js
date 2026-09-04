/**
 * Cafeteria headcount.
 *
 * "Total employees" was previously the literal 400 typed into the admin page.
 * There is no HR system to integrate with here, so this module makes the number
 * explicit and configurable instead of invented, and reports how it was
 * obtained so the dashboard can be honest about it rather than presenting a
 * configured constant as if it were a measurement.
 */

const fs = require("fs");

const { dataDir, dataPath } = require("../dataDir");

const rosterPath = () => dataPath("roster.json");

const DEFAULT_HEADCOUNT = 400;

/**
 * Resolution order: environment override, then the on-disk roster, then the
 * documented default. `source` travels with the value all the way to the UI.
 */
function readRoster() {
  const fromEnv = Number(process.env.CAFETERIA_HEADCOUNT);
  if (Number.isFinite(fromEnv) && fromEnv > 0) {
    return { totalEmployees: Math.round(fromEnv), site: process.env.CAFETERIA_SITE || "All sites", source: "environment", updatedAt: null };
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(rosterPath(), "utf8"));
    const headcount = Number(parsed.totalEmployees);
    if (Number.isFinite(headcount) && headcount > 0) {
      return {
        totalEmployees: Math.round(headcount),
        site: parsed.site || "All sites",
        source: "roster-file",
        updatedAt: parsed.updatedAt || null,
      };
    }
  } catch {
    // Fall through to the default.
  }

  return { totalEmployees: DEFAULT_HEADCOUNT, site: "All sites", source: "default", updatedAt: null };
}

function saveRoster({ totalEmployees, site }) {
  const headcount = Number(totalEmployees);
  if (!Number.isFinite(headcount) || headcount <= 0) throw new Error("totalEmployees must be a positive number");

  const directory = dataDir();
  if (!fs.existsSync(directory)) fs.mkdirSync(directory, { recursive: true });
  const record = { totalEmployees: Math.round(headcount), site: site || "All sites", updatedAt: new Date().toISOString() };
  fs.writeFileSync(rosterPath(), JSON.stringify(record, null, 2));
  return { ...record, source: "roster-file" };
}

module.exports = { readRoster, saveRoster, DEFAULT_HEADCOUNT, rosterPath };
