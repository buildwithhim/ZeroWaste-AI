/**
 * CRITICAL JOURNEY 2 -- Admin login -> view bookings -> view prediction.
 *
 * The point of this journey is that the admin sees *aggregates the backend
 * computed*, not identities and not browser arithmetic. So it checks three
 * things at once: the figures appear, they match the API the page reads, and
 * nothing about an individual employee is anywhere on the page.
 */

import { expect, test } from "@playwright/test";

import { API_BASE, adminHeaders } from "../fixtures/env";
import { clearLocalPlan, seedEmployeeIdentity, signInThroughUi, uniqueEmployeeId } from "../fixtures/app";

test.describe("Journey 2: admin reviews bookings and the forecast", () => {
  /** A booking placed through the API so the admin has something real to look at. */
  async function placeBooking(request: import("@playwright/test").APIRequestContext, employeeId: string) {
    const menu = await (await request.get(`${API_BASE}/operations/menu`)).json();
    const plan = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();
    const dish = menu.menu.find((entry: { dish: string }) => entry.dish === plan.dishes[0]?.dish) ?? menu.menu[0];

    const response = await request.post(`${API_BASE}/operations/bookings`, {
      data: {
        employeeId,
        bookings: [{ id: "Journey2-Lunch", dish: dish.dish, category: dish.category, servedOn: plan.date, appetite: "Regular" }],
        scopeDates: [plan.date],
      },
    });
    expect(response.ok()).toBe(true);
    return { dish: dish.dish, date: plan.date };
  }

  test("signs in, reads today's booking count, and sees a forecast built from it", async ({ page, request }) => {
    const employeeId = uniqueEmployeeId("journey2");
    const { dish } = await placeBooking(request, employeeId);

    await test.step("sign in as an administrator", async () => {
      await signInThroughUi(page, "admin");
      await expect(page.getByRole("heading", { name: "How much should the cafeteria prepare today?" })).toBeVisible();
    });

    const apiPlan = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();

    await test.step("the booking count on screen is the backend's, not the browser's", async () => {
      const preBookings = page.locator(".metric-card").filter({ hasText: "Pre-bookings" });
      await expect(preBookings).toBeVisible();
      // CountUp animates, so the final value is polled rather than read once.
      await expect
        .poll(async () => (await preBookings.locator("strong").innerText()).replace(/\D/g, ""), { timeout: 20_000 })
        .toBe(String(apiPlan.today.preBookings));
      expect(apiPlan.today.preBookings).toBeGreaterThan(0);
    });

    await test.step("the prediction is shown alongside the recommendation", async () => {
      const predicted = page.locator(".metric-card").filter({ hasText: "Predicted demand" });
      const recommended = page.locator(".metric-card").filter({ hasText: "Recommended cook" });
      await expect(predicted).toBeVisible();
      await expect(recommended).toBeVisible();
      await expect
        .poll(async () => (await predicted.locator("strong").innerText()).replace(/\D/g, ""), { timeout: 20_000 })
        .toBe(String(apiPlan.today.predictedDemand));
      await expect
        .poll(async () => (await recommended.locator("strong").innerText()).replace(/\D/g, ""), { timeout: 20_000 })
        .toBe(String(apiPlan.today.recommendedCook));
    });

    await test.step("the recommendation is never below the prediction", async () => {
      // Cooking less than the forecast would guarantee a shortfall; the buffer
      // is what turns a forecast into a cooking instruction.
      expect(apiPlan.today.recommendedCook).toBeGreaterThanOrEqual(apiPlan.today.predictedDemand);
    });

    await test.step("the booked dish appears in the dish-level plan", async () => {
      const table = page.locator(".ops-table");
      await expect(table.first()).toBeVisible();
      await expect(page.getByRole("rowheader", { name: new RegExp(dish.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toBeVisible();
    });

    await test.step("no individual employee is identifiable anywhere on the page", async () => {
      const body = (await page.locator("body").innerText()).toLowerCase();
      expect(body).not.toContain(employeeId.toLowerCase());
      expect(body).not.toContain("emp-");
      expect(body).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.]+/);
    });

    await test.step("the page shows how the forecast was reached", async () => {
      await expect(page.getByRole("heading", { name: "Can this forecast be trusted?" })).toBeVisible();
      await expect(page.locator(".ops-evidence-card").filter({ hasText: "Forecast accuracy" })).toBeVisible();
    });
  });

  test("the admin sees an aggregate, never a list of who booked what", async ({ page, request }) => {
    const alice = uniqueEmployeeId("alice");
    const bob = uniqueEmployeeId("bob");
    await placeBooking(request, alice);
    await placeBooking(request, bob);

    await signInThroughUi(page, "admin");
    await expect(page.getByRole("heading", { name: "How much should the cafeteria prepare today?" })).toBeVisible();

    const body = await page.locator("body").innerText();
    expect(body).not.toContain(alice);
    expect(body).not.toContain(bob);

    // The API the page reads returns counts, not rows.
    const apiPlan = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();
    expect(JSON.stringify(apiPlan)).not.toContain("emp-");
    expect(apiPlan.today.employeesBooked).toBeGreaterThan(0);
  });

  test("navigating the operations areas keeps the admin inside the admin app", async ({ page }) => {
    await signInThroughUi(page, "admin");

    for (const [link, heading] of [
      ["Kitchen", /Dish-wise recommendations/],
      ["Analytics", /./],
      ["ESG Report", /./],
      ["Overview", /How much should the cafeteria prepare today\?/],
    ] as const) {
      await page.getByRole("link", { name: new RegExp(link) }).click();
      await expect(page).toHaveURL(/\/admin/);
      await expect(page.locator("h1").first()).toBeVisible();
      if (heading.source !== ".") await expect(page.getByRole("heading", { name: heading })).toBeVisible();
    }
  });

  test("the employee navigation is not even nameable from the admin shell", async ({ page }) => {
    await signInThroughUi(page, "admin");
    const sidebar = page.locator(".sidebar-links");
    await expect(sidebar.getByRole("link", { name: "Book meals" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "My week" })).toHaveCount(0);
    await expect(sidebar.getByRole("link", { name: "Invoice Sync" })).toBeVisible();
  });

  test("an admin who signs out cannot walk back into the operations hub", async ({ page }) => {
    await signInThroughUi(page, "admin");
    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
    await expect(page).toHaveURL(/\/login/);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("heading", { name: /Better decisions/ })).toBeVisible();
  });
});
