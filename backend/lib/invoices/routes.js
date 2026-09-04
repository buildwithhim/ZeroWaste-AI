/**
 * Admin-only invoice routes.
 *
 * Every route in this router sits behind requireAdmin. Invoice data is not
 * exposed anywhere else in the API, and there is deliberately no route that
 * filters invoices by employee — the records carry no employee identifier and
 * must not become a way to observe an individual's purchases.
 */

const express = require("express");
const fs = require("fs");
const multer = require("multer");
const path = require("path");

const { MAX_FILE_BYTES, MAX_FILES_PER_BATCH, ERROR_CODES, OUTCOMES, STAGES } = require("./invoiceModel");
const { dataPath } = require("../dataDir");
const { requireAdmin } = require("./requireAdmin");
const { ingest } = require("./ingest");
const invoiceStore = require("./invoiceStore");
const importLog = require("./importLog");
const { buildInvoiceAnalytics } = require("./invoiceAnalytics");
const { describeDataset, refreshForecastDataset, datasetPath } = require("./forecastDataset");
const { buildInvoicePipeline } = require("./invoicePipeline");

const router = express.Router();

/** Uploads are held in memory: they are small, and nothing untrusted is ever
 *  written to disk before validation has run. */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_BYTES, files: MAX_FILES_PER_BATCH },
});

router.use(requireAdmin);

/** Reference data so the UI can explain outcomes without duplicating strings. */
router.get("/meta", (req, res) => {
  res.json({
    stages: STAGES,
    outcomes: Object.values(OUTCOMES),
    errorCodes: ERROR_CODES,
    limits: { maxFileBytes: MAX_FILE_BYTES, maxFilesPerBatch: MAX_FILES_PER_BATCH },
  });
});

/** Stage 1 entry point: accept PDFs and run the whole pipeline over them. */
router.post("/import", upload.array("invoices", MAX_FILES_PER_BATCH), async (req, res) => {
  const files = (req.files || []).map((file) => ({ fileName: file.originalname, buffer: file.buffer }));
  if (files.length === 0) return res.status(400).json({ error: "Attach at least one PDF as 'invoices'" });

  try {
    res.status(201).json(await ingest(files, { actor: req.actor, source: "upload" }));
  } catch (error) {
    console.error("Invoice import failed:", error.message);
    res.status(error.status || 500).json({ error: error.message || "Import failed" });
  }
});

/**
 * Imports the PDFs bundled in data/invoices.
 *
 * The drop folder is a fixed server-side path and the request cannot influence
 * it, so this is not a way to read arbitrary files off the host.
 */
router.post("/scan", async (req, res) => {
  const folder = dataPath("invoices");

  try {
    if (!fs.existsSync(folder)) return res.status(404).json({ error: "No invoice drop folder on the server" });

    const files = fs
      .readdirSync(folder)
      .filter((name) => name.toLowerCase().endsWith(".pdf"))
      .map((name) => ({ fileName: name, buffer: fs.readFileSync(path.join(folder, name)) }));

    if (files.length === 0) return res.status(400).json({ error: "The invoice drop folder is empty" });

    res.status(201).json(await ingest(files, { actor: req.actor, source: "drop-folder" }));
  } catch (error) {
    console.error("Invoice scan failed:", error.message);
    res.status(error.status || 500).json({ error: error.message || "Scan failed" });
  }
});

/** Stored invoices, newest first. Supports light filtering for the table. */
router.get("/records", (req, res) => {
  const { cafeteria, from, to, search } = req.query;
  const limit = Math.min(Number(req.query.limit) || 100, 500);

  let records = invoiceStore.listRecords();
  if (cafeteria) records = records.filter((record) => record.cafeteria === cafeteria);
  if (from) records = records.filter((record) => record.orderDate >= from);
  if (to) records = records.filter((record) => record.orderDate <= to);
  if (search) {
    const needle = String(search).toLowerCase();
    records = records.filter(
      (record) =>
        record.orderId.toLowerCase().includes(needle) ||
        record.items.some((item) => item.foodItem.toLowerCase().includes(needle))
    );
  }

  const sorted = [...records].sort((a, b) =>
    b.orderDate.localeCompare(a.orderDate) || b.orderTime.localeCompare(a.orderTime)
  );

  res.json({ total: records.length, records: sorted.slice(0, limit) });
});

