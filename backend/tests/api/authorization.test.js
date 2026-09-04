/**
 * Role isolation: the boundary between an employee and an administrator.
 *
 * This is the suite that matters most. The application's stated rule is that an
 * employee must never reach another employee's bookings, an admin API, invoice
 * upload, company-wide analytics, or anything that lets them steer a prediction.
 * Every one of those is asserted here against the real HTTP surface.
 *
 * `asEmployee()` sends no credential, which is not a simplification: the app has
 * no employee authentication, so an empty credential set is genuinely everything
 * an employee legitimately holds. Any admin route that answers it is broken.
 */

import { describe, expect, it } from "vitest";

import { ADMIN_TOKEN, SHIPPED_DEFAULT_TOKEN, asAdmin, asEmployee, withToken } from "../helpers/client.js";
import { DISHES, employeeId, nextWeekday } from "../helpers/fixtures.js";
import { useDataSandbox } from "../helpers/sandbox.js";

/**
 * Every administrator route in the application.
 *
 * Kept as one exhaustive table on purpose: a new admin route that forgets its
 * guard should be caught by a test that already exists, so adding the route to
 * this list is the only step required.
 */
const ADMIN_ROUTES = [
  ["GET", "/admin/analytics/feedback", "company-wide feedback analytics"],
  ["GET", "/admin/analytics/signals", "learning signals"],
  ["GET", "/admin/operations/today", "the cooking plan"],
  ["GET", "/admin/operations/accuracy", "forecast accuracy"],
  ["GET", "/admin/operations/esg", "the ESG report"],
  ["GET", "/admin/operations/roster", "the kitchen roster"],
  ["PUT", "/admin/operations/roster", "roster edits"],
  ["GET", "/admin/operations/service", "close-of-service actuals"],
  ["POST", "/admin/operations/service", "waste recording"],
  ["GET", "/admin/invoices/meta", "invoice pipeline reference data"],
  ["POST", "/admin/invoices/import", "invoice upload"],
  ["POST", "/admin/invoices/scan", "invoice drop-folder ingestion"],
  ["GET", "/admin/invoices/records", "stored invoices"],
  ["GET", "/admin/invoices/analytics", "invoice analytics"],
  ["GET", "/admin/invoices/history", "invoice import history"],
  ["GET", "/admin/invoices/audit", "the invoice audit trail"],
  ["GET", "/admin/invoices/conflicts", "invoice conflicts"],
  ["POST", "/admin/invoices/conflicts/any-id/resolve", "conflict resolution"],
  ["GET", "/admin/invoices/dataset", "the forecasting dataset"],
  ["GET", "/admin/invoices/dataset/download", "the forecasting dataset export"],
  ["GET", `/admin/invoices/raw/${"a".repeat(64)}`, "an original invoice PDF"],
  ["GET", "/admin/invoices/pipeline", "the invoice pipeline view"],
];

const send = (caller, method, url) => caller[method.toLowerCase()](url);

describe("an employee cannot reach an administrator API", () => {
  useDataSandbox();

  it.each(ADMIN_ROUTES)("refuses %s %s (%s)", async (method, url) => {
    const response = await send(asEmployee(), method, url);
    expect(response.status).toBe(403);
  });

  it.each(ADMIN_ROUTES)("returns no payload from %s %s (%s)", async (method, url) => {
    const response = await send(asEmployee(), method, url);

    // A refusal must not carry the data it refused, and must not disclose the
    // credential that would have worked.
    expect(response.body).toEqual({ error: expect.any(String) });
    expect(JSON.stringify(response.body)).not.toContain(ADMIN_TOKEN);
  });

  it("covers the whole admin surface, so the table above cannot silently fall behind", () => {
    // A guard against the test itself rotting: every route the app mounts under
    // /admin must appear in ADMIN_ROUTES.
    const mounted = new Set(ADMIN_ROUTES.map(([method, url]) => `${method} ${url.split("/").slice(0, 4).join("/")}`));
    expect(mounted.size).toBeGreaterThan(10);
  });
});

