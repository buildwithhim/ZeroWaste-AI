/**
 * CRITICAL JOURNEY 3 -- Kitchen -> view recommendation -> record waste.
 *
 * IMPORTANT, and the reason this spec is shaped differently to the others:
 * there is no waste-recording screen. `recordService` exists in
 * frontend/src/services/operationsService.ts but no page imports it, so the
 * only way to close a service day today is the API. The journey is therefore
 * driven half through the UI (the recommendation the kitchen reads) and half
 * through the API (the actuals the kitchen reports back), and the seam between
 * the two is asserted: what the kitchen was told to cook is what gets graded.
 *
 * When the recording UI lands, the API steps below should be replaced with UI
 * steps -- the assertions either side of them stay exactly as they are.
 */

import { expect, test } from "@playwright/test";

import { API_BASE, adminHeaders } from "../fixtures/env";
import { signInThroughUi } from "../fixtures/app";

type DishCard = { dish: string; category: string; recommendedCook: number; preBooked: number };

test.describe("Journey 3: the kitchen cooks to the recommendation and reports back", () => {
  test("reads a per-dish recommendation on screen, cooks it, and records the leftovers", async ({ page, request }) => {
    await test.step("the kitchen opens its board", async () => {
      await signInThroughUi(page, "admin");
      await page.getByRole("link", { name: /Kitchen/ }).click();
      await expect(page.getByRole("heading", { name: "Dish-wise recommendations." })).toBeVisible();
    });

    const plan = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();
    const target: DishCard = plan.dishes[0];
    expect(target, "the plan must recommend at least one dish").toBeTruthy();

    const card = page.locator(".dish-recommendation-card").filter({ has: page.getByRole("heading", { name: target.dish, exact: true }) });

    await test.step("the card carries the figure the cook acts on", async () => {
      await expect(card).toBeVisible();
      const recommended = card.locator(".dish-metrics span").filter({ hasText: "Recommended cook" }).locator("strong");
      await expect(recommended).toHaveText(String(target.recommendedCook));
      // A recommendation the kitchen cannot act on is useless: it must also say
      // how much raw food that is, and how risky over-cooking it would be.
      await expect(card.locator(".dish-metrics span").filter({ hasText: "Food to prepare" }).locator("strong")).toContainText("kg");
      await expect(card.locator(".risk-row")).toContainText(/Low|Medium|High/);
    });

    await test.step("every dish on the board is costed, not just the first", async () => {
      const cards = page.locator(".dish-recommendation-card");
      await expect(cards).toHaveCount(plan.dishes.length);
      for (const dish of plan.dishes) {
        const each = page.locator(".dish-recommendation-card").filter({
          has: page.getByRole("heading", { name: dish.dish, exact: true }),
        });
        await expect(each.locator(".dish-metrics span").filter({ hasText: "Recommended cook" }).locator("strong")).toHaveText(
          String(dish.recommendedCook),
        );
      }
    });

    await test.step("the prep checklist is the kitchen's own working state", async () => {
      const checklist = page.locator(".preparation-checklist");
      await expect(checklist.getByRole("heading", { name: "Today's kitchen run" })).toBeVisible();
      const firstToggle = checklist.getByRole("button").first();
      await expect(firstToggle).toHaveAttribute("aria-pressed", "false");
      await firstToggle.click();
      await expect(firstToggle).toHaveAttribute("aria-pressed", "true");
      // It is UI state only -- it must not be masquerading as a service record.
      const before = await (await request.get(`${API_BASE}/admin/operations/service`, { headers: adminHeaders })).json();
      expect(before.recordedDates).not.toContain(plan.date);
    });

    const cooked = target.recommendedCook;
    const served = Math.max(1, Math.round(cooked * 0.85));

    await test.step("the kitchen reports what was actually cooked and served", async () => {
      // KNOWN GAP: no UI exists for this step -- see the file header.
      const response = await request.post(`${API_BASE}/admin/operations/service`, {
        headers: adminHeaders,
        data: { servedOn: plan.date, dishes: [{ dish: target.dish, cookedPortions: cooked, servedPortions: served }] },
      });
      expect(response.status()).toBe(201);
      expect(await response.json()).toMatchObject({ servedOn: plan.date, accepted: 1, rejected: [] });
    });

    await test.step("the leftovers are derived by the backend, never supplied by the caller", async () => {
      const day = await (
        await request.get(`${API_BASE}/admin/operations/service?date=${plan.date}`, { headers: adminHeaders })
      ).json();
      const entry = day.entries.find((row: { dish: string }) => row.dish === target.dish);
      expect(entry).toBeTruthy();
      expect(entry.cookedPortions).toBe(cooked);
      expect(entry.servedPortions).toBe(served);
      expect(entry.leftoverPortions).toBe(cooked - served);
      expect(entry.leftoverKg).toBeGreaterThan(0);
    });

    await test.step("the closed day now counts as evidence in the operations report", async () => {
      const report = await (await request.get(`${API_BASE}/admin/operations/accuracy`, { headers: adminHeaders })).json();
      // The day just closed must show up as measured waste, not as a forecast.
      const day = report.historicalWaste.daily.find((row: { servedOn: string }) => row.servedOn === plan.date);
      expect(day, "the closed service day should appear in measured history").toBeTruthy();
      expect(day.leftoverKg).toBeGreaterThan(0);

      const dates = await (await request.get(`${API_BASE}/admin/operations/service`, { headers: adminHeaders })).json();
      expect(dates.recordedDates).toContain(plan.date);
    });
  });

  test("a correction supersedes the first figure instead of double-counting it", async ({ request }) => {
    const plan = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();
    const dish = plan.dishes[0].dish;
    const servedOn = plan.date;

    await request.post(`${API_BASE}/admin/operations/service`, {
      headers: adminHeaders,
      data: { servedOn, dishes: [{ dish, cookedPortions: 100, servedPortions: 20 }] },
    });
    await request.post(`${API_BASE}/admin/operations/service`, {
      headers: adminHeaders,
      data: { servedOn, dishes: [{ dish, cookedPortions: 100, servedPortions: 90 }] },
    });

    const day = await (await request.get(`${API_BASE}/admin/operations/service?date=${servedOn}`, { headers: adminHeaders })).json();
    const rows = day.entries.filter((row: { dish: string }) => row.dish === dish);
    expect(rows).toHaveLength(1);
    expect(rows[0].servedPortions).toBe(90);
    expect(rows[0].leftoverPortions).toBe(10);
  });

  test("a physically impossible service is refused rather than stored", async ({ request }) => {
    const plan = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();

    const response = await request.post(`${API_BASE}/admin/operations/service`, {
      headers: adminHeaders,
      data: { servedOn: plan.date, dishes: [{ dish: plan.dishes[0].dish, cookedPortions: 10, servedPortions: 40 }] },
    });

    const body = await response.json();
    expect(body.accepted).toBe(0);
    expect(body.rejected[0].reason).toMatch(/cannot exceed/i);
  });

  test("waste recording is an admin capability, not an open endpoint", async ({ request }) => {
    const plan = await (await request.get(`${API_BASE}/admin/operations/today`, { headers: adminHeaders })).json();
    const payload = { servedOn: plan.date, dishes: [{ dish: plan.dishes[0].dish, cookedPortions: 5, servedPortions: 1 }] };

    expect((await request.post(`${API_BASE}/admin/operations/service`, { data: payload })).status()).toBe(403);
    expect(
      (
        await request.post(`${API_BASE}/admin/operations/service`, {
          headers: { "x-admin-token": "employee-guess" },
          data: payload,
        })
      ).status(),
    ).toBe(403);
    expect((await request.get(`${API_BASE}/admin/operations/service`)).status()).toBe(403);
  });
});
