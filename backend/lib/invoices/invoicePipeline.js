/**
 * The ingestion pipeline expressed as data, so the admin screen and the API
 * describe the same seven stages rather than each keeping its own copy.
 *
 *   PDF -> validation -> extraction -> normalization -> duplicate detection
 *       -> database -> analytics -> forecasting dataset
 */

const { STAGES } = require("./invoiceModel");

const STAGE_DEFINITIONS = [
  {
    key: "validation",
    name: "Validation",
    owner: "backend/lib/invoices/validation.js",
    input: "Uploaded bytes",
    output: "Accepted file or a typed rejection",
    detail: "Checks size, extension and the %PDF header before any parsing, so a renamed spreadsheet or an empty upload is refused immediately.",
  },
  {
    key: "extraction",
    name: "Extraction",
    owner: "backend/parse_invoices.py",
    input: "Accepted PDF",
    output: "Printed field values",
    detail: "Reads the SmartQ KOT layout with pdfplumber. Line items are anchored on the HSN code so product names containing brackets stay intact.",
  },
  {
    key: "normalization",
    name: "Normalization",
    owner: "backend/lib/invoices/normalization.js",
    input: "Printed field values",
    output: "Typed invoice record",
    detail: "Turns \"19-Aug 2026\" into an ISO date and \"03:53 PM\" into 24-hour time, so two spellings of one invoice compare as equal.",
  },
  {
    key: "duplicate-detection",
    name: "Duplicate detection",
    owner: "backend/lib/invoices/invoiceStore.js",
    input: "Typed invoice record",
    output: "New, duplicate or conflicting",
    detail: "Matches on file hash and on order number. Identical files are ignored; the same order carrying different values is escalated, never merged.",
  },
  {
    key: "database",
    name: "Database",
    owner: "data/invoices.json + data/invoice_vault",
    input: "New invoice record",
    output: "Stored record and vaulted original",
    detail: "Writes the record and keeps the source PDF under its content hash, outside the web root and reachable only through the admin download route.",
  },
  {
    key: "analytics",
    name: "Analytics",
    owner: "backend/lib/invoices/invoiceAnalytics.js",
    input: "Stored records",
    output: "Spend and volume aggregates",
    detail: "Totals by café, vendor, item and day. Invoices carry no employee identifier, so nothing here is attributable to a person.",
  },
  {
    key: "forecast-dataset",
    name: "Forecasting dataset",
    owner: "backend/lib/invoices/forecastDataset.js",
    input: "Stored records",
    output: "data/invoice_orders_dataset.csv",
    detail: "Groups line items by date, café and menu family so real purchase history can extend the demand model's training set.",
  },
];

/**
 * Builds the live view.
 *
 * A stage counts as active only when it has actually done work: a metric of
 * zero means "nothing has flowed through here yet", which the UI shows as
 * awaiting data rather than as a healthy stage.
 */
function buildInvoicePipeline({ records = [], conflicts = [], batches = [], analytics = null, dataset = null } = {}) {
  const latest = batches[0] || null;
  const rejected = batches.reduce((sum, batch) => sum + (batch.summary?.rejected || 0), 0);
  const duplicates = batches.reduce((sum, batch) => sum + (batch.summary?.duplicates || 0), 0);
  const filesSeen = batches.reduce((sum, batch) => sum + (batch.summary?.received || 0), 0);

  const metrics = {
    validation: { value: filesSeen, unit: "files checked", note: `${rejected} rejected` },
    extraction: { value: filesSeen - rejected, unit: "documents parsed", note: `${records.length} invoices readable` },
    normalization: { value: records.length, unit: "records typed", note: "dates and times standardised" },
    "duplicate-detection": {
      value: duplicates,
      unit: "duplicates caught",
      note: `${conflicts.filter((item) => item.status === "unresolved").length} awaiting a decision`,
    },
    database: { value: records.length, unit: "invoices stored", note: "originals vaulted" },
    analytics: {
      value: analytics?.totals?.quantity || 0,
      unit: "items purchased",
      note: analytics?.totals ? `${analytics.totals.amount} ${analytics.totals.currency}` : "no spend yet",
    },
    "forecast-dataset": { value: dataset?.rows || 0, unit: "training rows", note: dataset?.fileName || "not generated" },
  };

  // A stage is active once its own metric shows throughput. Duplicate detection
  // is the exception: catching nothing is the healthy state, so it counts as
  // active as soon as any record has been through it.
  const isActive = {
    validation: () => filesSeen > 0,
    extraction: () => filesSeen - rejected > 0,
    normalization: () => records.length > 0,
    "duplicate-detection": () => records.length > 0 || duplicates > 0,
    database: () => records.length > 0,
    analytics: () => (analytics?.totals?.invoices || 0) > 0,
    "forecast-dataset": () => (dataset?.rows || 0) > 0,
  };

  const stages = STAGE_DEFINITIONS.map((stage, index) => ({
    ...stage,
    order: index + 1,
    metric: metrics[stage.key],
    status: isActive[stage.key]() ? "active" : "awaiting-data",
  }));

  return {
    generatedAt: new Date().toISOString(),
    stageOrder: STAGES,
    complete: stages.every((stage) => stage.status === "active"),
    lastImportAt: latest?.finishedAt || null,
    stages,
  };
}

module.exports = { buildInvoicePipeline, STAGE_DEFINITIONS };
