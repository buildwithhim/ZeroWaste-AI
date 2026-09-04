/**
 * Raw feedback persistence.
 *
 * PRIVACY CONTRACT
 * ----------------
 * Rows written here are the only place an individual response exists. The
 * employee identifier is one-way hashed on the way in and is never returned by
 * any admin-facing code path — `listAll()` is consumed only by the aggregation
 * layer, which collapses rows into counts before anything leaves the server.
 */

const crypto = require("crypto");
const fs = require("fs");

const { dataDir, dataPath } = require("./dataDir");

const storePath = () => dataPath("feedback.json");

/**
 * Salt for pseudonymising employee ids. Set FEEDBACK_HASH_SALT in production so
 * the mapping cannot be rebuilt by brute-forcing a known employee list.
 */
const HASH_SALT = process.env.FEEDBACK_HASH_SALT || "zerowaste-local-development-salt";

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

/** One-way pseudonym. Stable per employee so we can de-duplicate responses. */
function hashEmployee(employeeId) {
  return crypto
    .createHash("sha256")
    .update(`${HASH_SALT}:${String(employeeId || "anonymous")}`)
    .digest("hex")
    .slice(0, 16);
}

const toDateKey = (value) => new Date(value).toISOString().slice(0, 10);

/**
 * Records one response, replacing any earlier answer for the same booking on the
 * same service date so a single meal always contributes a single data point.
 */
function saveFeedback({ employeeId, bookingId, dish, category, weekday, response, servedOn, portionSize }) {
  const store = readStore();
  const servedDate = toDateKey(servedOn || Date.now());
  const employeeHash = hashEmployee(employeeId);

  const entry = {
    id: crypto.randomUUID(),
    employeeHash,
    bookingId,
    dish,
    category: category || "Lunch",
    weekday: weekday || new Date(`${servedDate}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" }),
    portionSize: portionSize || "Regular",
    response,
    servedOn: servedDate,
    submittedAt: new Date().toISOString(),
  };

  store.entries = store.entries.filter(
    (item) => !(item.employeeHash === employeeHash && item.bookingId === bookingId && item.servedOn === servedDate)
  );
  store.entries.push(entry);
  writeStore(store);
  return entry;
}

/** Aggregation-layer access only. Never serialise the result to a client. */
function listAll() {
  return readStore().entries;
}

/**
 * An employee may read back their own responses (they already know them); this
 * is the only lookup keyed by identity, and admins have no route into it.
 */
function listForEmployee(employeeId) {
  const employeeHash = hashEmployee(employeeId);
  return listAll()
    .filter((entry) => entry.employeeHash === employeeHash)
    .map(({ employeeHash: _hash, ...safe }) => safe);
}

function replaceAll(entries) {
  writeStore({ version: 1, entries });
  return entries.length;
}

module.exports = { saveFeedback, listAll, listForEmployee, replaceAll, hashEmployee, storePath };
