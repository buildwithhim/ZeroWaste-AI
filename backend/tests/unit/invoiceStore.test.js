/**
 * Duplicate and conflict detection.
 *
 * This is the part of the invoice pipeline that decides whether a re-uploaded
 * file is harmless or is a correction that would silently overwrite stored
 * figures. The distinction drives the forecasting dataset, so it is tested
 * exhaustively at the unit level rather than only through an upload.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import invoiceStore from "../../lib/invoices/invoiceStore.js";
import { useDataSandbox } from "../helpers/sandbox.js";

const hashOf = (seed) => crypto.createHash("sha256").update(String(seed)).digest("hex");

/** A normalised invoice record, in the shape the extractor produces. */
const record = ({ hashSeed = "original", source = {}, ...overrides } = {}) => ({
  orderId: "G1004987",
  orderDate: "2024-06-03",
  orderTime: "12:41",
  cafeteria: "Microsoft Pune - CMZ",
  vendor: "Compass India Food Services Pvt. Ltd.",
  siteCode: "CMZ",
  totalQuantity: 2,
  totalAmount: 240,
  currency: "INR",
  items: [{ foodItem: "Veg Biryani", quantity: 2, amount: 240 }],
  ...overrides,
  source: { fileName: "invoice.pdf", contentHash: hashOf(hashSeed), ...source },
});

describe("invoiceStore.insert", () => {
  useDataSandbox();

  it("imports an invoice it has never seen", () => {
    const result = invoiceStore.insert(record());

    expect(result.outcome).toBe("imported");
    expect(result.record.orderId).toBe("G1004987");
    expect(invoiceStore.listRecords()).toHaveLength(1);
  });

  it("stamps an import time and batch, and opens an empty history", () => {
    const result = invoiceStore.insert(record(), { batchId: "imp_test" });

    expect(result.record.batchId).toBe("imp_test");
    expect(result.record.history).toEqual([]);
    expect(Date.parse(result.record.importedAt)).not.toBeNaN();
  });

  it("keeps two genuinely different orders apart", () => {
    invoiceStore.insert(record({ orderId: "G1000001", hashSeed: "one" }));
    invoiceStore.insert(record({ orderId: "G1000002", hashSeed: "two" }));

    expect(invoiceStore.listRecords()).toHaveLength(2);
  });

  describe("the same file twice", () => {
    it("is a duplicate and stores nothing new", () => {
      invoiceStore.insert(record());
      const result = invoiceStore.insert(record());

      expect(result).toMatchObject({ outcome: "duplicate", reason: "identical-file" });
      expect(invoiceStore.listRecords()).toHaveLength(1);
    });

    it("is detected by content, so renaming the file changes nothing", () => {
      invoiceStore.insert(record({ source: { fileName: "invoice.pdf" } }));
      const result = invoiceStore.insert(record({ source: { fileName: "invoice-copy-final-v2.pdf" } }));

      expect(result.reason).toBe("identical-file");
    });
  });

  describe("the same order re-exported to a different file", () => {
    it("is a duplicate, because none of the values disagree", () => {
      invoiceStore.insert(record({ hashSeed: "first" }));
      const result = invoiceStore.insert(record({ hashSeed: "second" }));

      expect(result).toMatchObject({ outcome: "duplicate", reason: "same-order-different-file" });
      expect(invoiceStore.listRecords()).toHaveLength(1);
    });

    it("remembers the extra hash so the next upload of it matches cheaply", () => {
      invoiceStore.insert(record({ hashSeed: "first" }));
      invoiceStore.insert(record({ hashSeed: "second" }));

      expect(invoiceStore.listRecords()[0].alternateHashes).toContain(hashOf("second"));
    });
  });

  describe("the same order carrying different values", () => {
    it("is raised as a conflict rather than applied", () => {
      invoiceStore.insert(record({ totalAmount: 240 }));
      const result = invoiceStore.insert(record({ totalAmount: 265, hashSeed: "corrected" }));

      expect(result.outcome).toBe("conflict");
      expect(result.reason).toBe("values-differ");
    });

    it("leaves the stored record untouched while the conflict is open", () => {
      invoiceStore.insert(record({ totalAmount: 240 }));
      invoiceStore.insert(record({ totalAmount: 265, hashSeed: "corrected" }));

      expect(invoiceStore.listRecords()).toHaveLength(1);
      expect(invoiceStore.findRecord("G1004987").totalAmount).toBe(240);
    });

    it("reports exactly which fields disagree", () => {
      invoiceStore.insert(record({ totalAmount: 240, orderTime: "12:41" }));
      const result = invoiceStore.insert(record({ totalAmount: 265, orderTime: "13:02", hashSeed: "corrected" }));

      expect(result.conflict.changes.map((change) => change.field).sort()).toEqual(["orderTime", "totalAmount"]);
      expect(result.conflict.changes.find((change) => change.field === "totalAmount")).toMatchObject({
        existing: 240,
        incoming: 265,
      });
    });

    it("notices a changed line item even when the totals still match", () => {
      invoiceStore.insert(record());
      const result = invoiceStore.insert(
        record({ items: [{ foodItem: "Paneer Butter Masala", quantity: 2, amount: 240 }], hashSeed: "reitemised" })
      );

      expect(result.outcome).toBe("conflict");
      expect(result.conflict.changes.map((change) => change.field)).toContain("items");
    });

    it("raises the same disagreement once, not once per upload attempt", () => {
      invoiceStore.insert(record({ totalAmount: 240 }));
      invoiceStore.insert(record({ totalAmount: 265, hashSeed: "corrected" }));
      invoiceStore.insert(record({ totalAmount: 265, hashSeed: "corrected" }));

      expect(invoiceStore.listConflicts("unresolved")).toHaveLength(1);
    });

    it("does not re-ask a question the administrator has already answered", () => {
      invoiceStore.insert(record({ totalAmount: 240 }));
      const raised = invoiceStore.insert(record({ totalAmount: 265, hashSeed: "corrected" }));
      invoiceStore.resolveConflict(raised.conflict.id, "keep-existing");

      const again = invoiceStore.insert(record({ totalAmount: 265, hashSeed: "corrected" }));
      expect(again).toMatchObject({ outcome: "duplicate", reason: "previously-resolved-conflict" });
      expect(again.resolution.status).toBe("kept-existing");
    });
  });
});

