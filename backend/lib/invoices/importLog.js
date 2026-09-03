/**
 * Import history and audit log.
 *
 * Two artefacts with different jobs:
 *
 *   - `invoice_imports.json` is the batch history the Invoice Sync screen
 *     shows: who ran an import, when, and how each file was classified.
 *   - `invoice_audit.log` is an append-only JSONL trail. Every file decision
 *     and every conflict resolution appends one line and nothing ever rewrites
 *     it, so the record of what happened survives even if the store is reset.
 */

const fs = require("fs");
const path = require("path");

const DATA_DIR = path.join(__dirname, "..", "..", "..", "data");
const HISTORY_PATH = path.join(DATA_DIR, "invoice_imports.json");
const AUDIT_PATH = path.join(DATA_DIR, "invoice_audit.log");

const MAX_HISTORY_BATCHES = 200;

function readHistory() {
  try {
    const parsed = JSON.parse(fs.readFileSync(HISTORY_PATH, "utf8"));
    return Array.isArray(parsed.batches) ? parsed.batches : [];
  } catch {
    return [];
  }
}

function writeHistory(batches) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tempPath = `${HISTORY_PATH}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify({ version: 1, batches }, null, 2));
  fs.renameSync(tempPath, HISTORY_PATH);
}

/**
 * Appends one immutable line to the audit trail.
 *
 * Uses appendFileSync rather than a read-modify-write so a crash mid-import
 * cannot truncate earlier entries, and so the file is never open for rewriting.
 */
function audit(event) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const line = JSON.stringify({ at: new Date().toISOString(), ...event });
  fs.appendFileSync(AUDIT_PATH, `${line}\n`, { mode: 0o600 });
}

/** Records a completed batch and audits every file decision within it. */
function recordBatch(batch) {
  const batches = readHistory();
  batches.unshift(batch);
  writeHistory(batches.slice(0, MAX_HISTORY_BATCHES));

  audit({
    event: "import.batch",
    batchId: batch.id,
    actor: batch.actor,
    source: batch.source,
    filesReceived: batch.summary.received,
    imported: batch.summary.imported,
    duplicates: batch.summary.duplicates,
    conflicts: batch.summary.conflicts,
    rejected: batch.summary.rejected,
  });

  for (const file of batch.files) {
    audit({
      event: "import.file",
      batchId: batch.id,
      actor: batch.actor,
      fileName: file.fileName,
      contentHash: file.contentHash,
      outcome: file.outcome,
      orderId: file.orderId || null,
      stage: file.stage || null,
      code: file.code || null,
      message: file.message || null,
    });
  }

  return batch;
}

/** Audits an administrator's explicit decision to keep or replace a record. */
function recordResolution({ conflictId, orderId, action, actor }) {
  audit({ event: "conflict.resolved", conflictId, orderId, action, actor });
}

const listBatches = (limit = 25) => readHistory().slice(0, limit);
const findBatch = (batchId) => readHistory().find((batch) => batch.id === batchId) || null;

/** Most recent audit lines, newest first, for the admin activity feed. */
function readAudit(limit = 100) {
  try {
    return fs
      .readFileSync(AUDIT_PATH, "utf8")
      .split("\n")
      .filter(Boolean)
      .slice(-limit)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .reverse();
  } catch {
    return [];
  }
}

module.exports = { recordBatch, recordResolution, listBatches, findBatch, readAudit, audit, HISTORY_PATH, AUDIT_PATH };
