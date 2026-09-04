/**
 * Stage 5: the invoice database, plus the vault holding the original PDFs.
 *
 * ACCESS CONTRACT
 * ---------------
 * Invoice records describe cafeteria purchases, not people: nothing written
 * here carries an employee identifier, and the extractor does not read one off
 * the PDF. Access is nonetheless restricted to administrators at the route
 * layer, because order-level detail for a small café is re-identifying in
 * aggregate. No employee-facing route reads from this module.
 *
 * NEVER OVERWRITE SILENTLY
 * ------------------------
 * `insert` refuses to modify a stored record. A re-import carrying different
 * values for an order number already on file is parked in `conflicts` for an
 * administrator to resolve explicitly; only `resolveConflict` can replace a
 * record, and it writes the previous version into the record's history.
 */

const fs = require("fs");
const path = require("path");

const { COMPARABLE_FIELDS } = require("./invoiceModel");

const { dataDir, dataPath } = require("../dataDir");

const storePath = () => dataPath("invoices.json");

/**
 * Original PDFs live outside the web root and are never mounted as static
 * files; the only way out is the admin-guarded download route. Files are named
 * by content hash so a hostile upload name cannot influence the path.
 */
const vaultDir = () => dataPath("invoice_vault");

const emptyStore = () => ({ version: 1, records: [], conflicts: [] });

function readStore() {
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath(), "utf8"));
    return {
      version: 1,
      records: Array.isArray(parsed.records) ? parsed.records : [],
      conflicts: Array.isArray(parsed.conflicts) ? parsed.conflicts : [],
    };
  } catch {
    return emptyStore();
  }
}

