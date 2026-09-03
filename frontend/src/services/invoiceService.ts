/**
 * Client for the admin-only invoice API.
 *
 * Every call carries the administrator token; the backend rejects anything
 * without it, so these helpers are unusable from an employee screen even if
 * one imported them by mistake.
 */

import axios from "axios";

import { API_BASE } from "./feedbackService";

/**
 * Placeholder credential matching backend/lib/invoices/requireAdmin.js. It is
 * a shared secret for local development, not real authentication — swap this
 * for the signed-in user's token once SSO is wired up.
 */
const ADMIN_TOKEN = "zerowaste-local-admin-token";

const authHeaders = (actor = "admin") => ({ "x-admin-token": ADMIN_TOKEN, "x-admin-actor": actor });

export type ImportOutcome = "imported" | "duplicate" | "conflict" | "rejected";

export type FileResult = {
  fileName: string;
  contentHash?: string;
  outcome: ImportOutcome;
  stage: string;
  code?: string;
  message?: string;
  reason?: string | null;
  orderId?: string;
  orderDate?: string;
  cafeteria?: string;
  totalAmount?: number;
  currency?: string;
  itemCount?: number;
  conflictId?: string | null;
  warning?: string | null;
};

export type ImportSummary = { received: number; imported: number; duplicates: number; conflicts: number; rejected: number };

export type ImportBatch = {
  id: string;
  startedAt: string;
  finishedAt: string;
  actor: string;
  source: string;
  summary: ImportSummary;
  dataset: { rows: number; path: string } | null;
  files: FileResult[];
};

export type InvoiceItem = { foodItem: string; hsnCode: string; quantity: number; amount: number; unitAmount: number };

export type InvoiceRecord = {
  orderId: string;
  orderDate: string;
  orderTime: string;
  weekday: string;
  cafeteria: string;
  vendor: string;
  siteCode: string | null;
  currency: string;
  items: InvoiceItem[];
  totalQuantity: number;
  totalAmount: number;
  importedAt: string;
  /** Set when an administrator replaced this record by resolving a conflict. */
  revisedAt?: string;
  /** Only present on archived versions inside `history`. */
  supersededAt?: string;
  history?: { replacedAt: string; by: string; reason?: string; record?: InvoiceRecord }[];
  source: { fileName: string | null; contentHash: string | null; pageCount: number };
};

export type ConflictChange = { field: string; existing: string | number | null; incoming: string | number | null };

export type InvoiceConflict = {
  id: string;
  orderId: string;
  detectedAt: string;
  fileName: string;
  changes: ConflictChange[];
  existing: InvoiceRecord;
  incoming: InvoiceRecord;
  status: string;
  resolvedAt?: string;
  resolvedBy?: string;
};

export type InvoiceAnalytics = {
  generatedAt: string;
  /** `amount` and `averageOrderValue` are null when records span several currencies. */
  totals: { invoices: number; items: number; quantity: number; amount: number | null; currency: string; currencies: string[] };
  dateRange: { from: string; to: string; days: number } | null;
  averageOrderValue: number | null;
  topItems: { foodItem: string; quantity: number; amount: number; invoices: number }[];
  byCafeteria: { cafeteria: string; quantity: number; amount: number; invoices: number }[];
  byVendor: { vendor: string; quantity: number; amount: number; invoices: number }[];
  byMenuFamily: { menu: string; quantity: number; amount: number; invoices: number }[];
  dailyTrend: { date: string; quantity: number; amount: number; invoices: number }[];
  byWeekday: { weekday: string; quantity: number; amount: number; invoices: number }[];
};

export type DatasetSummary = {
  rows: number;
  fileName: string;
  generatedAt: string | null;
  /** False when the CSV has not reached disk, so the download would 404. */
  fileWritten: boolean;
  totalOrders: number;
  menuFamilies: string[];
  dateRange: { from: string; to: string; days: number } | null;
  preview: { date: string; weekday: string; cafeteria: string; menu: string; orders: number; amount: number }[];
};

