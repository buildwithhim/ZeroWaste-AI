/**
 * Stage 7: the forecasting dataset.
 *
 * Turns stored invoices into the shape the demand model already trains on
 * (weekday, menu, orders — see data/history_dataset.csv), so purchase history
 * extracted from SmartQ can extend the training set rather than sitting in a
 * separate silo.
 *
 * Invoices are per-order, while the model reasons about how many servings of a
 * menu family go out on a given weekday. Rows are therefore grouped by
 * (date, cafeteria, menu family) and summed, then emitted per weekday.
 */

const fs = require("fs");
const path = require("path");

const { invoiceMenuFamily } = require("./menuMapping");

const { dataDir, dataPath } = require("../dataDir");

const datasetPath = () => dataPath("invoice_orders_dataset.csv");

/**
 * Aggregates records into daily per-family order counts.
 *
 * Grouping by date first (not straight to weekday) keeps each service day as
 * one observation; collapsing to weekday immediately would merge three separate
 * Tuesdays into a single inflated row.
 */
function buildDataset(records) {
  const daily = new Map();

  for (const record of records) {
    const currency = record.currency || "points";
    for (const item of record.items || []) {
      const menu = invoiceMenuFamily(item.foodItem);
      // Currency is part of the key: summing points and rupees into one bucket
      // would put a meaningless amount into the training set.
      const key = `${record.orderDate}|${record.cafeteria}|${menu}|${currency}`;
      const bucket = daily.get(key) || {
        date: record.orderDate,
        weekday: record.weekday,
        cafeteria: record.cafeteria,
        menu,
        orders: 0,
        amount: 0,
        currency,
      };
      bucket.orders += item.quantity;
      bucket.amount += item.amount;
      daily.set(key, bucket);
    }
  }

  return [...daily.values()]
    .map((row) => ({ ...row, amount: Number(row.amount.toFixed(2)) }))
    .sort((a, b) => (a.date === b.date ? a.menu.localeCompare(b.menu) : a.date.localeCompare(b.date)));
}

const CSV_HEADER = "date,weekday,cafeteria,menu,orders,amount,currency";

/** Quotes a field only when it contains a comma or quote. */
function csvField(value) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(rows) {
  const lines = rows.map((row) =>
    [row.date, row.weekday, row.cafeteria, row.menu, row.orders, row.amount, row.currency].map(csvField).join(",")
  );
  return [CSV_HEADER, ...lines].join("\n") + "\n";
}

/** Writes the dataset atomically so a reader never sees a half-written file. */
function refreshForecastDataset(records) {
  const rows = buildDataset(records);
  fs.mkdirSync(dataDir(), { recursive: true });
  const target = datasetPath();
  const tempPath = `${target}.tmp`;
  fs.writeFileSync(tempPath, toCsv(rows));
  fs.renameSync(tempPath, target);

  return { rows: rows.length, fileName: path.basename(target), path: target, generatedAt: new Date().toISOString() };
}

/** Summary for the admin screen, without writing anything. */
function describeDataset(records) {
  const rows = buildDataset(records);
  const dates = [...new Set(rows.map((row) => row.date))].sort();

  // `rows` is what the records *would* produce; `fileWritten` is whether the
  // CSV actually reached disk. They can disagree when a write failed, and the
  // screen must not offer a download for a file that is not there.
  let generatedAt = null;
  let fileWritten = false;
  try {
    generatedAt = fs.statSync(datasetPath()).mtime.toISOString();
    fileWritten = true;
  } catch {
    generatedAt = null;
    fileWritten = false;
  }

  return {
    rows: rows.length,
    fileName: path.basename(datasetPath()),
    generatedAt,
    fileWritten,
    totalOrders: rows.reduce((sum, row) => sum + row.orders, 0),
    menuFamilies: [...new Set(rows.map((row) => row.menu))].sort(),
    dateRange: dates.length ? { from: dates[0], to: dates[dates.length - 1], days: dates.length } : null,
    preview: rows.slice(0, 12),
  };
}

module.exports = { buildDataset, refreshForecastDataset, describeDataset, toCsv, datasetPath };