function writeStore(store) {
  fs.mkdirSync(dataDir(), { recursive: true });
  const target = storePath();
  const tempPath = `${target}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(store, null, 2));
  fs.renameSync(tempPath, target);
}

/** Persists the original bytes. Returns the vault-relative name. */
function storeRaw(buffer, contentHash) {
  const vault = vaultDir();
  fs.mkdirSync(vault, { recursive: true });
  const target = path.join(vault, `${contentHash}.pdf`);
  // Identical content is stored once; the hash guarantees the bytes match.
  if (!fs.existsSync(target)) {
    fs.writeFileSync(target, buffer, { mode: 0o600 });
  }
  return path.basename(target);
}

/** Reads an original back. The hash is validated to keep the path inside the vault. */
function readRaw(contentHash) {
  if (!/^[a-f0-9]{64}$/.test(String(contentHash || ""))) return null;
  const target = path.join(vaultDir(), `${contentHash}.pdf`);
  return fs.existsSync(target) ? fs.readFileSync(target) : null;
}

/** Field-by-field difference between a stored record and an incoming one. */
function diffRecords(existing, incoming) {
  const changes = [];
  for (const field of COMPARABLE_FIELDS) {
    if (String(existing[field] ?? "") !== String(incoming[field] ?? "")) {
      changes.push({ field, existing: existing[field] ?? null, incoming: incoming[field] ?? null });
    }
  }

  const itemKey = (items) => (items || []).map((i) => `${i.foodItem}|${i.quantity}|${i.amount}`).sort().join("; ");
  if (itemKey(existing.items) !== itemKey(incoming.items)) {
    changes.push({ field: "items", existing: itemKey(existing.items), incoming: itemKey(incoming.items) });
  }

  return changes;
}

const findByOrderId = (store, orderId) => store.records.find((record) => record.orderId === orderId);
const findByHash = (store, hash) => store.records.find((record) => record.source?.contentHash === hash);

/**
 * Stage 4 and 5 together: classify the incoming record, then store it only if
 * it is genuinely new.
 *
 * Duplicate detection uses two keys because they mean different things:
 *   - the same content hash is the same file uploaded twice;
 *   - the same order number with different bytes is the same invoice re-issued,
 *     which is either a harmless re-export or a correction.
 * Only the first is safe to discard without review.
 */
function insert(record, context = {}) {
  const store = readStore();

  const byHash = findByHash(store, record.source?.contentHash);
  if (byHash) {
    return { outcome: "duplicate", reason: "identical-file", existing: byHash, record: byHash };
  }

  const byOrderId = findByOrderId(store, record.orderId);
  if (byOrderId) {
    const changes = diffRecords(byOrderId, record);

    if (changes.length === 0) {
      // Same invoice, re-exported to a different file. Nothing to change, but
      // remember the extra hash so the next upload of it is a cheap match.
      byOrderId.alternateHashes = Array.from(new Set([...(byOrderId.alternateHashes || []), record.source.contentHash]));
      writeStore(store);
      return { outcome: "duplicate", reason: "same-order-different-file", existing: byOrderId, record: byOrderId };
    }

    const conflictId = `${record.orderId}-${record.source.contentHash.slice(0, 8)}`;
    const priorConflict = store.conflicts.find((item) => item.id === conflictId);

    // This exact disagreement has already been adjudicated. Raising it again
    // would ask the administrator to re-make a decision they have made, so the
    // upload is reported as a duplicate that carries the standing decision.
    if (priorConflict && priorConflict.status !== "unresolved") {
      return {
        outcome: "duplicate",
        reason: "previously-resolved-conflict",
        existing: byOrderId,
        record: byOrderId,
        resolution: { conflictId, status: priorConflict.status, resolvedAt: priorConflict.resolvedAt },
      };
    }

    if (priorConflict) {
      return { outcome: "conflict", reason: "values-differ", conflict: priorConflict, existing: byOrderId };
    }

    // Values disagree. Storing either version automatically would destroy
    // information, so the decision is escalated instead.
    const conflict = {
      id: conflictId,
      orderId: record.orderId,
      detectedAt: new Date().toISOString(),
      fileName: context.fileName || record.source.fileName,
      batchId: context.batchId || null,
      changes,
      existing: byOrderId,
      incoming: record,
      status: "unresolved",
    };

    store.conflicts.push(conflict);
    writeStore(store);

    return { outcome: "conflict", reason: "values-differ", conflict, existing: byOrderId };
  }

  const stored = {
    ...record,
    importedAt: new Date().toISOString(),
    batchId: context.batchId || null,
    history: [],
  };
  store.records.push(stored);
  writeStore(store);
  return { outcome: "imported", record: stored };
}

/**
 * Applies an administrator's decision about a conflict.
 *
 * `accept-incoming` is the only path that replaces a stored record, and it
 * keeps the superseded version in `history` so the earlier figures remain
 * auditable.
 */
function resolveConflict(conflictId, action, actor = "admin") {
  const store = readStore();
  const conflict = store.conflicts.find((item) => item.id === conflictId && item.status === "unresolved");
  if (!conflict) return { ok: false, error: "Conflict not found or already resolved" };

  const resolvedAt = new Date().toISOString();

  if (action === "accept-incoming") {
    const index = store.records.findIndex((record) => record.orderId === conflict.orderId);
    if (index === -1) return { ok: false, error: "The record this conflict refers to no longer exists" };

    const previous = store.records[index];

    // The conflict was raised against a snapshot. If another decision has moved
    // the stored record since then, applying this one would quietly revert that
    // newer decision, so the administrator is sent back to look again.
    if (diffRecords(previous, conflict.existing).length > 0) {
      conflict.existing = previous;
      conflict.changes = diffRecords(previous, conflict.incoming);
      writeStore(store);
      if (conflict.changes.length === 0) {
        return { ok: false, error: "The stored record already matches this invoice; there is nothing left to decide." };
      }
      return {
        ok: false,
        error: "The stored record changed after this conflict was raised. The comparison has been refreshed — please review it again.",
        conflict,
      };
    }

    store.records[index] = {
      ...conflict.incoming,
      importedAt: previous.importedAt,
      revisedAt: resolvedAt,
      batchId: conflict.batchId,
      history: [
        ...(previous.history || []),
        {
          replacedAt: resolvedAt,
          by: actor,
          reason: "conflict-resolution",
          record: { ...stripHistory(previous), supersededAt: resolvedAt },
        },
      ],
    };
  } else if (action !== "keep-existing") {
    return { ok: false, error: 'action must be "accept-incoming" or "keep-existing"' };
  }

  conflict.status = action === "accept-incoming" ? "replaced" : "kept-existing";
  conflict.resolvedAt = resolvedAt;
  conflict.resolvedBy = actor;
  writeStore(store);

  return { ok: true, conflict, action };
}

const stripHistory = ({ history: _history, ...rest }) => rest;

const listRecords = () => readStore().records;

/**
 * Filters conflicts by status. "resolved" is a convenience for either terminal
 * status, so a caller asking for resolved conflicts does not silently get an
 * empty list just because the decision was recorded as "replaced".
 *
 * Unresolved conflicts are re-diffed against the record as it stands *now*. A
 * conflict snapshots the stored record at detection time, and an earlier
 * decision on the same order can move that record underneath it — showing the
 * stale snapshot would ask an administrator to adjudicate against a version
 * that is no longer stored.
 */
const listConflicts = (status) => {
  const store = readStore();
  const conflicts = store.conflicts;
  const refresh = (conflict) => {
    if (conflict.status !== "unresolved") return conflict;
    const live = findByOrderId(store, conflict.orderId);
    if (!live) return { ...conflict, stale: true };
    const changes = diffRecords(live, conflict.incoming);
    if (changes.length === 0) return { ...conflict, existing: live, changes, moot: true };
    return { ...conflict, existing: live, changes };
  };

  if (!status || status === "all") return conflicts.map(refresh);
  if (status === "resolved") return conflicts.filter((item) => item.status !== "unresolved");
  // A conflict whose differences have since disappeared is not actionable, so
  // it must not be offered as something needing a decision.
  return conflicts.filter((item) => item.status === status).map(refresh).filter((item) => !item.moot);
};
const findRecord = (orderId) => findByOrderId(readStore(), String(orderId || "").toUpperCase());

/** Test and reseed helper. Clears records and conflicts but not the audit log. */
function reset() {
  writeStore(emptyStore());
}

module.exports = {
  insert,
  resolveConflict,
  listRecords,
  listConflicts,
  findRecord,
  storeRaw,
  readRaw,
  diffRecords,
  reset,
  storePath,
  vaultDir,
};
