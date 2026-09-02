import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";
import { Check, CloudUpload, FileText, FileUp, LoaderCircle, RefreshCw, Sparkles, X } from "lucide-react";

type InvoiceStatus = "Uploaded" | "Parsed" | "Added to Dataset";
type Invoice = { id: number; filename: string; date: string; vendor: string; status: InvoiceStatus };
type SyncResult = { rows: number; meals: number };

const initialInvoices: Invoice[] = [
  { id: 1, filename: "smartq-invoice-aug-22.pdf", date: "22 Aug 2026", vendor: "SmartQ Technologies", status: "Added to Dataset" },
  { id: 2, filename: "cafeteria-orders-week-33.pdf", date: "18 Aug 2026", vendor: "Compass Group India", status: "Parsed" },
  { id: 3, filename: "redmond-campus-invoice.pdf", date: "12 Aug 2026", vendor: "Foodhub Services", status: "Uploaded" },
];

export default function InvoiceSyncPage() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [invoices, setInvoices] = useState<Invoice[]>(initialInvoices);
  const [dragging, setDragging] = useState(false);
  const [syncProgress, setSyncProgress] = useState<number | null>(null);
  const [syncResult, setSyncResult] = useState<SyncResult | null>(null);

  useEffect(() => {
    if (syncProgress === null) return;
    const timer = window.setInterval(() => setSyncProgress((current) => {
      if (current === null || current >= 100) return 100;
      return Math.min(current + 10, 100);
    }), 120);
    return () => window.clearInterval(timer);
  }, [syncProgress]);

  useEffect(() => {
    if (syncProgress !== 100) return;
    setInvoices((current) => current.map((invoice) => ({ ...invoice, status: "Added to Dataset" })));
    setSyncResult({ rows: invoices.length * 142, meals: invoices.length * 413 });
  }, [syncProgress, invoices.length]);

  const addFiles = (files: FileList | File[]) => {
    const pdfs = Array.from(files).filter((file) => file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf"));
    setInvoices((current) => [...pdfs.map((file, index) => ({ id: Date.now() + index, filename: file.name, date: "22 Aug 2026", vendor: "Pending extraction", status: "Uploaded" as InvoiceStatus })), ...current]);
    setSyncResult(null);
  };
  const handleDrop = (event: DragEvent<HTMLDivElement>) => { event.preventDefault(); setDragging(false); addFiles(event.dataTransfer.files); };
  const handleChange = (event: ChangeEvent<HTMLInputElement>) => { if (event.target.files) addFiles(event.target.files); event.target.value = ""; };
  const syncHistory = () => { setSyncResult(null); setSyncProgress(0); };

  return <div className="page-frame invoice-page"><div className="page-intro"><div><span className="eyebrow">DATA PIPELINE</span><h1>Invoice Sync</h1><p>Import cafeteria history to keep SmartQ forecasts grounded in real demand.</p></div><button type="button" className="primary-button retrain-button" disabled={syncProgress !== null && syncProgress < 100} onClick={syncHistory}>{syncProgress !== null && syncProgress < 100 ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />} {syncProgress !== null && syncProgress < 100 ? "Syncing history..." : "Sync SmartQ History"}</button></div><section className={`upload-zone${dragging ? " dragging" : ""}`} onDragOver={(event) => { event.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={handleDrop} onClick={() => inputRef.current?.click()} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") inputRef.current?.click(); }}><input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={handleChange} /><span className="upload-icon"><CloudUpload size={25} /></span><h2>Drop PDF invoices here</h2><p>or <b>browse files</b> from your computer</p><small>PDF files only · prototype upload</small></section>{syncProgress !== null && <section className="sync-progress-panel"><div><span><strong>Syncing SmartQ history</strong><small>Extracting invoice rows and historical meals</small></span><b>{syncProgress}%</b></div><i><em style={{ width: `${syncProgress}%` }} /></i>{syncProgress === 100 && syncResult && <div className="sync-result"><span><strong>{syncResult.rows.toLocaleString()}</strong><small>Extracted rows</small></span><span><strong>{syncResult.meals.toLocaleString()}</strong><small>Historical meals imported</small></span><Check size={20} /></div>}</section>}<section className="invoice-list-panel"><div className="invoice-list-header"><div><span className="eyebrow">INVOICE REGISTER</span><h2>Uploaded invoices</h2></div><span className="file-count">{invoices.length} files</span></div><div className="invoice-table" role="table" aria-label="Uploaded invoices"><div className="invoice-table-row invoice-table-header" role="row"><span>Filename</span><span>Date</span><span>Vendor</span><span>Status</span><span /></div>{invoices.map((invoice) => <InvoiceRow invoice={invoice} key={invoice.id} onRemove={() => setInvoices((current) => current.filter((item) => item.id !== invoice.id))} />)}</div></section><p className="sync-note"><Sparkles size={15} /> This is a frontend prototype. Invoice data is not sent to the backend.</p></div>;
}

function InvoiceRow({ invoice, onRemove }: { invoice: Invoice; onRemove: () => void }) {
  return <div className="invoice-table-row" role="row"><span className="invoice-name-cell"><FileText size={17} /><strong>{invoice.filename}</strong></span><span>{invoice.date}</span><span>{invoice.vendor}</span><StatusChip status={invoice.status} /><button type="button" className="icon-button remove-file" onClick={onRemove} aria-label={`Remove ${invoice.filename}`} title="Remove invoice"><X size={16} /></button></div>;
}

function StatusChip({ status }: { status: InvoiceStatus }) {
  const Icon = status === "Added to Dataset" ? Check : status === "Parsed" ? FileUp : FileText;
  return <span className={`status-chip ${status.toLowerCase().replace(/ /g, "-")}`}><Icon size={12} />{status}</span>;
}
