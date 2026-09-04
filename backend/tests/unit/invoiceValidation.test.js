/**
 * Upload validation: the checks that run before a file is handed to Python.
 */

import { describe, expect, it } from "vitest";

import { MAX_FILE_BYTES } from "../../lib/invoices/invoiceModel.js";
import { contentHash, safeFileName, validateFile } from "../../lib/invoices/validation.js";

const pdfBytes = (body = "hello") => Buffer.concat([Buffer.from("%PDF-1.7\n", "latin1"), Buffer.from(body)]);

describe("validateFile", () => {
  it("accepts a plausible PDF", () => {
    expect(validateFile(pdfBytes(), "invoice.pdf")).toEqual({ ok: true });
  });

  it("rejects an empty upload", () => {
    expect(validateFile(Buffer.alloc(0), "invoice.pdf")).toMatchObject({ ok: false, code: "EMPTY_FILE" });
    expect(validateFile(null, "invoice.pdf")).toMatchObject({ ok: false, code: "EMPTY_FILE" });
  });

  it("rejects a file over the size ceiling", () => {
    const oversized = Buffer.concat([pdfBytes(), Buffer.alloc(MAX_FILE_BYTES)]);
    expect(validateFile(oversized, "invoice.pdf")).toMatchObject({ ok: false, code: "TOO_LARGE" });
  });

  it("accepts a file exactly at the ceiling", () => {
    const exact = Buffer.concat([Buffer.from("%PDF-", "latin1"), Buffer.alloc(MAX_FILE_BYTES - 5)]);
    expect(exact).toHaveLength(MAX_FILE_BYTES);
    expect(validateFile(exact, "invoice.pdf").ok).toBe(true);
  });

  describe("content sniffing", () => {
    // The extension proves nothing. A renamed document, an HTML error page, or
    // a script saved as .pdf all arrive here looking plausible.
    const disguised = [
      ["an HTML error page", Buffer.from("<html><body>502 Bad Gateway</body></html>")],
      ["a ZIP-based office document", Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00])],
      ["a shell script", Buffer.from("#!/bin/sh\nrm -rf /\n")],
      ["a PNG", Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
      ["a PDF header that is not at the start", Buffer.from("   %PDF-1.7")],
    ];

    it.each(disguised)("rejects %s named .pdf", (_label, buffer) => {
      expect(validateFile(buffer, "invoice.pdf")).toMatchObject({ ok: false, code: "NOT_A_PDF" });
    });
  });

  it("accepts real PDF bytes under a wrong extension, but flags the mismatch", () => {
    const result = validateFile(pdfBytes(), "invoice.txt");
    expect(result.ok).toBe(true);
    expect(result.warning).toMatch(/extension is not \.pdf/i);
  });
});

describe("safeFileName", () => {
  it("strips directory components from a traversal attempt", () => {
    expect(safeFileName("../../../../etc/passwd")).toBe("passwd");
    expect(safeFileName("..\\..\\Windows\\System32\\config\\SAM")).toBe("SAM");
    expect(safeFileName("/absolute/path/invoice.pdf")).toBe("invoice.pdf");
    expect(safeFileName("C:\\Users\\admin\\invoice.pdf")).toBe("invoice.pdf");
  });

  it("removes characters that would be dangerous in a path or in markup", () => {
    expect(safeFileName("<script>alert(1)</script>.pdf")).not.toMatch(/[<>]/);
    expect(safeFileName("in;voice|name.pdf")).not.toMatch(/[;|]/);
  });

  it("keeps ordinary invoice names readable", () => {
    expect(safeFileName("invoice_G1004987 (copy).pdf")).toBe("invoice_G1004987 (copy).pdf");
  });

  it("caps the length so a crafted name cannot bloat the log", () => {
    expect(safeFileName(`${"a".repeat(500)}.pdf`)).toHaveLength(180);
  });

  it("falls back to a default when the name is empty or unusable", () => {
    expect(safeFileName("")).toBe("upload.pdf");
    expect(safeFileName(null)).toBe("upload.pdf");
    expect(safeFileName("///")).toBe("upload.pdf");
  });
});

describe("contentHash", () => {
  it("is a sha256 hex digest", () => {
    expect(contentHash(pdfBytes())).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is stable for identical bytes and different for different bytes", () => {
    expect(contentHash(pdfBytes("a"))).toBe(contentHash(pdfBytes("a")));
    expect(contentHash(pdfBytes("a"))).not.toBe(contentHash(pdfBytes("b")));
  });
});
