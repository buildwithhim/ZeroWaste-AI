/**
 * Stage 6: analytics over imported invoices.
 *
 * Reports spend and volume for administrators. Invoices carry no employee
 * identifier, so there is nothing to pseudonymise here — but the output is
 * still aggregate by construction, and no route returns per-employee slices,
 * because purchase detail in a small café is re-identifying when combined with
 * attendance.
 */

const { invoiceMenuFamily } = require("./menuMapping");

const round = (value) => Number(Number(value || 0).toFixed(2));

/** Groups rows and reduces each group with the supplied accumulator shape. */
function tally(records, keyFn) {
  const groups = new Map();
  for (const record of records) {
    for (const item of record.items || []) {
      const key = keyFn(record, item);
      if (key === null || key === undefined) continue;
      const bucket = groups.get(key) || { key, orders: 0, quantity: 0, amount: 0, invoices: new Set() };
      bucket.quantity += item.quantity;
      bucket.amount += item.amount;
      bucket.orders += 1;
      bucket.invoices.add(record.orderId);
      groups.set(key, bucket);
    }
  }
  return [...groups.values()].map(({ invoices, ...rest }) => ({ ...rest, amount: round(rest.amount), invoices: invoices.size }));
}

function buildInvoiceAnalytics(records) {
  if (!records || records.length === 0) {
    return {
      generatedAt: new Date().toISOString(),
      totals: { invoices: 0, items: 0, quantity: 0, amount: 0, currency: "points" },
      dateRange: null,
      topItems: [],
      byCafeteria: [],
      byVendor: [],
      byMenuFamily: [],
      dailyTrend: [],
      byWeekday: [],
      averageOrderValue: 0,
    };
  }

  // Amounts are only comparable within one currency. SmartQ invoices are
  // normally denominated in loyalty points, but an INR export mixed into the
  // same store would make a single total meaningless, so it is reported as
  // "mixed" and the aggregate is withheld rather than shown with a wrong unit.
  const currencies = [...new Set(records.map((record) => record.currency || "points"))];
  const mixedCurrency = currencies.length > 1;
  const currency = mixedCurrency ? "mixed" : currencies[0];
  const totalQuantity = records.reduce((sum, record) => sum + (record.totalQuantity || 0), 0);
  const totalAmount = records.reduce((sum, record) => sum + (record.totalAmount || 0), 0);
  const itemCount = records.reduce((sum, record) => sum + (record.items?.length || 0), 0);
  const dates = [...new Set(records.map((record) => record.orderDate))].sort();

  const topItems = tally(records, (_record, item) => item.foodItem)
    .map((row) => ({ foodItem: row.key, quantity: row.quantity, amount: row.amount, invoices: row.invoices }))
    .sort((a, b) => b.quantity - a.quantity || b.amount - a.amount)
    .slice(0, 10);

  const byCafeteria = tally(records, (record) => record.cafeteria)
    .map((row) => ({ cafeteria: row.key, quantity: row.quantity, amount: row.amount, invoices: row.invoices }))
    .sort((a, b) => b.amount - a.amount);

  const byVendor = tally(records, (record) => record.vendor)
    .map((row) => ({ vendor: row.key, quantity: row.quantity, amount: row.amount, invoices: row.invoices }))
    .sort((a, b) => b.amount - a.amount);

  const byMenuFamily = tally(records, (_record, item) => invoiceMenuFamily(item.foodItem))
    .map((row) => ({ menu: row.key, quantity: row.quantity, amount: row.amount, invoices: row.invoices }))
    .sort((a, b) => b.quantity - a.quantity);

  const dailyTrend = tally(records, (record) => record.orderDate)
    .map((row) => ({ date: row.key, quantity: row.quantity, amount: row.amount, invoices: row.invoices }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const WEEK_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const byWeekday = tally(records, (record) => record.weekday)
    .map((row) => ({ weekday: row.key, quantity: row.quantity, amount: row.amount, invoices: row.invoices }))
    .sort((a, b) => WEEK_ORDER.indexOf(a.weekday) - WEEK_ORDER.indexOf(b.weekday));

  return {
    generatedAt: new Date().toISOString(),
    totals: {
      invoices: records.length,
      items: itemCount,
      quantity: totalQuantity,
      amount: mixedCurrency ? null : round(totalAmount),
      currency,
      currencies,
    },
    dateRange: { from: dates[0], to: dates[dates.length - 1], days: dates.length },
    averageOrderValue: mixedCurrency ? null : round(totalAmount / records.length),
    topItems,
    byCafeteria,
    byVendor,
    byMenuFamily,
    dailyTrend,
    byWeekday,
  };
}

module.exports = { buildInvoiceAnalytics };