export type InvoicePipelineStage = {
  key: string;
  name: string;
  order: number;
  owner: string;
  input: string;
  output: string;
  detail: string;
  metric: { value: number; unit: string; note: string };
  status: "active" | "awaiting-data";
};

export type InvoicePipeline = { generatedAt: string; complete: boolean; lastImportAt: string | null; stages: InvoicePipelineStage[] };

export type AuditEntry = {
  at: string;
  event: string;
  actor?: string;
  fileName?: string;
  orderId?: string | null;
  outcome?: string;
  code?: string | null;
  action?: string;
  batchId?: string;
};

/** Uploads PDFs as multipart form data and runs the pipeline over them. */
export function importInvoices(files: File[], actor?: string) {
  const form = new FormData();
  files.forEach((file) => form.append("invoices", file));
  return axios.post<ImportBatch>(`${API_BASE}/admin/invoices/import`, form, { headers: authHeaders(actor) });
}

/** Ingests the PDFs already sitting in the server's drop folder. */
export function scanDropFolder(actor?: string) {
  return axios.post<ImportBatch>(`${API_BASE}/admin/invoices/scan`, {}, { headers: authHeaders(actor) });
}

export function getInvoiceRecords(params: { search?: string; cafeteria?: string; limit?: number } = {}) {
  return axios.get<{ total: number; records: InvoiceRecord[] }>(`${API_BASE}/admin/invoices/records`, {
    headers: authHeaders(),
    params,
  });
}

export function getInvoiceAnalytics() {
  return axios.get<InvoiceAnalytics>(`${API_BASE}/admin/invoices/analytics`, { headers: authHeaders() });
}

export function getImportHistory(limit = 25) {
  return axios.get<{ batches: ImportBatch[] }>(`${API_BASE}/admin/invoices/history`, { headers: authHeaders(), params: { limit } });
}

export function getAuditTrail(limit = 60) {
  return axios.get<{ entries: AuditEntry[] }>(`${API_BASE}/admin/invoices/audit`, { headers: authHeaders(), params: { limit } });
}

export function getConflicts(status = "unresolved") {
  return axios.get<{ conflicts: InvoiceConflict[] }>(`${API_BASE}/admin/invoices/conflicts`, {
    headers: authHeaders(),
    params: { status },
  });
}

export function resolveConflict(id: string, action: "accept-incoming" | "keep-existing", actor?: string) {
  return axios.post<{ resolved: boolean; action: string; dataset: { rows: number } | null }>(
    `${API_BASE}/admin/invoices/conflicts/${encodeURIComponent(id)}/resolve`,
    { action },
    { headers: authHeaders(actor) }
  );
}

export function getDataset() {
  return axios.get<DatasetSummary>(`${API_BASE}/admin/invoices/dataset`, { headers: authHeaders() });
}

export function getInvoicePipeline() {
  return axios.get<InvoicePipeline>(`${API_BASE}/admin/invoices/pipeline`, { headers: authHeaders() });
}

/**
 * Fetches a vaulted PDF as a blob URL.
 *
 * The original cannot be linked to directly because the vault is not served
 * statically and the request must carry the admin token.
 */
export async function fetchRawInvoice(contentHash: string) {
  const response = await axios.get(`${API_BASE}/admin/invoices/raw/${contentHash}`, {
    headers: authHeaders(),
    responseType: "blob",
  });
  return URL.createObjectURL(response.data as Blob);
}

export const datasetDownloadUrl = `${API_BASE}/admin/invoices/dataset/download`;

/** Downloads the training CSV, which needs the token and so cannot be a plain link. */
export async function downloadDataset() {
  const response = await axios.get(datasetDownloadUrl, { headers: authHeaders(), responseType: "blob" });
  const url = URL.createObjectURL(response.data as Blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "invoice_orders_dataset.csv";
  anchor.click();
  URL.revokeObjectURL(url);
}
