/**
 * Shared page helpers.
 *
 * Signing in is a client-side role choice with no server round trip, so it is
 * expressed here once: seed the role before the app boots, or drive the login
 * screen when the journey is specifically about logging in.
 */

import { expect, type Page } from "@playwright/test";

import { APP_BASE } from "./env";

export type Role = "employee" | "admin";

/**
 * Signs in through the interface, as a real person would.
 *
 * Used by the journeys whose first step is "log in". Note there is no
 * credential to supply -- see SECURITY_AUDIT.md, C1.
 */
export async function signInThroughUi(page: Page, role: Role) {
  await page.goto("/login");
  const label = role === "admin" ? /Continue as Admin/ : /Continue as Employee/;
  await page.getByRole("button", { name: label }).click();
  await expect(page).toHaveURL(new RegExp(`/${role}`));
}

/**
 * Gives this browser a stable pseudonym before the app reads it.
 *
 * Booking and feedback both key off `zerowaste-employee-id`, so seeding it is
 * what lets a journey assert against the server's copy of a specific
 * employee's plan -- and what lets the isolation journey run two employees
 * against each other.
 */
export async function seedEmployeeIdentity(page: Page, employeeId: string) {
  await page.addInitScript((id) => {
    window.localStorage.setItem("zerowaste-employee-id", id);
  }, employeeId);
}

/** Clears any plan this browser is carrying, so a journey starts from nothing. */
export async function clearLocalPlan(page: Page) {
  await page.addInitScript(() => {
    window.localStorage.removeItem("zerowaste-weekly-bookings");
    window.localStorage.removeItem("zerowaste-weekly-bookings-unsynced");
    window.localStorage.removeItem("zerowaste-meal-feedback");
  });
}

/** A unique pseudonym per journey, so runs never collide in the shared store. */
export const uniqueEmployeeId = (label: string) => `emp-e2e-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

/** Today's date in the local-timezone form every store uses. */
export function todayKey(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/** The next weekday on or after today, since the backend refuses weekends. */
export function nextWeekdayKey() {
  for (let offset = 0; offset < 7; offset += 1) {
    const date = new Date();
    date.setDate(date.getDate() + offset);
    const weekday = date.getDay();
    if (weekday !== 0 && weekday !== 6) return todayKey(offset);
  }
  throw new Error("unreachable: a weekday always occurs within seven days");
}

export { APP_BASE };
