/**
 * ROLE ISOLATION -- the boundary an employee must never cross.
 *
 * The stated requirement is that an employee can never: read another
 * employee's bookings, reach an admin API, upload invoices, see company-wide
 * analytics, or move a prediction. Each of those is a test below, exercised
 * from a real employee browser session rather than a bare HTTP client, so a
 * regression in either the router guard or the client-side routing is caught.
 *
 * Several of these currently FAIL to hold, and are written as `KNOWN GAP:`
 * characterization tests that assert today's insecure behaviour with the
 * SECURITY_AUDIT.md finding named. They are deliberate: they pin the gap so it
 * cannot widen unnoticed, and they invert into the correct assertion the moment
 * the finding is fixed. Do not "fix" them by loosening them.
 */

import { expect, test, type Page } from "@playwright/test";

import { API_BASE, E2E_ADMIN_TOKEN, adminHeaders } from "../fixtures/env";
import { seedEmployeeIdentity, signInThroughUi, uniqueEmployeeId } from "../fixtures/app";
import { invoicePdf, uniqueOrderId } from "../fixtures/invoicePdf";

/** Every admin route, as an employee would have to guess at them. */
const ADMIN_ENDPOINTS = [
  ["GET", "/admin/operations/today"],
  ["GET", "/admin/operations/accuracy"],
  ["GET", "/admin/operations/esg"],
  ["GET", "/admin/operations/roster"],
  ["PUT", "/admin/operations/roster"],
  ["GET", "/admin/operations/service"],
  ["POST", "/admin/operations/service"],
  ["GET", "/admin/invoices/meta"],
  ["POST", "/admin/invoices/import"],
  ["POST", "/admin/invoices/scan"],
  ["GET", "/admin/invoices/records"],
  ["GET", "/admin/invoices/analytics"],
  ["GET", "/admin/invoices/history"],
  ["GET", "/admin/invoices/audit"],
  ["GET", "/admin/invoices/conflicts"],
  ["GET", "/admin/invoices/dataset"],
  ["GET", "/admin/invoices/dataset/download"],
  ["GET", "/admin/invoices/pipeline"],
] as const;

/**
 * Issues a request from inside the employee's own browser.
 *
 * Note the absence of `credentials: "include"`: the backend answers with a
 * wildcard `Access-Control-Allow-Origin` (audit H1), and a browser refuses to
 * pair a wildcard origin with credentials. There is nothing to send anyway --
 * there is no server-side session (audit C1) -- which is itself the point.
 */
async function fromEmployeeBrowser(page: Page, method: string, path: string) {
  return page.evaluate(
    async ([verb, url]) => {
      const response = await fetch(url, { method: verb });
      return { status: response.status, body: await response.text() };
    },
    [method, `${API_BASE}${path}`] as const,
  );
}

