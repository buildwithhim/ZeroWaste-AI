/**
 * Stage 1: validation.
 *
 * Cheap structural checks that run before we hand a file to the PDF parser, so
 * an obviously bad upload is rejected without spawning Python. Anything that
 * needs the document to be opened (encryption, text layer, SmartQ shape) is
 * checked during extraction and reported with the same error codes.
 */

const crypto = require("crypto");

const { ERROR_CODES, MAX_FILE_BYTES, PDF_MAGIC } = require("./invoiceModel");

/** Stable identity for a file's contents; also used as its vault filename. */
const contentHash = (buffer) => crypto.createHash("sha256").update(buffer).digest("hex");

/**
 * Strips any directory component from a client-supplied filename.
 *
 * Uploads are stored under their content hash rather than this name, so the
 * sanitised value is only ever used for display and logging — but it is
 * sanitised anyway so a crafted name cannot escape into a path or the UI.
 */
function safeFileName(name) {
  const base = String(name || "upload.pdf").split(/[\\/]/).pop();
  return base.replace(/[^\w.\-() ]+/g, "_").slice(0, 180) || "upload.pdf";
}

/**
 * Validates the raw bytes. Returns { ok } or { ok: false, code, message }.
 *
 * The magic-byte check matters more than the extension: a renamed .docx or an
 * HTML error page saved as .pdf both reach here looking plausible.
 */
function validateFile(buffer, fileName) {
  if (!buffer || buffer.length === 0) {
    return { ok: false, code: "EMPTY_FILE", message: ERROR_CODES.EMPTY_FILE };
  }

  if (buffer.length > MAX_FILE_BYTES) {
    const mb = (buffer.length / (1024 * 1024)).toFixed(1);
    return { ok: false, code: "TOO_LARGE", message: `${ERROR_CODES.TOO_LARGE} (${mb} MB of ${MAX_FILE_BYTES / (1024 * 1024)} MB)` };
  }

  if (buffer.subarray(0, PDF_MAGIC.length).toString("latin1") !== PDF_MAGIC) {
    return { ok: false, code: "NOT_A_PDF", message: ERROR_CODES.NOT_A_PDF };
  }

  if (!/\.pdf$/i.test(safeFileName(fileName))) {
    // The bytes look right, so this is worth importing, but flag the mismatch.
    return { ok: true, warning: "File extension is not .pdf although the contents are" };
  }

  return { ok: true };
}

module.exports = { validateFile, contentHash, safeFileName };
