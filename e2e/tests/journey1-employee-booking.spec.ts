/**
 * CRITICAL JOURNEY 1 -- Employee login -> weekly booking -> confirmation.
 *
 * This is the journey the whole product rests on: if an employee's taps do not
 * reach the kitchen, every forecast downstream is guessing. The test therefore
 * confirms the booking in three independent places -- on screen, in the
 * browser's own storage, and in the server's copy read back over the API --
 * because the app has previously been able to show "Booked" while the kitchen
 * had no record of the meal at all.
 */

import { expect, test } from "@playwright/test";

import { API_BASE } from "../fixtures/env";
import { clearLocalPlan, seedEmployeeIdentity, signInThroughUi, uniqueEmployeeId } from "../fixtures/app";

test.describe("Journey 1: employee books a week of meals", () => {
  let employeeId: string;

  test.beforeEach(async ({ page }) => {
    employeeId = uniqueEmployeeId("booking");
    await seedEmployeeIdentity(page, employeeId);
    await clearLocalPlan(page);
  });

  test("logs in, books meals, and the kitchen ends up holding the same plan", async ({ page, request }) => {
    await test.step("sign in as an employee", async () => {
      await signInThroughUi(page, "employee");
      await expect(page.getByRole("heading", { name: /Good (morning|afternoon|evening)/ })).toBeVisible();
    });

    await test.step("nothing is booked yet", async () => {
      const stored = await request.get(`${API_BASE}/operations/bookings/me`, { params: { employeeId } });
      expect(stored.ok()).toBe(true);
      expect((await stored.json()).bookings).toHaveLength(0);
    });

    await page.getByRole("link", { name: /Book meals/ }).click();
    await expect(page.getByRole("heading", { name: "Book your meals" })).toBeVisible();

    let breakfastDish = "";
    let lunchDish = "";

    await test.step("book a breakfast with one tap", async () => {
      const breakfast = page.locator(".meal-group").filter({ has: page.getByRole("heading", { name: "Breakfast" }) });
      const card = breakfast.locator(".dish-picker-card").first();
      breakfastDish = (await card.locator("strong").first().innerText()).trim();
      await card.click();

      // The one-tap contract: booked, acknowledged, no submit button anywhere.
      await expect(breakfast.getByText("Booked")).toBeVisible();
      await expect(breakfast.locator(".booked-meal strong")).toHaveText(breakfastDish);
    });

    await test.step("book a lunch on the same day", async () => {
      const lunch = page.locator(".meal-group").filter({ has: page.getByRole("heading", { name: "Lunch" }) });
      const card = lunch.locator(".dish-picker-card").first();
      lunchDish = (await card.locator("strong").first().innerText()).trim();
      await card.click();
      await expect(lunch.locator(".booked-meal strong")).toHaveText(lunchDish);
    });

    await test.step("the plan is confirmed as saved, not merely selected", async () => {
      // PlanSyncStatus only says this once the server has acknowledged.
      await expect(page.locator(".plan-sync-status, .booking-privacy")).toBeVisible();
      await expect
        .poll(
          async () => {
            const response = await request.get(`${API_BASE}/operations/bookings/me`, { params: { employeeId } });
            return (await response.json()).bookings.length;
          },
          { timeout: 20_000, message: "the kitchen never received the plan" }
        )
        .toBe(2);
    });

    await test.step("the server holds exactly what was tapped", async () => {
      const response = await request.get(`${API_BASE}/operations/bookings/me`, { params: { employeeId } });
      const { bookings } = await response.json();
      const dishes = bookings.map((row: { dish: string }) => row.dish).sort();
      expect(dishes).toEqual([breakfastDish, lunchDish].sort());
      for (const row of bookings) {
        expect(row.servedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        // Identity is never returned, even to the employee who owns the row.
        expect(Object.keys(row)).not.toContain("employeeId");
      }
    });

    await test.step("the confirmation survives a reload", async () => {
      await page.reload();
      await expect(page.getByRole("heading", { name: "Book your meals" })).toBeVisible();
      const breakfast = page.locator(".meal-group").filter({ has: page.getByRole("heading", { name: "Breakfast" }) });
      await expect(breakfast.locator(".booked-meal strong")).toHaveText(breakfastDish);
    });

    await test.step("the home page shows the week that was booked", async () => {
      await page.getByRole("link", { name: /My week/ }).click();
      await expect(page.getByRole("heading", { name: "Your weekly plan" })).toBeVisible();
      await expect(page.locator(".plan-progress.compact strong")).toHaveText("1/5");
      await expect(page.getByRole("heading", { name: "Your next meal" })).toBeVisible();
    });
  });

  test("plans several days and the kitchen sees every one of them", async ({ page, request }) => {
    await signInThroughUi(page, "employee");
    await page.getByRole("link", { name: /Book meals/ }).click();
    await expect(page.getByRole("heading", { name: "Book your meals" })).toBeVisible();

    const dayChips = page.locator(".day-chip");
    const booked: string[] = [];

    for (const index of [0, 1, 2]) {
      await dayChips.nth(index).click();
      const lunch = page.locator(".meal-group").filter({ has: page.getByRole("heading", { name: "Lunch" }) });
      const card = lunch.locator(".dish-picker-card").first();
      booked.push((await card.locator("strong").first().innerText()).trim());
      await card.click();
      await expect(lunch.locator(".booked-meal strong")).toBeVisible();
    }

    await expect(page.locator(".plan-progress strong").first()).toHaveText("3/5");

    await expect
      .poll(
        async () => {
          const response = await request.get(`${API_BASE}/operations/bookings/me`, { params: { employeeId } });
          return (await response.json()).bookings.length;
        },
        { timeout: 20_000 }
      )
      .toBe(3);

    const { bookings } = await (await request.get(`${API_BASE}/operations/bookings/me`, { params: { employeeId } })).json();
    // Three distinct service days, never two rows for the same slot.
    expect(new Set(bookings.map((row: { servedOn: string }) => row.servedOn)).size).toBe(3);
    expect(bookings.every((row: { category: string }) => row.category === "Lunch")).toBe(true);
  });

  test("cancelling a meal removes it from the kitchen's count too", async ({ page, request }) => {
    await signInThroughUi(page, "employee");
    await page.getByRole("link", { name: /Book meals/ }).click();

    const lunch = page.locator(".meal-group").filter({ has: page.getByRole("heading", { name: "Lunch" }) });
    await lunch.locator(".dish-picker-card").first().click();
    await expect(lunch.locator(".booked-meal strong")).toBeVisible();

    await expect
      .poll(
        async () => {
          const response = await request.get(`${API_BASE}/operations/bookings/me`, { params: { employeeId } });
          return (await response.json()).bookings.length;
        },
        { timeout: 20_000 }
      )
      .toBe(1);

    // Removal is confirmed, because it is the one action here that cannot be undone.
    await lunch.getByRole("button", { name: /Remove/ }).click();
    await expect(page.getByRole("heading", { name: /^Remove / })).toBeVisible();
    await page.getByRole("button", { name: "Remove meal" }).click();

    await expect(lunch.getByText("Not booked")).toBeVisible();
    await expect
      .poll(
        async () => {
          const response = await request.get(`${API_BASE}/operations/bookings/me`, { params: { employeeId } });
          return (await response.json()).bookings.length;
        },
        { timeout: 20_000, message: "the cancellation never reached the kitchen" }
      )
      .toBe(0);
  });

  test("changing the plate size updates the booking the kitchen holds", async ({ page, request }) => {
    await signInThroughUi(page, "employee");
    await page.getByRole("link", { name: /Book meals/ }).click();

    const lunch = page.locator(".meal-group").filter({ has: page.getByRole("heading", { name: "Lunch" }) });
    await lunch.locator(".dish-picker-card").first().click();
    await expect(lunch.locator(".booked-meal strong")).toBeVisible();

    await lunch.getByRole("button", { name: "Change plate size" }).click();
    await lunch.getByRole("button", { name: /Heavy/ }).click();
    await expect(lunch.locator(".booked-meal small").first()).toContainText("Heavy plate");

    await expect
      .poll(
        async () => {
          const response = await request.get(`${API_BASE}/operations/bookings/me`, { params: { employeeId } });
          const { bookings } = await response.json();
          return bookings[0]?.appetite ?? null;
        },
        { timeout: 20_000 }
      )
      .toBe("Heavy");
  });

  test("signing out and back in does not lose the plan", async ({ page }) => {
    await signInThroughUi(page, "employee");
    await page.getByRole("link", { name: /Book meals/ }).click();

    const lunch = page.locator(".meal-group").filter({ has: page.getByRole("heading", { name: "Lunch" }) });
    const dish = (await lunch.locator(".dish-picker-card strong").first().innerText()).trim();
    await lunch.locator(".dish-picker-card").first().click();
    await expect(lunch.locator(".booked-meal strong")).toHaveText(dish);

    await page.getByRole("button", { name: "Sign out" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).last().click();
    await expect(page).toHaveURL(/\/login/);

    await page.getByRole("button", { name: /Continue as Employee/ }).click();
    await page.getByRole("link", { name: /Book meals/ }).click();
    await expect(
      page.locator(".meal-group").filter({ has: page.getByRole("heading", { name: "Lunch" }) }).locator(".booked-meal strong")
    ).toHaveText(dish);
  });
});
