/**
 * The service layer's authorization boundary.
 *
 * Every request the app makes is issued from these three modules, so this is
 * the one place where "which calls carry the administrator credential" can be
 * checked exhaustively. The tests assert two directions:
 *
 *   - admin reads and writes must carry the token, and
 *   - employee self-service calls must not, because they are reached from a
 *     screen where the credential should not exist at all.
 *
 * Several tests are marked KNOWN GAP: the token is a hardcoded shared secret
 * (audit C2 -- Critical), so shipping it to the browser hands it to every
 * employee. They pin the present behaviour so the fix is a deliberate edit.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import axios from "axios";

vi.mock("axios", () => {
  const instance = { get: vi.fn(), post: vi.fn(), put: vi.fn() };
  return { default: instance, ...instance };
});

import * as operations from "../services/operationsService";
import * as invoices from "../services/invoiceService";
import * as feedback from "../services/feedbackService";

const mockedAxios = vi.mocked(axios, true);
const SHARED_TOKEN = "zerowaste-local-admin-token";

const ok = { data: {} };

/** The header bag a call was issued with, whichever verb it used. */
function headersOf(call: unknown[]): Record<string, string> {
  const config = (call.at(-1) ?? {}) as { headers?: Record<string, string> };
  return config.headers ?? {};
}

function lastCall() {
  // Ordered across verbs: axios.get and axios.post keep separate call arrays,
  // so concatenating them blindly would report a GET from an earlier assertion
  // as the most recent request. invocationCallOrder is the shared clock.
  const all = [
    ...mockedAxios.get.mock.calls.map((args, i) => ({ verb: "get", args: args as unknown[], order: mockedAxios.get.mock.invocationCallOrder[i] })),
    ...mockedAxios.post.mock.calls.map((args, i) => ({ verb: "post", args: args as unknown[], order: mockedAxios.post.mock.invocationCallOrder[i] })),
    ...mockedAxios.put.mock.calls.map((args, i) => ({ verb: "put", args: args as unknown[], order: mockedAxios.put.mock.invocationCallOrder[i] })),
  ].sort((a, b) => a.order - b.order);
  return all.at(-1)!;
}

beforeEach(() => {
  mockedAxios.get.mockResolvedValue(ok);
  mockedAxios.post.mockResolvedValue(ok);
  mockedAxios.put.mockResolvedValue(ok);
});

describe("API base", () => {
  it("targets the backend origin", () => {
    expect(feedback.API_BASE).toBe("http://localhost:5000");
  });
});

