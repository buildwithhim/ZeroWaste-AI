/**
 * CRITICAL JOURNEY 4 -- Admin -> upload invoice -> parse -> dataset update.
 *
 * The whole pipeline runs for real here. The PDF is minted in memory by
 * fixtures/invoicePdf.ts, uploaded through the actual file input, parsed on the
 * server by pdfplumber, deduplicated, and folded into the forecasting dataset.
 * Nothing in this path is stubbed, which is the point: parsing is the step most
 * likely to break silently when a dependency moves.
 *
 * Every invoice is minted with a fresh order id, so the "imported" assertions
 * do not decay into "duplicate" on the second run.
 */

import { expect, test, type Page } from "@playwright/test";

import { API_BASE, adminHeaders } from "../fixtures/env";
import { signInThroughUi } from "../fixtures/app";
import { invoicePdf, notAnInvoicePdf, uniqueOrderId, type InvoiceSpec } from "../fixtures/invoicePdf";

const INVOICE_DATE = "01/04/2025";

function sampleInvoice(overrides: Partial<InvoiceSpec> = {}) {
  return invoicePdf({
    orderId: uniqueOrderId(),
    date: INVOICE_DATE,
    time: "12:45:00",
    items: [
      { name: "Veg Biryani", quantity: 40, amount: "4000.00" },
      { name: "Masala Dosa", quantity: 25, amount: "1875.00" },
    ],
    ...overrides,
  });
}

/** Sends files through the real hidden input the Choose files button drives. */
async function uploadThroughUi(page: Page, files: { name: string; buffer: Buffer }[]) {
  await page.locator('input[type="file"]').setInputFiles(
    files.map((file) => ({ name: file.name, mimeType: "application/pdf", buffer: file.buffer })),
  );
  await expect(page.locator(".invoice-batch-result")).toBeVisible({ timeout: 30_000 });
}

async function openInvoiceSync(page: Page) {
  await signInThroughUi(page, "admin");
  await page.getByRole("link", { name: /Invoice Sync/ }).click();
  await expect(page.getByRole("heading", { name: "SmartQ invoice ingestion." })).toBeVisible();
}
test.describe("Journey 4: an invoice becomes forecasting data", () => {
  test("uploads a PDF, parses it, and the training dataset grows", async ({ page, request }) => {
    await openInvoiceSync(page);

    const before = await (await request.get(`${API_BASE}/admin/invoices/dataset`, { headers: adminHeaders })).json();
    const orderId = uniqueOrderId();

    await test.step("upload a genuine SmartQ invoice", async () => {
      await uploadThroughUi(page, [
        { name: `smartq-${orderId}.pdf`, buffer: sampleInvoice({ orderId }) },
      ]);
    });

    await test.step("the operator is told exactly what happened to the file", async () => {
      const counts = page.locator(".invoice-batch-counts");
      await expect(counts).toContainText("1 imported");
      await expect(counts).toContainText("0 duplicate");
      await expect(counts).toContainText("0 rejected");
      await expect(page.locator(".invoice-file-list")).toContainText(`smartq-${orderId}.pdf`);
    });

    await test.step("the parse recovered the order, not just the file", async () => {
      const pipeline = await (await request.get(`${API_BASE}/admin/invoices/history`, { headers: adminHeaders })).json();
      const batch = pipeline.batches?.[0] ?? pipeline[0];
      expect(JSON.stringify(batch)).toContain(orderId);
    });

    await test.step("the forecasting dataset grew because of it", async () => {
      const after = await (await request.get(`${API_BASE}/admin/invoices/dataset`, { headers: adminHeaders })).json();
      expect(after.rows).toBeGreaterThan(before.rows ?? 0);
      expect(after.totalOrders).toBeGreaterThan(before.totalOrders ?? 0);
      await expect(page.locator(".invoice-dataset-summary")).toContainText(String(after.rows));
    });

    await test.step("the import is attributable after the fact", async () => {
      await expect(page.locator(".invoice-history")).toContainText("imported");
      const audit = await (await request.get(`${API_BASE}/admin/invoices/audit`, { headers: adminHeaders })).json();
      expect(JSON.stringify(audit)).toContain(orderId);
    });
  });

  test("the same invoice sent twice is stored once", async ({ page, request }) => {
    await openInvoiceSync(page);

    const orderId = uniqueOrderId();
    const pdf = sampleInvoice({ orderId });

    await uploadThroughUi(page, [{ name: `dupe-${orderId}.pdf`, buffer: pdf }]);
    await expect(page.locator(".invoice-batch-counts")).toContainText("1 imported");

    const afterFirst = await (await request.get(`${API_BASE}/admin/invoices/dataset`, { headers: adminHeaders })).json();

    await uploadThroughUi(page, [{ name: `dupe-${orderId}-again.pdf`, buffer: pdf }]);
    await expect(page.locator(".invoice-batch-counts")).toContainText("1 duplicate");
    await expect(page.locator(".invoice-batch-counts")).toContainText("0 imported");

    const afterSecond = await (await request.get(`${API_BASE}/admin/invoices/dataset`, { headers: adminHeaders })).json();
    expect(afterSecond.rows).toBe(afterFirst.rows);
    expect(afterSecond.totalOrders).toBe(afterFirst.totalOrders);
  });

  test("a PDF that is not an invoice is rejected instead of quietly poisoning the dataset", async ({ page, request }) => {
    await openInvoiceSync(page);
    const before = await (await request.get(`${API_BASE}/admin/invoices/dataset`, { headers: adminHeaders })).json();

    await uploadThroughUi(page, [{ name: "facilities-report.pdf", buffer: notAnInvoicePdf() }]);

    await expect(page.locator(".invoice-batch-counts")).toContainText("1 rejected");
    await expect(page.locator(".invoice-batch-counts")).toContainText("0 imported");
    await expect(page.locator(".invoice-problem-note")).toBeVisible();

    const after = await (await request.get(`${API_BASE}/admin/invoices/dataset`, { headers: adminHeaders })).json();
    expect(after.rows).toBe(before.rows);
  });

  test("a batch is judged file by file, not all-or-nothing", async ({ page }) => {
    await openInvoiceSync(page);

    const good = uniqueOrderId();
    await uploadThroughUi(page, [
      { name: `mixed-good-${good}.pdf`, buffer: sampleInvoice({ orderId: good }) },
      { name: "mixed-bad.pdf", buffer: notAnInvoicePdf() },
    ]);

    const counts = page.locator(".invoice-batch-counts");
    await expect(counts).toContainText("1 imported");
    await expect(counts).toContainText("1 rejected");
    // The good file must not be held hostage by the bad one.
    await expect(page.locator(".invoice-file-list")).toContainText(`mixed-good-${good}.pdf`);
  });

  test("invoice ingestion is closed to anyone without the admin token", async ({ request }) => {
    const orderId = uniqueOrderId();
    const multipart = {
      files: { name: `unauthorised-${orderId}.pdf`, mimeType: "application/pdf", buffer: sampleInvoice({ orderId }) },
    };

    expect((await request.post(`${API_BASE}/admin/invoices/import`, { multipart })).status()).toBe(403);
    expect((await request.get(`${API_BASE}/admin/invoices/dataset`)).status()).toBe(403);
    expect((await request.get(`${API_BASE}/admin/invoices/audit`)).status()).toBe(403);
    expect(
      (await request.post(`${API_BASE}/admin/invoices/import`, { headers: { "x-admin-token": "nope" }, multipart })).status(),
    ).toBe(403);
  });
});