test.describe("Role isolation: an employee cannot become an administrator", () => {
  test("no admin API answers an employee's browser", async ({ page }) => {
    const employeeId = uniqueEmployeeId("isolation");
    await seedEmployeeIdentity(page, employeeId);
    await signInThroughUi(page, "employee");

    for (const [method, path] of ADMIN_ENDPOINTS) {
      const result = await fromEmployeeBrowser(page, method, path);
      expect(result.status, `${method} ${path} must not answer an employee`).toBe(403);
      // The refusal must not leak the thing it is protecting.
      expect(result.body).not.toContain("predictedDemand");
      expect(result.body).not.toContain("recommendedCook");
      expect(result.body.toLowerCase()).not.toContain(E2E_ADMIN_TOKEN.toLowerCase());
    }
  });

  test("an employee cannot upload an invoice", async ({ page, request }) => {
    await seedEmployeeIdentity(page, uniqueEmployeeId("no-invoice"));
    await signInThroughUi(page, "employee");

    const orderId = uniqueOrderId();
    const response = await request.post(`${API_BASE}/admin/invoices/import`, {
      multipart: {
        invoices: { name: `sneaky-${orderId}.pdf`, mimeType: "application/pdf", buffer: invoicePdf({ orderId, date: "01/04/2025", time: "12:00:00", items: [{ name: "Veg Biryani", quantity: 5, amount: "500.00" }] }) },
      },
    });
    expect(response.status()).toBe(403);

    // And nothing reached the dataset.
    const dataset = await (await request.get(`${API_BASE}/admin/invoices/dataset`, { headers: adminHeaders })).json();
    expect(JSON.stringify(dataset)).not.toContain(orderId);
  });

  test("an employee cannot see company-wide analytics", async ({ page }) => {
    await seedEmployeeIdentity(page, uniqueEmployeeId("no-analytics"));
    await signInThroughUi(page, "employee");

    for (const path of ["/admin/operations/accuracy", "/admin/operations/esg", "/admin/invoices/analytics"]) {
      const result = await fromEmployeeBrowser(page, "GET", path);
      expect(result.status).toBe(403);
      expect(result.body).not.toContain("wastePrevented");
      expect(result.body).not.toContain("forecastAccuracy");
    }
  });

  test("an employee cannot move the prediction by closing a service day", async ({ page, request }) => {
    await seedEmployeeIdentity(page, uniqueEmployeeId("no-prediction"));
    await signInThroughUi(page, "employee");

    const before = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();

    const attempt = await page.evaluate(
      async ([url, payload]) => {
        const response = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: payload,
        });
        return response.status;
      },
      [
        `${API_BASE}/admin/operations/service`,
        JSON.stringify({ servedOn: before.date, dishes: [{ dish: before.dishes[0].dish, cookedPortions: 999, servedPortions: 1 }] }),
      ] as const,
    );
    expect(attempt).toBe(403);

    const after = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();
    expect(after.today.recommendedCook).toBe(before.today.recommendedCook);
  });

  test("the admin area is not reachable by typing the URL", async ({ page }) => {
    await seedEmployeeIdentity(page, uniqueEmployeeId("no-url"));
    await signInThroughUi(page, "employee");

    for (const route of ["/admin", "/admin/kitchen", "/admin/invoices", "/admin/analytics", "/admin/esg"]) {
      await page.goto(route);
      await expect(page, `${route} must not render for an employee`).not.toHaveURL(new RegExp(`${route}$`));
      await expect(page.getByRole("heading", { name: "How much should the cafeteria prepare today?" })).toHaveCount(0);
      await expect(page.getByRole("heading", { name: "SmartQ invoice ingestion." })).toHaveCount(0);
    }
  });

  test("the employee shell offers no route into the admin area", async ({ page }) => {
    await seedEmployeeIdentity(page, uniqueEmployeeId("no-nav"));
    await signInThroughUi(page, "employee");

    const sidebar = page.locator(".sidebar-links");
    await expect(sidebar.getByRole("link", { name: "Book meals" })).toBeVisible();
    for (const admin of ["Overview", "Kitchen", "Analytics", "Data Pipeline", "Invoice Sync", "ESG Report"]) {
      await expect(sidebar.getByRole("link", { name: admin })).toHaveCount(0);
    }
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
  });

  test("KNOWN GAP (C1): the role gate is a localStorage value the employee owns", async ({ page }) => {
    // SECURITY_AUDIT.md C1 -- there is no server-side session, so promoting
    // yourself is a one-line write in the console. This asserts today's
    // behaviour; when C1 is fixed, flip it to expect the admin page NOT to load.
    await seedEmployeeIdentity(page, uniqueEmployeeId("escalation"));
    await signInThroughUi(page, "employee");

    await page.evaluate(() => window.localStorage.setItem("zerowaste-role", "admin"));
    await page.goto("/admin");

    await expect(
      page.getByRole("heading", { name: "How much should the cafeteria prepare today?" }),
      "C1 is still open: self-promotion via localStorage still works",
    ).toBeVisible();
  });

  test("KNOWN GAP (C2): the admin token ships to every browser, so the API falls too", async ({ page }) => {
    // SECURITY_AUDIT.md C2 -- the token is a literal in the frontend bundle,
    // which means the guard above is only as strong as "did not look".
    await seedEmployeeIdentity(page, uniqueEmployeeId("token"));
    await signInThroughUi(page, "employee");

    const result = await page.evaluate(
      async ([url, token]) => {
        const response = await fetch(url, { headers: { "x-admin-token": token } });
        return { status: response.status };
      },
      [`${API_BASE}/admin/operations/today`, E2E_ADMIN_TOKEN] as const,
    );

    expect(result.status, "C2 is still open: a leaked token grants full admin access").toBe(200);
  });

  test("KNOWN GAP (C4): one employee can read another's bookings by asking for them", async ({ page, request }) => {
    // SECURITY_AUDIT.md C4 -- /operations/bookings/me trusts the employeeId in
    // the query string, so "me" means "whoever I name".
    const victim = uniqueEmployeeId("victim");
    const plan = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();
    const menu = await (await request.get(`${API_BASE}/operations/menu`)).json();
    const dish = menu.menu[0];

    await request.post(`${API_BASE}/operations/bookings`, {
      data: {
        employeeId: victim,
        bookings: [{ id: "victim-1", dish: dish.dish, category: dish.category, servedOn: plan.date, appetite: "Regular" }],
        scopeDates: [plan.date],
      },
    });

    const attacker = uniqueEmployeeId("attacker");
    await seedEmployeeIdentity(page, attacker);
    await signInThroughUi(page, "employee");

    const stolen = await fromEmployeeBrowser(page, "GET", `/operations/bookings/me?employeeId=${encodeURIComponent(victim)}`);
    expect(stolen.status).toBe(200);
    expect(stolen.body, "C4 is still open: another employee's plan is readable").toContain(dish.dish);
  });
});