describe("admin calls carry the administrator token", () => {
  const adminCalls: [string, () => unknown][] = [
    ["operations: today plan", () => operations.getTodayPlan()],
    ["operations: accuracy", () => operations.getAccuracyReport()],
    ["operations: esg", () => operations.getEsgReport()],
    ["operations: read roster", () => operations.getRoster()],
    ["operations: write roster", () => operations.saveRoster({ totalEmployees: 400 })],
    ["operations: record service", () => operations.recordService({ servedOn: "2025-01-06", dishes: [] })],
    ["analytics: feedback", () => feedback.getFeedbackAnalytics()],
    ["analytics: portion signals", () => feedback.getPortionSignals()],
    ["invoices: import", () => invoices.importInvoices([])],
    ["invoices: scan drop folder", () => invoices.scanDropFolder()],
    ["invoices: records", () => invoices.getInvoiceRecords()],
    ["invoices: analytics", () => invoices.getInvoiceAnalytics()],
    ["invoices: import history", () => invoices.getImportHistory()],
    ["invoices: audit trail", () => invoices.getAuditTrail()],
    ["invoices: conflicts", () => invoices.getConflicts()],
    ["invoices: resolve conflict", () => invoices.resolveConflict("c1", "accept-incoming")],
    ["invoices: dataset", () => invoices.getDataset()],
    ["invoices: pipeline", () => invoices.getInvoicePipeline()],
  ];

  it.each(adminCalls)("%s sends x-admin-token", async (_name, call) => {
    await call();
    expect(headersOf(lastCall().args)["x-admin-token"]).toBe(SHARED_TOKEN);
  });

  it.each(adminCalls)("%s targets an admin route", async (_name, call) => {
    await call();
    expect(String(lastCall().args[0])).toMatch(/\/admin\//);
  });
});

describe("employee self-service calls carry no admin credential", () => {
  const employeeCalls: [string, () => unknown][] = [
    ["menu", () => operations.getMenu()],
    ["save my bookings", () => operations.saveBookings("emp-1", [], [])],
    ["read my bookings", () => operations.getMyBookings("emp-1")],
    ["my impact", () => operations.getMyImpact("emp-1")],
    ["portion advice", () => operations.getPortionAdvice()],
    [
      "submit feedback",
      () =>
        feedback.submitFeedback({
          employeeId: "emp-1",
          bookingId: "Monday-Lunch",
          dish: "Veg Biryani",
          category: "Lunch",
          weekday: "Monday",
          response: "Finished",
          servedOn: "2025-01-06",
        }),
    ],
    ["my feedback", () => feedback.getMyFeedback("emp-1")],
    ["pipeline view", () => feedback.getPipeline(12)],
  ];

  it.each(employeeCalls)("%s does not send x-admin-token", async (_name, call) => {
    await call();
    expect(headersOf(lastCall().args)["x-admin-token"]).toBeUndefined();
  });

  it.each(employeeCalls)("%s does not target an admin route", async (_name, call) => {
    await call();
    expect(String(lastCall().args[0])).not.toMatch(/\/admin\//);
  });
});

describe("self-service reads are scoped to the caller", () => {
  it("reads bookings for the given pseudonym only", async () => {
    await operations.getMyBookings("emp-alice");
    expect(mockedAxios.get.mock.calls.at(-1)?.[1]).toMatchObject({ params: { employeeId: "emp-alice" } });
  });

  it("reads impact for the given pseudonym only", async () => {
    await operations.getMyImpact("emp-alice");
    expect(mockedAxios.get.mock.calls.at(-1)?.[1]).toMatchObject({ params: { employeeId: "emp-alice" } });
  });

  it("reads feedback for the given pseudonym only", async () => {
    await feedback.getMyFeedback("emp-alice");
    expect(mockedAxios.get.mock.calls.at(-1)?.[1]).toMatchObject({ params: { employeeId: "emp-alice" } });
  });

  /**
   * KNOWN GAP (audit C4 -- Critical). The pseudonym is supplied by the caller
   * and the server does not tie it to a session, so substituting someone
   * else's id returns their data. The client is not where this can be fixed;
   * the test records that the identifier is client-chosen.
   */
  it("KNOWN GAP: sends whatever pseudonym it is handed, including another employee's", async () => {
    await operations.getMyBookings("emp-someone-else");
    expect(mockedAxios.get.mock.calls.at(-1)?.[1]).toMatchObject({ params: { employeeId: "emp-someone-else" } });
  });
});

describe("the shared administrator secret", () => {
  /**
   * KNOWN GAP (audit C2 -- Critical). The same literal appears in three
   * frontend modules and as the backend default. Any employee can read it out
   * of the shipped bundle and then call every admin route directly.
   */
  it("KNOWN GAP: is a hardcoded literal shipped to every browser", async () => {
    await operations.getTodayPlan();
    const fromOperations = headersOf(lastCall().args)["x-admin-token"];
    await feedback.getFeedbackAnalytics();
    const fromFeedback = headersOf(lastCall().args)["x-admin-token"];
    await invoices.getDataset();
    const fromInvoices = headersOf(lastCall().args)["x-admin-token"];

    expect(fromOperations).toBe(SHARED_TOKEN);
    expect(fromFeedback).toBe(SHARED_TOKEN);
    expect(fromInvoices).toBe(SHARED_TOKEN);
    // One secret, three copies, no per-user identity anywhere.
    expect(new Set([fromOperations, fromFeedback, fromInvoices]).size).toBe(1);
  });

  /**
   * KNOWN GAP (audit H4 -- High). The invoice API attributes actions to
   * whatever the client puts in x-admin-actor, so the audit trail can be
   * written to say anything.
   */
  it("KNOWN GAP: lets the client choose the actor recorded in the audit trail", async () => {
    await invoices.importInvoices([], "someone.else@example.com");
    expect(headersOf(lastCall().args)["x-admin-actor"]).toBe("someone.else@example.com");
  });

  it("defaults the actor to 'admin' when none is given", async () => {
    await invoices.getDataset();
    expect(headersOf(lastCall().args)["x-admin-actor"]).toBe("admin");
  });
});

describe("invoice upload", () => {
  it("posts the files as multipart form data under the 'invoices' field", async () => {
    const file = new File([new Uint8Array([0x25, 0x50, 0x44, 0x46])], "invoice.pdf", { type: "application/pdf" });
    await invoices.importInvoices([file]);
    const body = mockedAxios.post.mock.calls.at(-1)?.[1] as FormData;
    expect(body).toBeInstanceOf(FormData);
    expect(body.getAll("invoices")).toHaveLength(1);
  });

  it("sends every selected file in one batch", async () => {
    const files = ["a.pdf", "b.pdf", "c.pdf"].map((name) => new File([new Uint8Array([0x25])], name, { type: "application/pdf" }));
    await invoices.importInvoices(files);
    const body = mockedAxios.post.mock.calls.at(-1)?.[1] as FormData;
    expect(body.getAll("invoices")).toHaveLength(3);
  });

  it("escapes a conflict id into the resolve path", async () => {
    await invoices.resolveConflict("conflict/../../etc/passwd", "keep-existing");
    expect(String(lastCall().args[0])).toContain(encodeURIComponent("conflict/../../etc/passwd"));
    expect(String(lastCall().args[0])).not.toContain("../");
  });
});
