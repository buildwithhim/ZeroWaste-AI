/**
 * The ingestion pipeline, end to end.
 *
 *   PDF -> validation -> extraction -> normalization -> duplicate detection
 *       -> database -> analytics -> forecasting dataset
 *
 * A batch is processed as a whole so one bad file cannot abort the rest: every
 * file resolves to exactly one outcome (imported, duplicate, conflict or
 * rejected) and carries the stage it stopped at, which is what the Invoice Sync
 * screen displays.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { MAX_FILES_PER_BATCH, OUTCOMES } = require("./invoiceModel");
const { validateFile, contentHash, safeFileName } = require("./validation");
const { normalise } = require("./normalization");
const invoiceStore = require("./invoiceStore");
const importLog = require("./importLog");
const { refreshForecastDataset } = require("./forecastDataset");
const aiService = require("../aiService");
const { logger } = require("../logger");

/**
 * Runs the extractor over a set of temp files.
 *
 * Files are written to a temp directory first because pdfplumber needs a real
 * path, and uploads arrive as buffers held in memory. When the extractor runs
 * as a separate service the bytes are sent instead of the paths -- that
 * difference lives entirely in lib/aiService.js.
 */
const runExtractor = (files) => aiService.extractInvoices(files);

/**
 * Ingests a batch.
 *
 * @param {Array<{fileName: string, buffer: Buffer}>} incoming
 * @param {{actor?: string, source?: string}} context
 */
async function ingest(incoming, context = {}) {
  const batchId = `imp_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;
  const actor = context.actor || "admin";
  const startedAt = new Date().toISOString();

  if (incoming.length > MAX_FILES_PER_BATCH) {
    throw Object.assign(new Error(`A batch may contain at most ${MAX_FILES_PER_BATCH} files`), { status: 413 });
  }

  const results = [];
  const pending = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "zerowaste-invoices-"));

  try {
    // Stage 1: validation. Rejects never reach the parser.
    for (const file of incoming) {
      const fileName = safeFileName(file.fileName);
      const check = validateFile(file.buffer, fileName);

      if (!check.ok) {
        results.push({ fileName, outcome: OUTCOMES.REJECTED, stage: "validation", code: check.code, message: check.message });
        continue;
      }

      const hash = contentHash(file.buffer);
      const tempPath = path.join(tempDir, `${hash}.pdf`);
      fs.writeFileSync(tempPath, file.buffer);
      pending.push({ id: hash, path: tempPath, fileName, buffer: file.buffer, contentHash: hash, warning: check.warning });
    }

    // Stage 2: extraction, in one call for the whole batch.
    let extracted = [];
    if (pending.length > 0) {
      try {
        extracted = await runExtractor(
          pending.map(({ id, path: filePath, buffer }) => ({ id, path: filePath, buffer }))
        );
      } catch (error) {
        for (const file of pending) {
          results.push({
            fileName: file.fileName,
            contentHash: file.contentHash,
            outcome: OUTCOMES.REJECTED,
            stage: "extraction",
            code: "UNREADABLE_PDF",
            message: `Extractor unavailable: ${error.message}`,
          });
        }
        pending.length = 0;
      }
    }

    const byId = new Map(extracted.map((result) => [result.id, result]));

    for (const file of pending) {
      const result = byId.get(file.contentHash);

      if (!result || !result.ok) {
        results.push({
          fileName: file.fileName,
          contentHash: file.contentHash,
          outcome: OUTCOMES.REJECTED,
          stage: "extraction",
          code: result?.code || "UNREADABLE_PDF",
          message: result?.message || "The extractor returned no result for this file",
        });
        continue;
      }

      // Stage 3: normalization.
      const normalised = normalise(result.fields, { fileName: file.fileName, contentHash: file.contentHash });
      if (!normalised.ok) {
        results.push({
          fileName: file.fileName,
          contentHash: file.contentHash,
          outcome: OUTCOMES.REJECTED,
          stage: "normalization",
          code: normalised.code,
          message: normalised.message,
        });
        continue;
      }

      // Stages 4 and 5: duplicate detection, then storage if genuinely new.
      const outcome = invoiceStore.insert(normalised.record, { batchId, fileName: file.fileName });

      // The original is vaulted for anything we accepted or must adjudicate, so
      // an administrator can always compare against the source document.
      if (outcome.outcome !== OUTCOMES.DUPLICATE) {
        await invoiceStore.storeRaw(file.buffer, file.contentHash);
      }

      results.push({
        fileName: file.fileName,
        contentHash: file.contentHash,
        outcome: outcome.outcome,
        stage: outcome.outcome === OUTCOMES.IMPORTED ? "database" : "duplicate-detection",
        orderId: normalised.record.orderId,
        orderDate: normalised.record.orderDate,
        cafeteria: normalised.record.cafeteria,
        totalAmount: normalised.record.totalAmount,
        currency: normalised.record.currency,
        itemCount: normalised.record.items.length,
        reason: outcome.reason || null,
        conflictId: outcome.conflict?.id || null,
        changes: outcome.conflict?.changes || null,
        warning: file.warning || null,
      });
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const count = (outcome) => results.filter((item) => item.outcome === outcome).length;
  const summary = {
    received: incoming.length,
    imported: count(OUTCOMES.IMPORTED),
    duplicates: count(OUTCOMES.DUPLICATE),
    conflicts: count(OUTCOMES.CONFLICT),
    rejected: count(OUTCOMES.REJECTED),
  };

  // Stage 7: refresh the training export whenever new rows landed.
  let dataset = null;
  if (summary.imported > 0) {
    try {
      dataset = refreshForecastDataset(invoiceStore.listRecords());
    } catch (error) {
      logger.warn("forecast dataset refresh failed", { error });
    }
  }

  const batch = {
    id: batchId,
    startedAt,
    finishedAt: new Date().toISOString(),
    actor,
    source: context.source || "upload",
    summary,
    dataset: dataset ? { rows: dataset.rows, path: dataset.fileName } : null,
    files: results,
  };

  importLog.recordBatch(batch);
  return batch;
}

module.exports = { ingest };