describe("invoiceStore.resolveConflict", () => {
  useDataSandbox();

  /** Stores an invoice, then raises a conflict against it. Returns the conflict id. */
  const raiseConflict = () => {
    invoiceStore.insert(record({ totalAmount: 240 }));
    const result = invoiceStore.insert(record({ totalAmount: 265, hashSeed: "corrected" }));
    return result.conflict.id;
  };

  it("keeps the stored figures when the administrator says so", () => {
    const conflictId = raiseConflict();
    const result = invoiceStore.resolveConflict(conflictId, "keep-existing", "alice");

    expect(result.ok).toBe(true);
    expect(invoiceStore.findRecord("G1004987").totalAmount).toBe(240);
  });

  it("applies the correction when the administrator accepts it", () => {
    const conflictId = raiseConflict();
    const result = invoiceStore.resolveConflict(conflictId, "accept-incoming", "alice");

    expect(result.ok).toBe(true);
    expect(invoiceStore.findRecord("G1004987").totalAmount).toBe(265);
  });

  it("retains the superseded figures so the earlier numbers stay auditable", () => {
    const conflictId = raiseConflict();
    invoiceStore.resolveConflict(conflictId, "accept-incoming", "alice");

    const [entry] = invoiceStore.findRecord("G1004987").history;
    expect(entry).toMatchObject({ by: "alice", reason: "conflict-resolution" });
    expect(entry.record.totalAmount).toBe(240);
  });

  it("preserves the original import time across a replacement", () => {
    invoiceStore.insert(record({ totalAmount: 240 }));
    const importedAt = invoiceStore.findRecord("G1004987").importedAt;

    const raised = invoiceStore.insert(record({ totalAmount: 265, hashSeed: "corrected" }));
    invoiceStore.resolveConflict(raised.conflict.id, "accept-incoming");

    const stored = invoiceStore.findRecord("G1004987");
    expect(stored.importedAt).toBe(importedAt);
    expect(Date.parse(stored.revisedAt)).not.toBeNaN();
  });

  it("records who decided and when", () => {
    const conflictId = raiseConflict();
    const result = invoiceStore.resolveConflict(conflictId, "keep-existing", "alice");

    expect(result.conflict).toMatchObject({ status: "kept-existing", resolvedBy: "alice" });
    expect(Date.parse(result.conflict.resolvedAt)).not.toBeNaN();
  });

  it("refuses an action it does not understand rather than guessing", () => {
    const conflictId = raiseConflict();
    expect(invoiceStore.resolveConflict(conflictId, "delete-everything")).toMatchObject({
      ok: false,
      error: expect.stringMatching(/accept-incoming|keep-existing/),
    });
  });

  it("refuses to resolve the same conflict twice", () => {
    const conflictId = raiseConflict();
    invoiceStore.resolveConflict(conflictId, "keep-existing");

    expect(invoiceStore.resolveConflict(conflictId, "accept-incoming")).toMatchObject({ ok: false });
  });

  it("refuses an unknown conflict id", () => {
    expect(invoiceStore.resolveConflict("no-such-conflict", "keep-existing")).toMatchObject({ ok: false });
  });

  it("sends the administrator back to look again when the record moved underneath them", () => {
    // Two conflicts are open against the same order. Applying the second after
    // the first has already replaced the record would quietly revert a decision
    // that has been made, so it is refused and the comparison is refreshed.
    invoiceStore.insert(record({ totalAmount: 240 }));
    const first = invoiceStore.insert(record({ totalAmount: 265, hashSeed: "correction-a" }));
    const second = invoiceStore.insert(record({ totalAmount: 300, hashSeed: "correction-b" }));

    expect(invoiceStore.resolveConflict(first.conflict.id, "accept-incoming").ok).toBe(true);

    const stale = invoiceStore.resolveConflict(second.conflict.id, "accept-incoming");
    expect(stale.ok).toBe(false);
    expect(stale.error).toMatch(/changed after this conflict was raised/);
    expect(invoiceStore.findRecord("G1004987").totalAmount).toBe(265);
  });
});

