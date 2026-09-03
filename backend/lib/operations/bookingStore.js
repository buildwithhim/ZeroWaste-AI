/**
 * Weekly meal bookings, held server-side.
 *
 * WHY THIS EXISTS
 * ---------------
 * Bookings used to live only in the browser's localStorage. The admin dashboard
 * counted them straight out of the React context, which meant every "pre-orders"
 * figure an administrator saw was really that administrator's own meal plan --
 * a number that could never exceed 15 and had nothing to do with the canteen.
 * Any dashboard claiming to answer "how much should we cook" has to read the
 * whole population's bookings, so they are persisted here.
 *
 * PRIVACY CONTRACT
 * ----------------
 * The same rule as feedback applies: employee identifiers are one-way hashed on
 * write, and no admin-facing code path returns a row. `countsByDish` and
 * `summariseDate` collapse rows to counts inside this module, and those are the
 * only shapes the planner consumes.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const { isKnownDish } = require("./menu");

const DATA_DIR = path.join(__dirname, "..", "..", "..", "data");
const STORE_PATH = path.join(DATA_DIR, "bookings.json");

/** Shared with feedbackStore so one employee has one pseudonym system-wide. */
const HASH_SALT = process.env.FEEDBACK_HASH_SALT || "zerowaste-local-development-salt";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const CATEGORIES = ["Breakfast", "Lunch", "Snacks"];

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

function hashEmployee(employeeId) {
  return crypto
    .createHash("sha256")
    .update(`${HASH_SALT}:${String(employeeId || "anonymous")}`)
    .digest("hex")
    .slice(0, 16);
}

const { toDateKey, weekdayOf } = require("./serviceDate");

/**
 * Validates one booking line. Returns a reason string when the line cannot be
 * stored; the caller reports these rather than dropping them silently, so an
 * employee whose plan was partly rejected finds out.
 */
function rejectionReason({ servedOn, category, dish }) {
  if (!dish) return "dish is required";
  if (!isKnownDish(dish)) return `unknown dish: ${dish}`;
  if (!CATEGORIES.includes(category)) return `category must be one of: ${CATEGORIES.join(", ")}`;
  if (!servedOn || Number.isNaN(new Date(servedOn).getTime())) return "servedOn must be a valid date";
  if (!WEEKDAYS.includes(weekdayOf(toDateKey(servedOn)))) return "the cafeteria is closed at weekends";
  return null;
}

/**
 * Replaces an employee's bookings for the supplied service dates.
 *
 * Scoping the replacement to the dates present in the payload means saving a
 * plan for next week cannot wipe bookings already made for this week.
 *
 * `scopeDates` lets a client widen that scope to the whole period its plan
 * covers. Without it, cancelling every meal on a day would leave the original
 * booking standing, because a date with no bookings does not appear in the
 * payload -- and the cafeteria would cook for a meal nobody intends to eat.
 */
function saveBookings({ employeeId, bookings, scopeDates = [] }) {
  if (!Array.isArray(bookings)) throw new Error("bookings must be an array");
  if (!Array.isArray(scopeDates)) throw new Error("scopeDates must be an array");

  const employeeHash = hashEmployee(employeeId);
  const accepted = [];
  const rejected = [];

  for (const booking of bookings) {
    const reason = rejectionReason(booking || {});
    if (reason) {
      rejected.push({ dish: booking?.dish ?? null, servedOn: booking?.servedOn ?? null, reason });
      continue;
    }

    const servedOn = toDateKey(booking.servedOn);
    accepted.push({
      id: crypto.randomUUID(),
      employeeHash,
      dish: booking.dish,
      category: booking.category,
      appetite: booking.appetite || "Regular",
      servedOn,
      weekday: weekdayOf(servedOn),
      bookedAt: new Date().toISOString(),
    });
  }

  const store = readStore();
  const touchedDates = new Set(accepted.map((entry) => entry.servedOn));
  for (const date of scopeDates) {
    if (typeof date !== "string" || Number.isNaN(new Date(date).getTime())) continue;
    touchedDates.add(toDateKey(date));
  }

  // One employee may hold at most one booking per category per service date;
  // the last write for that slot wins.
  const deduped = [];
  const seenSlots = new Set();
  for (const entry of [...accepted].reverse()) {
    const slot = `${entry.servedOn}|${entry.category}`;
    if (seenSlots.has(slot)) continue;
    seenSlots.add(slot);
    deduped.unshift(entry);
  }

  store.entries = store.entries.filter(
    (entry) => !(entry.employeeHash === employeeHash && touchedDates.has(entry.servedOn))
  );
  store.entries.push(...deduped);
  writeStore(store);

  return { accepted: deduped.length, rejected, dates: [...touchedDates].sort() };
}

/** Aggregation-layer access only. Never serialise the result to a client. */
function listAll() {
  return readStore().entries;
}

/** An employee may read back their own bookings. Admins have no route here. */
function listForEmployee(employeeId) {
  const employeeHash = hashEmployee(employeeId);
  return listAll()
    .filter((entry) => entry.employeeHash === employeeHash)
    .map(({ employeeHash: _hash, ...safe }) => safe);
}

/** Booking counts per dish for one service date. Identity is gone on return. */
function countsByDish(dateKey) {
  const counts = new Map();
  for (const entry of listAll()) {
    if (entry.servedOn !== dateKey) continue;
    counts.set(entry.dish, (counts.get(entry.dish) || 0) + 1);
  }
  return counts;
}

/** Headline booking figures for one service date. */
function summariseDate(dateKey) {
  const rows = listAll().filter((entry) => entry.servedOn === dateKey);
  const byCategory = CATEGORIES.reduce((acc, category) => ({ ...acc, [category]: 0 }), {});
  const employees = new Set();

  for (const row of rows) {
    byCategory[row.category] = (byCategory[row.category] || 0) + 1;
    employees.add(row.employeeHash);
  }

  return { date: dateKey, totalBookings: rows.length, byCategory, employeesBooked: employees.size };
}

/** Distinct service dates that hold at least one booking, oldest first. */
function bookedDates() {
  return [...new Set(listAll().map((entry) => entry.servedOn))].sort();
}

function replaceAll(entries) {
  writeStore({ version: 1, entries });
  return entries.length;
}

module.exports = {
  saveBookings,
  listAll,
  listForEmployee,
  countsByDish,
  summariseDate,
  bookedDates,
  replaceAll,
  hashEmployee,
  toDateKey,
  weekdayOf,
  WEEKDAYS,
  CATEGORIES,
  STORE_PATH,
};
