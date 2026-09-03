/**
 * One definition of "what day is it" for the whole operations pipeline.
 *
 * The server used to answer this with `toISOString().slice(0, 10)`, which is
 * UTC, while the browser deliberately built its date keys in local time. For
 * any cafeteria west of UTC -- the workspace is branded "Redmond" -- the two
 * halves disagreed for the last several hours of every working day: from
 * mid-afternoon the server rolled over, so the kitchen was shown tomorrow's
 * plan, close-of-service actuals were filed a day forward and never met the
 * forecast they should have been graded against, and tomorrow's plan was
 * frozen early -- after which the immutable prediction log would refuse the
 * real one.
 *
 * A cafeteria serves food in its own timezone, so that is the clock the
 * pipeline runs on. Set CAFETERIA_TZ to an IANA zone (for example
 * "Asia/Kolkata" or "America/Los_Angeles"); it defaults to the host's zone,
 * which is right for a kitchen running its own server and still never silently
 * UTC.
 */

const CAFETERIA_TZ = process.env.CAFETERIA_TZ || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";

const KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", {
  timeZone: CAFETERIA_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("en-US", { timeZone: "UTC", weekday: "long" });

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The cafeteria-local date key for a value.
 *
 * A bare "YYYY-MM-DD" is already a calendar date and is returned untouched:
 * re-parsing it would drag it through UTC midnight and shift it a day for
 * anywhere east or west of the line.
 */
function toDateKey(value) {
  if (typeof value === "string" && DATE_KEY_PATTERN.test(value)) return value;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid date: ${value}`);
  return KEY_FORMATTER.format(date);
}

/** Today, on the cafeteria's clock. */
const todayKey = () => KEY_FORMATTER.format(new Date());

/**
 * Weekday name for a date key. Read at noon UTC so no timezone offset can push
 * the instant across a day boundary and rename the day.
 */
const weekdayOf = (dateKey) => WEEKDAY_FORMATTER.format(new Date(`${toDateKey(dateKey)}T12:00:00Z`));

module.exports = { CAFETERIA_TZ, toDateKey, todayKey, weekdayOf, DATE_KEY_PATTERN };
