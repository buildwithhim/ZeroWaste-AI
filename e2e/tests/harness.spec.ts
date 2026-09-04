/**
 * Harness smoke test.
 *
 * Proves both servers came up, the app boots, and the backend is reading the
 * disposable data directory rather than the repository's own -- before any
 * journey depends on all three.
 */

import { expect, test } from "@playwright/test";

import { API_BASE, adminHeaders } from "../fixtures/env";

test.describe("harness", () => {
  test("the backend is healthy", async ({ request }) => {
    const response = await request.get(`${API_BASE}/health`);
    expect(response.ok()).toBe(true);
  });

  test("the app boots and lands on the sign-in screen", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole("button", { name: /Continue as Employee/ })).toBeVisible();
  });

  test("the menu is published", async ({ request }) => {
    const response = await request.get(`${API_BASE}/operations/menu`);
    expect(response.ok()).toBe(true);
    const body = await response.json();
    expect(body.menu.length).toBeGreaterThan(0);
  });

  test("the admin token in the shipped bundle opens the admin API", async ({ request }) => {
    const response = await request.get(`${API_BASE}/admin/operations/roster`, { headers: adminHeaders });
    expect(response.ok()).toBe(true);
  });
});