router.get("/analytics", (req, res) => {
  try {
    res.json(buildInvoiceAnalytics(invoiceStore.listRecords()));
  } catch (error) {
    console.error("Invoice analytics failed:", error.message);
    res.status(500).json({ error: "Analytics unavailable" });
  }
});

/** Batch history for the import log panel. */
router.get("/history", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 25, 100);
  res.json({ batches: importLog.listBatches(limit) });
});

/** The append-only audit trail, newest first. */
router.get("/audit", (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  res.json({ entries: importLog.readAudit(limit) });
});

router.get("/conflicts", (req, res) => {
  const status = req.query.status;
  res.json({ conflicts: invoiceStore.listConflicts(status === "all" ? undefined : status || "unresolved") });
});

/**
 * Applies an administrator's decision. This is the only way a stored invoice
 * can be replaced, and the previous version is retained on the record.
 */
router.post("/conflicts/:id/resolve", (req, res) => {
  const { action } = req.body || {};
  const result = invoiceStore.resolveConflict(req.params.id, action, req.actor);
  if (!result.ok) return res.status(400).json({ error: result.error });

  importLog.recordResolution({ conflictId: req.params.id, orderId: result.conflict.orderId, action, actor: req.actor });

  // The dataset changes whenever a stored record does.
  let dataset = null;
  if (action === "accept-incoming") {
    try {
      dataset = refreshForecastDataset(invoiceStore.listRecords());
    } catch (error) {
      console.warn("Dataset refresh after resolution failed:", error.message);
    }
  }

  res.json({ resolved: true, action, conflict: result.conflict, dataset });
});

router.get("/dataset", (req, res) => {
  res.json(describeDataset(invoiceStore.listRecords()));
});

/**
 * Downloads the generated training CSV.
 *
 * The bytes are read and sent directly rather than with res.sendFile, which
 * refuses any path containing a dot-directory and would 404 on a perfectly
 * readable file whenever the app is deployed under one (".copilot", ".local").
 */
router.get("/dataset/download", (req, res) => {
  const target = datasetPath();
  let csv;
  try {
    csv = fs.readFileSync(target);
  } catch {
    return res.status(404).json({ error: "No dataset has been generated yet" });
  }

  res
    .type("text/csv")
    .set("Content-Disposition", `attachment; filename="${path.basename(target)}"`)
    .send(csv);
});

/**
 * Serves an original PDF from the vault.
 *
 * The hash is validated as 64 hex characters inside readRaw, so the path
 * cannot be steered outside the vault directory.
 */
router.get("/raw/:hash", (req, res) => {
  const buffer = invoiceStore.readRaw(req.params.hash);
  if (!buffer) return res.status(404).json({ error: "Original invoice not found in the vault" });

  importLog.audit({ event: "invoice.raw.viewed", actor: req.actor, contentHash: req.params.hash });
  res.type("application/pdf").set("Content-Disposition", `inline; filename="${req.params.hash.slice(0, 12)}.pdf"`).send(buffer);
});

router.get("/pipeline", (req, res) => {
  const records = invoiceStore.listRecords();
  res.json(
    buildInvoicePipeline({
      records,
      conflicts: invoiceStore.listConflicts(),
      batches: importLog.listBatches(100),
      analytics: buildInvoiceAnalytics(records),
      dataset: describeDataset(records),
    })
  );
});

/** Multer rejects oversized or excessive uploads before the handler runs. */
router.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    const message =
      error.code === "LIMIT_FILE_SIZE"
        ? `${ERROR_CODES.TOO_LARGE} (limit ${MAX_FILE_BYTES / (1024 * 1024)} MB)`
        : error.code === "LIMIT_FILE_COUNT"
          ? `A batch may contain at most ${MAX_FILES_PER_BATCH} files`
          : error.message;
    return res.status(413).json({ error: message, code: error.code });
  }
  return next(error);
});

module.exports = router;
