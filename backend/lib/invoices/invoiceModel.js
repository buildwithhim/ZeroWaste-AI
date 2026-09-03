/**
 * Shared vocabulary for the SmartQ invoice ingestion pipeline.
 *
 * Every stage reports outcomes using the codes defined here so the admin UI can
 * explain precisely why a file was rejected rather than showing a generic
 * failure. Keep this in sync with frontend/src/services/invoiceService.ts.
 */

/** The seven pipeline stages, in order. A failure records where it happened. */
const STAGES = ["validation", "extraction", "normalization", "duplicate-detection", "database", "analytics", "forecast-dataset"];

/**
 * Per-file outcomes.
 *
 * `conflict` is deliberately distinct from `duplicate`: a duplicate is the same
 * invoice arriving twice and is safe to ignore, whereas a conflict is the same
 * order number carrying different values. Conflicts are never applied
 * automatically because doing so would silently overwrite a stored record.
 */
const OUTCOMES = {
  IMPORTED: "imported",
  DUPLICATE: "duplicate",
  CONFLICT: "conflict",
  REJECTED: "rejected",
};

/** Machine-readable rejection reasons, each with operator-facing guidance. */
const ERROR_CODES = {
  EMPTY_FILE: "File is empty",
  TOO_LARGE: "File exceeds the maximum invoice size",
  NOT_A_PDF: "File is not a PDF (missing %PDF header)",
  ENCRYPTED_PDF: "PDF is password protected and cannot be read",
  UNREADABLE_PDF: "PDF could not be parsed",
  NO_TEXT_LAYER: "PDF has no extractable text — it may be a scan or photo",
  NOT_SMARTQ_INVOICE: "PDF does not look like a SmartQ invoice",
  MISSING_ORDER_ID: "No order number found on the invoice",
  MISSING_ORDER_DATE: "No order date found on the invoice",
  NO_LINE_ITEMS: "No food line items could be read",
  BAD_DATE: "Order date could not be interpreted",
  BAD_QUANTITY: "Quantity is missing or not a positive number",
  BAD_AMOUNT: "Amount is missing or not a valid number",
};

/** Guardrails on accepted uploads. */
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_FILES_PER_BATCH = 200;
const PDF_MAGIC = "%PDF-";

/** Fields every stored invoice record must carry once normalised. */
const REQUIRED_FIELDS = ["orderId", "orderDate", "orderTime", "cafeteria", "vendor", "items"];

/** Fields compared to decide duplicate versus conflict. */
const COMPARABLE_FIELDS = ["orderDate", "orderTime", "cafeteria", "vendor", "siteCode", "totalQuantity", "totalAmount", "currency"];

module.exports = {
  STAGES,
  OUTCOMES,
  ERROR_CODES,
  MAX_FILE_BYTES,
  MAX_FILES_PER_BATCH,
  PDF_MAGIC,
  REQUIRED_FIELDS,
  COMPARABLE_FIELDS,
};
