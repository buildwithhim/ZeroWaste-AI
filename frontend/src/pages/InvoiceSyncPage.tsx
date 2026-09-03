/**
 * Invoice Sync — the admin surface for SmartQ invoice ingestion.
 *
 * Ordered around the operator's questions: what happened to the files I just
 * sent, what needs a decision from me, what does the data say, and what was
 * imported before.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  CopyCheck,
  Database,
  Download,
  FileText,
  FileWarning,
  FolderSync,
  History,
  Loader2,
  ScrollText,
  ShieldCheck,
  Upload,
} from "lucide-react";
import {
  downloadDataset,
  fetchRawInvoice,
  getAuditTrail,
  getConflicts,
  getDataset,
  getImportHistory,
  getInvoiceAnalytics,
  getInvoicePipeline,
  importInvoices,
  resolveConflict,
  scanDropFolder,
  type AuditEntry,
  type DatasetSummary,
  type ImportBatch,
  type InvoiceAnalytics,
  type InvoiceConflict,
  type InvoicePipeline,
} from "../services/invoiceService";

const OUTCOME_META: Record<string, { label: string; icon: typeof CheckCircle2; tone: string }> = {
  imported: { label: "Imported", icon: CheckCircle2, tone: "ok" },
  duplicate: { label: "Duplicate", icon: CopyCheck, tone: "dupe" },
  conflict: { label: "Needs review", icon: AlertTriangle, tone: "conflict" },
  rejected: { label: "Rejected", icon: FileWarning, tone: "bad" },
};

const REASON_TEXT: Record<string, string> = {
  "identical-file": "This exact file has already been imported.",
  "same-order-different-file": "Same order number, re-exported as a different file. Nothing changed.",
  "previously-resolved-conflict": "This disagreement was already reviewed and decided.",
  "values-differ": "Same order number but different values — a decision is needed.",
};

const formatTime = (iso: string) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
const apiError = (caught: unknown) => (caught as { response?: { data?: { error?: string } } }).response?.data?.error;

export default function InvoiceSyncPage() {
  const [batch, setBatch] = useState<ImportBatch | null>(null);
  const [busy, setBusy] = useState<"upload" | "scan" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);

  const [analytics, setAnalytics] = useState<InvoiceAnalytics | null>(null);
  const [conflicts, setConflicts] = useState<InvoiceConflict[]>([]);
  const [history, setHistory] = useState<ImportBatch[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [dataset, setDataset] = useState<DatasetSummary | null>(null);
  const [pipeline, setPipeline] = useState<InvoicePipeline | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const [a, c, h, d, p, l] = await Promise.all([
        getInvoiceAnalytics(),
        getConflicts("unresolved"),
        getImportHistory(15),
        getDataset(),
        getInvoicePipeline(),
        getAuditTrail(40),
      ]);
      setAnalytics(a.data);
      setConflicts(c.data.conflicts);
      setHistory(h.data.batches);
      setDataset(d.data);
      setPipeline(p.data);
      setAudit(l.data.entries);
      setError(null);
    } catch {
      setError("Could not reach the invoice service. Is the backend running?");
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runImport = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return;
      setBusy("upload");
      setError(null);
      try {
        const { data } = await importInvoices(files);
        setBatch(data);
        await refresh();
      } catch (caught) {
        setError(apiError(caught) || "The import failed. Nothing was stored.");
      } finally {
        setBusy(null);
      }
    },
    [refresh]
  );

  const runScan = useCallback(async () => {
    setBusy("scan");
    setError(null);
    try {
      const { data } = await scanDropFolder();
      setBatch(data);
      await refresh();
    } catch (caught) {
      setError(apiError(caught) || "The scan failed.");
    } finally {
      setBusy(null);
    }
  }, [refresh]);

  const decide = useCallback(
    async (conflict: InvoiceConflict, action: "accept-incoming" | "keep-existing") => {
      setResolving(conflict.id);
      try {
        await resolveConflict(conflict.id, action);
        await refresh();
      } catch (caught) {
        setError(
          apiError(caught) || "Could not record that decision. The stored invoice is unchanged."
        );
        await refresh();
      } finally {
        setResolving(null);
      }
    },
    [refresh]
  );

  const openOriginal = useCallback(async (hash?: string | null) => {
    if (!hash) return;
    try {
      window.open(await fetchRawInvoice(hash), "_blank", "noopener");
    } catch {
      setError("The original PDF could not be retrieved from the vault.");
    }
  }, []);

  const saveDataset = useCallback(async () => {
    try {
      await downloadDataset();
      setError(null);
    } catch {
      setError("The training CSV could not be downloaded. Import an invoice to regenerate it, then try again.");
    }
  }, []);

  const rejectedCount = useMemo(() => (batch?.files || []).filter((file) => file.outcome === "rejected").length, [batch]);
  const mixedCurrency = (analytics?.totals.currencies?.length ?? 1) > 1;
  const currency = analytics?.totals.currency ?? "points";

  return (
    <div className="page-frame admin-portal-page invoice-sync-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">INVOICE SYNC</span>
          <h1>SmartQ invoice ingestion.</h1>
          <p>Import vendor invoices, review anything ambiguous, and feed verified purchase history into the forecasting dataset.</p>
        </div>
        <span className={`loop-pill${pipeline?.complete ? " is-closed" : ""}`}>
          <Database size={13} /> {pipeline?.complete ? "Pipeline healthy" : "Awaiting data"}
        </span>
      </div>

      <p className="invoice-privacy-banner">
        <ShieldCheck size={14} />
        Administrator only. Invoices record cafeteria purchases and carry no employee identifier, and the original PDFs sit in a
        private vault that is never served publicly.
      </p>

      {error && (
        <p className="invoice-error" role="alert">
          <AlertTriangle size={14} /> {error}
        </p>
      )}

      <section className="invoice-intake">
        <div
          className={`invoice-dropzone${dragging ? " is-dragging" : ""}`}
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => {
            event.preventDefault();
            setDragging(false);
            void runImport([...event.dataTransfer.files]);
          }}
        >
          <span className="invoice-dropzone-icon">
            {busy === "upload" ? <Loader2 size={22} className="spin" /> : <Upload size={22} />}
          </span>
          <strong>Drop SmartQ invoice PDFs here</strong>
          <small>Every file is validated before anything is stored. Up to 200 files, 10 MB each.</small>
          <div className="invoice-intake-actions">
            <button type="button" className="order-button" onClick={() => fileInput.current?.click()} disabled={busy !== null}>
              <FileText size={14} /> Choose files
            </button>
            <button type="button" className="ghost-button" onClick={() => void runScan()} disabled={busy !== null}>
              {busy === "scan" ? <Loader2 size={14} className="spin" /> : <FolderSync size={14} />} Scan server folder
            </button>
          </div>
          <input
            ref={fileInput}
            type="file"
            accept="application/pdf,.pdf"
            multiple
            hidden
            onChange={(event) => {
              void runImport([...(event.target.files || [])]);
              event.target.value = "";
            }}
          />
        </div>

        {batch && (
          <motion.div className="invoice-batch-result" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="invoice-batch-heading">
              <div>
                <span className="eyebrow">LAST IMPORT</span>
                <h2>
                  {batch.summary.imported} of {batch.summary.received} stored
                </h2>
                <small>
                  {batch.source === "drop-folder" ? "Server folder" : "Upload"} · {formatTime(batch.finishedAt)}
                </small>
              </div>
              <div className="invoice-batch-counts">
                <span className="tally ok">{batch.summary.imported} imported</span>
                <span className="tally dupe">{batch.summary.duplicates} duplicate</span>
                <span className="tally conflict">{batch.summary.conflicts} to review</span>
                <span className="tally bad">{batch.summary.rejected} rejected</span>
              </div>
            </div>

            <ul className="invoice-file-list">
              {batch.files.map((file) => {
                const meta = OUTCOME_META[file.outcome];
                const Icon = meta.icon;
                return (
                  <li key={`${file.fileName}-${file.contentHash ?? file.code}`} className={`invoice-file ${meta.tone}`}>
                    <span className="invoice-file-icon">
                      <Icon size={15} />
                    </span>
                    <span className="invoice-file-body">
                      <strong>{file.fileName}</strong>
                      <small>
                        {file.outcome === "rejected"
                          ? `Stopped at ${file.stage}: ${file.message}`
                          : file.outcome === "imported"
                            ? `${file.orderId} · ${file.orderDate} · ${file.itemCount} item${file.itemCount === 1 ? "" : "s"} · ${file.totalAmount} ${file.currency}`
                            : `${file.orderId} — ${REASON_TEXT[file.reason ?? ""] ?? file.reason}`}
                      </small>
                      {file.warning && <small className="invoice-file-warning">{file.warning}</small>}
                    </span>
                    <span className={`invoice-file-badge ${meta.tone}`}>{meta.label}</span>
                  </li>
                );
              })}
            </ul>

            {rejectedCount > 0 && (
              <p className="invoice-problem-note">
                <FileWarning size={13} /> {rejectedCount} file{rejectedCount === 1 ? " was" : "s were"} rejected and stored
                nothing. Fix the source document and import again.
              </p>
            )}
          </motion.div>
        )}
      </section>

      {conflicts.length > 0 && (
        <section className="invoice-conflicts" aria-label="Invoices needing a decision">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">NEEDS YOUR DECISION</span>
              <h2>
                {conflicts.length === 1
                  ? "1 invoice disagrees with what is stored"
                  : `${conflicts.length} invoices disagree with what is stored`}
              </h2>
              <p>Nothing has been changed. Choose which version is correct — whichever you replace is kept in the record's history.</p>
            </div>
          </div>

          {conflicts.map((conflict) => (
            <article className="invoice-conflict-card" key={conflict.id}>
              <header>
                <strong>Order {conflict.orderId}</strong>
                <small>
                  from {conflict.fileName} · detected {formatTime(conflict.detectedAt)}
                </small>
              </header>

              <table className="invoice-diff">
                <thead>
                  <tr>
                    <th>Field</th>
                    <th>Stored now</th>
                    <th>Incoming file</th>
                  </tr>
                </thead>
                <tbody>
                  {conflict.changes.map((change) => (
                    <tr key={change.field}>
                      <td>{change.field}</td>
                      <td className="existing">{String(change.existing ?? "—")}</td>
                      <td className="incoming">{String(change.incoming ?? "—")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <div className="invoice-conflict-actions">
                <button type="button" className="ghost-button" onClick={() => void openOriginal(conflict.incoming.source?.contentHash)}>
                  <FileText size={13} /> View incoming PDF
                </button>
                <span className="invoice-action-spacer" />
                <button
                  type="button"
                  className="ghost-button"
                  disabled={resolving === conflict.id}
                  onClick={() => void decide(conflict, "keep-existing")}
                >
                  Keep stored version
                </button>
                <button
                  type="button"
                  className="order-button"
                  disabled={resolving === conflict.id}
                  onClick={() => void decide(conflict, "accept-incoming")}
                >
                  {resolving === conflict.id ? <Loader2 size={13} className="spin" /> : <CheckCircle2 size={13} />} Use incoming
                </button>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="invoice-columns">
        <article className="surface-panel invoice-analytics-panel">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PURCHASE ANALYTICS</span>
              <h2>What was actually bought</h2>
            </div>
          </div>

          {analytics && analytics.totals.invoices > 0 ? (
            <>
              <div className="invoice-kpis">
                <article>
                  <span>Invoices</span>
                  <strong>{analytics.totals.invoices}</strong>
                  <small>{analytics.dateRange ? `${analytics.dateRange.days} service days` : "—"}</small>
                </article>
                <article>
                  <span>Items</span>
                  <strong>{analytics.totals.quantity}</strong>
                  <small>{analytics.totals.items} line entries</small>
                </article>
                <article>
                  <span>Spend</span>
                  <strong>{analytics.totals.amount ?? "—"}</strong>
                  <small>{mixedCurrency ? `${analytics.totals.currencies.join(" + ")} — not comparable` : currency}</small>
                </article>
                <article>
                  <span>Average order</span>
                  <strong>{analytics.averageOrderValue ?? "—"}</strong>
                  <small>{mixedCurrency ? "mixed currencies" : `${currency} per invoice`}</small>
                </article>
              </div>

              <h3 className="invoice-subhead">Most purchased</h3>
              <ul className="invoice-rank">
                {analytics.topItems.slice(0, 6).map((item) => (
                  <li key={item.foodItem}>
                    <span className="invoice-rank-name">{item.foodItem}</span>
                    <span className="invoice-rank-meta">
                      <b>{item.quantity}</b> sold · {item.amount} {currency}
                    </span>
                  </li>
                ))}
              </ul>

              <h3 className="invoice-subhead">By cafeteria</h3>
              <ul className="invoice-rank">
                {analytics.byCafeteria.map((row) => (
                  <li key={row.cafeteria}>
                    <span className="invoice-rank-name">{row.cafeteria}</span>
                    <span className="invoice-rank-meta">
                      <b>{row.invoices}</b> invoices · {row.amount} {currency}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <p className="invoice-empty">No invoices imported yet. Drop a SmartQ PDF above to get started.</p>
          )}
        </article>

        <aside className="invoice-side">
          <article className="surface-panel invoice-dataset-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">FORECASTING DATASET</span>
                <h2>Training export</h2>
              </div>
            </div>
            {dataset && dataset.rows > 0 ? (
              <>
                <p className="invoice-dataset-summary">
                  <strong>{dataset.rows}</strong> rows covering <strong>{dataset.totalOrders}</strong> orders across{" "}
                  {dataset.menuFamilies.join(", ") || "—"}.
                </p>
                <small className="invoice-dataset-meta">
                  {dataset.fileName}
                  {dataset.generatedAt ? ` · refreshed ${formatTime(dataset.generatedAt)}` : ""}
                </small>
                {dataset.fileWritten ? (
                  <button type="button" className="ghost-button" onClick={() => void saveDataset()}>
                    <Download size={13} /> Download CSV
                  </button>
                ) : (
                  <p className="invoice-empty">
                    The CSV has not been written to disk yet. Import an invoice to generate it.
                  </p>
                )}
              </>
            ) : (
              <p className="invoice-empty">The dataset is generated once invoices are imported.</p>
            )}
          </article>

          <article className="surface-panel invoice-history-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">IMPORT HISTORY</span>
                <h2>
                  <History size={15} /> Recent batches
                </h2>
              </div>
            </div>
            {history.length === 0 ? (
              <p className="invoice-empty">No imports recorded yet.</p>
            ) : (
              <ul className="invoice-history">
                {history.map((item) => (
                  <li key={item.id}>
                    <span className="invoice-history-when">{formatTime(item.finishedAt)}</span>
                    <span className="invoice-history-what">
                      <b>{item.summary.imported}</b> imported, {item.summary.duplicates} duplicate, {item.summary.conflicts} to
                      review, {item.summary.rejected} rejected
                    </span>
                    <span className="invoice-history-who">
                      {item.source} · {item.actor}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </article>

          <article className="surface-panel invoice-audit-panel">
            <div className="panel-heading">
              <div>
                <span className="eyebrow">AUDIT TRAIL</span>
                <h2>
                  <ScrollText size={15} /> Append-only log
                </h2>
              </div>
            </div>
            {audit.length === 0 ? (
              <p className="invoice-empty">Nothing logged yet.</p>
            ) : (
              <ul className="invoice-audit">
                {audit.slice(0, 12).map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <code>{new Date(entry.at).toLocaleTimeString()}</code>
                    <span>{entry.event}</span>
                    <small>{entry.fileName || entry.orderId || entry.action || ""}</small>
                  </li>
                ))}
              </ul>
            )}
          </article>
        </aside>
      </section>

      {pipeline && (
        <section className="invoice-pipeline" aria-label="Ingestion pipeline">
          <div className="panel-heading">
            <div>
              <span className="eyebrow">INGESTION PIPELINE</span>
              <h2>PDF to forecasting dataset</h2>
            </div>
          </div>
          <ol className="invoice-pipeline-flow">
            {pipeline.stages.map((stage) => (
              <li key={stage.key} className={`invoice-pipeline-stage ${stage.status}`}>
                <span className="invoice-pipeline-order">{stage.order}</span>
                <span className="invoice-pipeline-body">
                  <strong>{stage.name}</strong>
                  <small>{stage.detail}</small>
                  <em>
                    {stage.metric.value} {stage.metric.unit} · {stage.metric.note}
                  </em>
                </span>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}