describe("invoiceStore.listConflicts", () => {
  useDataSandbox();

  const raiseConflict = () => {
    invoiceStore.insert(record({ totalAmount: 240 }));
    return invoiceStore.insert(record({ totalAmount: 265, hashSeed: "corrected" })).conflict.id;
  };

  it("lists open conflicts by default", () => {
    raiseConflict();
    expect(invoiceStore.listConflicts("unresolved")).toHaveLength(1);
  });

  it("stops offering a conflict once it has been decided", () => {
    invoiceStore.resolveConflict(raiseConflict(), "keep-existing");
    expect(invoiceStore.listConflicts("unresolved")).toHaveLength(0);
  });

  it("treats 'resolved' as either terminal decision", () => {
    // Asking for resolved conflicts must not return an empty list merely
    // because the decision happened to be recorded as "replaced".
    invoiceStore.resolveConflict(raiseConflict(), "accept-incoming");
    expect(invoiceStore.listConflicts("resolved")).toHaveLength(1);
  });

  it("returns everything when asked for all", () => {
    invoiceStore.resolveConflict(raiseConflict(), "keep-existing");
    expect(invoiceStore.listConflicts("all")).toHaveLength(1);
  });
});

describe("the invoice vault", () => {
  const sandbox = useDataSandbox();
  const bytes = Buffer.from("%PDF-1.7 original");

  it("names files by content hash, so an uploaded name cannot steer the path", () => {
    const hash = hashOf("vaulted");
    expect(invoiceStore.storeRaw(bytes, hash)).toBe(`${hash}.pdf`);
    expect(fs.existsSync(path.join(sandbox.dir, "invoice_vault", `${hash}.pdf`))).toBe(true);
  });

  it("reads the original bytes back", () => {
    const hash = hashOf("vaulted");
    invoiceStore.storeRaw(bytes, hash);
    expect(invoiceStore.readRaw(hash)).toEqual(bytes);
  });

  it("stores identical content once", () => {
    const hash = hashOf("vaulted");
    invoiceStore.storeRaw(bytes, hash);
    invoiceStore.storeRaw(bytes, hash);

    expect(fs.readdirSync(path.join(sandbox.dir, "invoice_vault"))).toHaveLength(1);
  });

  it("returns nothing for a hash that was never stored", () => {
    expect(invoiceStore.readRaw(hashOf("never-stored"))).toBeNull();
  });

  describe("path traversal", () => {
    // The vault sits outside the web root and is reachable only through an
    // admin route that passes a user-supplied path segment straight in. The
    // 64-hex-character check is what keeps that segment inside the vault.
    const attempts = [
      ["a relative traversal", "../../../../etc/passwd"],
      ["a Windows traversal", "..\\..\\..\\..\\Windows\\System32\\config\\SAM"],
      ["a sibling data file", "../invoices.json"],
      ["a hash-length prefix followed by a traversal", `${"a".repeat(64)}/../../secret`],
      ["a URL-encoded traversal", "%2e%2e%2f%2e%2e%2fetc%2fpasswd"],
      ["uppercase hex, which the vault never writes", "A".repeat(64)],
      ["non-hex characters of the right length", "z".repeat(64)],
      ["one character too short", "a".repeat(63)],
      ["one character too long", "a".repeat(65)],
      ["an empty segment", ""],
      ["a null segment", null],
      ["an absent segment", undefined],
    ];

    it.each(attempts)("refuses %s", (_label, attempt) => {
      expect(invoiceStore.readRaw(attempt)).toBeNull();
    });
  });
});

describe("invoiceStore.reset", () => {
  useDataSandbox();

  it("clears records and conflicts", () => {
    invoiceStore.insert(record());
    invoiceStore.reset();

    expect(invoiceStore.listRecords()).toEqual([]);
    expect(invoiceStore.listConflicts("all")).toEqual([]);
  });
});