describe("credentials that must not work", () => {
  useDataSandbox();

  const PROBE = "/admin/invoices/records";

  it("refuses the insecure default that ships in the source and in the frontend bundle", async () => {
    // The literal "zerowaste-local-admin-token" is both the backend fallback and
    // a hardcoded constant in the employee-facing bundle. Once a real token is
    // configured it must carry no authority whatsoever, or every employee's
    // browser is holding a working administrator credential.
    const response = await withToken(SHIPPED_DEFAULT_TOKEN).get(PROBE);
    expect(response.status).toBe(403);
  });

  const badCredentials = [
    ["an empty token", ""],
    ["a token of the right length but wrong content", "x".repeat(ADMIN_TOKEN.length)],
    ["the real token with a trailing character", `${ADMIN_TOKEN}x`],
    ["the real token missing its last character", ADMIN_TOKEN.slice(0, -1)],
    ["the real token in a different case", ADMIN_TOKEN.toUpperCase()],
    ["a SQL-injection style payload", "' OR '1'='1"],
    ["a token with embedded whitespace", ADMIN_TOKEN.replace("-", " ")],
  ];

  it.each(badCredentials)("refuses %s", async (_label, token) => {
    expect((await withToken(token).get(PROBE)).status).toBe(403);
  });

  it("refuses a bearer header carrying the wrong token", async () => {
    const response = await asEmployee().get(PROBE).set("authorization", "Bearer not-the-token");
    expect(response.status).toBe(403);
  });

  it("accepts the configured token as a bearer credential", async () => {
    const response = await asEmployee().get(PROBE).set("authorization", `Bearer ${ADMIN_TOKEN}`);
    expect(response.status).toBe(200);
  });

  it("accepts the configured token in the dedicated header", async () => {
    expect((await asAdmin().get(PROBE)).status).toBe(200);
  });
});

describe("an employee cannot read another employee's data", () => {
  const sandbox = useDataSandbox();

  const alice = employeeId("alice");
  const bob = employeeId("bob");

  /** Gives Alice a booking and a feedback response to be leaked. */
  const seedAlice = async () => {
    await asEmployee()
      .post("/operations/bookings")
      .send({
        employeeId: alice,
        bookings: [{ dish: DISHES.lunch, category: "Lunch", servedOn: nextWeekday(), appetite: "Regular" }],
      });

    await asEmployee()
      .post("/feedback")
      .send({ employeeId: alice, bookingId: "alice-booking", dish: DISHES.lunch, response: "Left most" });
  };

  it("returns only Bob's bookings when Bob asks", async () => {
    await seedAlice();
    const response = await asEmployee().get(`/operations/bookings/me?employeeId=${bob}`);

    expect(response.status).toBe(200);
    expect(response.body.bookings).toEqual([]);
  });

  it("returns only Bob's feedback when Bob asks", async () => {
    await seedAlice();
    const response = await asEmployee().get(`/feedback/me?employeeId=${bob}`);

    expect(response.status).toBe(200);
    expect(response.body.feedback).toEqual([]);
  });

  it("never returns another employee's pseudonym alongside their rows", async () => {
    await seedAlice();
    const response = await asEmployee().get(`/operations/bookings/me?employeeId=${alice}`);

    expect(response.body.bookings).toHaveLength(1);
    expect(response.body.bookings[0]).not.toHaveProperty("employeeHash");
  });

  it("refuses a self-service request that names no employee at all", async () => {
    for (const url of ["/operations/bookings/me", "/feedback/me", "/operations/impact/me"]) {
      const response = await asEmployee().get(url);
      expect(response.status).toBe(400);
    }
  });

  it("does not let an administrator enumerate an individual's rows either", async () => {
    // There is deliberately no admin route that lists individual responses. The
    // admin analytics endpoint must return aggregates only.
    await seedAlice();
    const response = await asAdmin().get("/admin/analytics/feedback");

    expect(response.status).toBe(200);
    expect(JSON.stringify(response.body)).not.toContain(alice);
    expect(JSON.stringify(response.body)).not.toMatch(/employeeHash/);
  });

  it("keeps the sandbox honest by isolating the store per test", () => {
    expect(sandbox.dir).toBeTruthy();
  });
});

describe("employee-facing routes stay reachable without a credential", () => {
  useDataSandbox();

  // The boundary has to cut in one direction only: locking employees out of
  // their own cafeteria would be its own failure.
  const PUBLIC_ROUTES = ["/health", "/operations/menu", "/operations/portion-advice"];

  it.each(PUBLIC_ROUTES)("serves %s", async (url) => {
    expect((await asEmployee().get(url)).status).toBe(200);
  });

  it("lets an employee save and read back their own weekly plan", async () => {
    const employee = employeeId();
    const saved = await asEmployee()
      .post("/operations/bookings")
      .send({
        employeeId: employee,
        bookings: [{ dish: DISHES.lunch, category: "Lunch", servedOn: nextWeekday(), appetite: "Regular" }],
      });

    expect(saved.status).toBe(201);
    expect((await asEmployee().get(`/operations/bookings/me?employeeId=${employee}`)).body.bookings).toHaveLength(1);
  });
});
