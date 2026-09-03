/**
 * Stage 3: normalization.
 *
 * Extraction returns what is printed on the invoice; this turns it into typed,
 * comparable values. Normalising before duplicate detection matters: two files
 * that print "19-Aug 2026" and "19-Aug-2026" are the same invoice, and would
 * otherwise be stored twice.
 */

const { ERROR_CODES } = require("./invoiceModel");

const MONTHS = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Collapses runs of whitespace and trims; PDF text is full of stray spacing. */
const tidy = (value) => String(value || "").replace(/\s+/g, " ").trim();

/**
 * Confirms a y/m/d triple is a date that actually exists, so "2026-13-08" and
 * "2026-02-31" are refused rather than silently rolled forward by Date into a
 * different — and plausible-looking — day.
 */
function isoIfReal(year, month, day) {
  const y = Number(year);
  const m = Number(month);
  const d = Number(day);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/**
 * SmartQ prints "19-Aug 2026". Related exports use "19-Aug-2026",
 * "19 Aug 2026" or an ISO date, so all four are accepted and returned as ISO.
 * Returns null when the value cannot be interpreted rather than guessing.
 */
function normaliseDate(raw) {
  const value = tidy(raw);
  if (!value) return null;

  const iso = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isoIfReal(iso[1], iso[2], iso[3]);

  const named = value.match(/^(\d{1,2})[-\s]([A-Za-z]{3,})[-\s,]*(\d{4})$/);
  if (named) {
    const month = MONTHS[named[2].slice(0, 3).toLowerCase()];
    if (!month) return null;
    return isoIfReal(named[3], month, named[1]);
  }

  const numeric = value.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numeric) {
    // SmartQ is an Indian service, so day-first is the correct reading. A
    // month-first export like "08/13/2026" has no valid day-first reading and
    // is refused here rather than stored as an impossible date.
    return isoIfReal(numeric[3], numeric[2], numeric[1]);
  }

  return null;
}

/** "03:53 PM" becomes "15:53". Returns null when unreadable. */
function normaliseTime(raw) {
  const value = tidy(raw).toUpperCase();
  if (!value) return null;

  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(AM|PM)?/);
  if (!match) return null;

  let hours = Number(match[1]);
  const minutes = match[2];
  const meridiem = match[4];

  if (meridiem === "PM" && hours < 12) hours += 12;
  if (meridiem === "AM" && hours === 12) hours = 0;
  if (hours > 23 || Number(minutes) > 59) return null;

  return `${String(hours).padStart(2, "0")}:${minutes}`;
}

/**
 * Weekday for the forecasting dataset; noon UTC avoids any shift at midnight.
 * Returns null rather than an out-of-range lookup so a bad date can never reach
 * the training CSV as a blank column.
 */
const weekdayFor = (isoDate) => {
  const day = new Date(`${isoDate}T12:00:00Z`).getUTCDay();
  return Number.isNaN(day) ? null : WEEKDAYS[day];
};

/** "Microsoft Pune - CMZ" — trailing separators and label echoes removed. */
const normaliseCafeteria = (raw) => tidy(raw).replace(/^[:\-\s]+/, "").replace(/[,\-\s]+$/, "") || "Unknown cafeteria";

/** Vendor legal suffixes are kept: they distinguish operating entities. */
const normaliseVendor = (raw) => tidy(raw).replace(/[,\-\s]+$/, "") || "Unknown vendor";

/**
 * Builds the stored record. Returns { ok: false, code, message } when a value
 * survived extraction but cannot be made sense of — a quantity of "many" or a
 * date the parser cannot read is a parsing error, not a valid record.
 */
function normalise(fields, source = {}) {
  const orderDate = normaliseDate(fields.orderDate);
  if (!orderDate) {
    return { ok: false, code: "BAD_DATE", message: `${ERROR_CODES.BAD_DATE}: "${tidy(fields.orderDate)}"` };
  }

  const items = [];
  for (const item of fields.items || []) {
    const quantity = Number(item.quantity);
    const amount = Number(item.amount);
    const foodItem = tidy(item.foodItem);

    if (!Number.isFinite(quantity) || quantity <= 0) {
      return { ok: false, code: "BAD_QUANTITY", message: `${ERROR_CODES.BAD_QUANTITY} for "${foodItem}"` };
    }
    if (!Number.isFinite(amount) || amount < 0) {
      return { ok: false, code: "BAD_AMOUNT", message: `${ERROR_CODES.BAD_AMOUNT} for "${foodItem}"` };
    }

    items.push({
      foodItem,
      hsnCode: tidy(item.hsnCode),
      quantity,
      amount: Number(amount.toFixed(2)),
      unitAmount: Number((amount / quantity).toFixed(2)),
    });
  }

  if (items.length === 0) {
    return { ok: false, code: "NO_LINE_ITEMS", message: ERROR_CODES.NO_LINE_ITEMS };
  }

  const totalQuantity = items.reduce((sum, item) => sum + item.quantity, 0);
  const totalAmount = Number(items.reduce((sum, item) => sum + item.amount, 0).toFixed(2));

  return {
    ok: true,
    record: {
      // Order numbers are case-insensitive in SmartQ exports; upper-casing here
      // keeps duplicate detection from being fooled by "#g1004987".
      orderId: tidy(fields.orderId).toUpperCase(),
      orderDate,
      orderTime: normaliseTime(fields.orderTime) || "00:00",
      weekday: weekdayFor(orderDate),
      cafeteria: normaliseCafeteria(fields.cafeteria),
      vendor: normaliseVendor(fields.vendor),
      siteCode: tidy(fields.siteCode) || null,
      gstin: tidy(fields.gstin) || null,
      currency: fields.currencyHint === "points" ? "points" : "INR",
      items,
      totalQuantity,
      totalAmount,
      source: {
        fileName: source.fileName || null,
        contentHash: source.contentHash || null,
        pageCount: fields.pageCount || 1,
      },
    },
  };
}

module.exports = { normalise, normaliseDate, normaliseTime, normaliseCafeteria, normaliseVendor, weekdayFor };
