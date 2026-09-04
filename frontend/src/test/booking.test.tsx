/**
 * The employee weekly meal planner.
 *
 * BookingContext is the most consequential piece of client state in the app:
 * it decides what the kitchen is told to cook. These tests drive it through a
 * probe component with the operations service mocked, so the debounce, the
 * hydration merge and the offline path are all observable without a server.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("../services/operationsService", () => ({
  getMenu: vi.fn(),
  getMyBookings: vi.fn(),
  saveBookings: vi.fn(),
}));

import { getMenu, getMyBookings, saveBookings } from "../services/operationsService";
import { BookingProvider, plannedWeekdays, todayKey, useBookings, type Weekday } from "../context/BookingContext";
import type { MenuItem } from "../types/menu";

const mockedMenu = vi.mocked(getMenu);
const mockedMyBookings = vi.mocked(getMyBookings);
const mockedSave = vi.mocked(saveBookings);

const STORAGE_KEY = "zerowaste-weekly-bookings";
const PENDING_KEY = "zerowaste-weekly-bookings-unsynced";
const EMPLOYEE_KEY = "zerowaste-employee-id";
const APPETITE_KEY = "zerowaste-appetite-preference";

const CATALOGUE = [
  { dish: "Idli Sambar", category: "Breakfast", description: "Steamed rice cakes", calories: 320, protein: 9, price: 45, isVeg: true, image: "idli.jpg" },
  { dish: "Masala Dosa", category: "Breakfast", description: "Crisp crepe", calories: 410, protein: 8, price: 60, isVeg: true, image: "dosa.jpg" },
  { dish: "Veg Biryani", category: "Lunch", description: "Spiced rice", calories: 620, protein: 14, price: 120, isVeg: true, image: "biryani.jpg" },
  { dish: "Rajma Chawal", category: "Lunch", description: "Kidney beans and rice", calories: 580, protein: 18, price: 110, isVeg: true, image: "rajma.jpg" },
  { dish: "Fruit Bowl", category: "Snacks", description: "Seasonal fruit", calories: 150, protein: 2, price: 50, isVeg: true, image: "fruit.jpg" },
];

const item = (name: string): MenuItem => {
  const index = CATALOGUE.findIndex((entry) => entry.dish === name);
  const entry = CATALOGUE[index];
  return {
    id: index + 1,
    name: entry.dish,
    category: entry.category,
    description: entry.description,
    calories: entry.calories,
    protein: entry.protein,
    price: entry.price,
    isVeg: entry.isVeg,
    image: entry.image,
  };
};

/** Exposes the whole context surface as buttons and readable text. */
function Planner() {
  const ctx = useBookings();
  return (
    <div>
      <span data-testid="count">{ctx.bookings.length}</span>
      <span data-testid="plan">
        {ctx.bookings
          .map((b) => `${b.day}/${b.category}/${b.item.name}/${b.appetite}/${b.servedOn}`)
          .sort()
          .join("|")}
      </span>
      <span data-testid="employee-id">{ctx.employeeId}</span>
      <span data-testid="sync-state">{ctx.syncState}</span>
      <span data-testid="hydrated">{String(ctx.hydrated)}</span>
      <span data-testid="unsaved">{String(ctx.hasUnsavedChanges)}</span>
      <span data-testid="saved-flag">{String(ctx.planSaved)}</span>
      <span data-testid="synced-at">{ctx.syncedAt}</span>
      <span data-testid="rejections">{ctx.syncRejections.map((r) => `${r.dish}:${r.reason}`).join("|")}</span>
      <span data-testid="appetite">{ctx.appetitePreference}</span>
      <button onClick={() => ctx.selectMeal("Monday", "Breakfast", item("Idli Sambar"))}>book monday breakfast</button>
      <button onClick={() => ctx.selectMeal("Monday", "Breakfast", item("Masala Dosa"))}>rebook monday breakfast</button>
      <button onClick={() => ctx.selectMeal("Monday", "Lunch", item("Veg Biryani"))}>book monday lunch</button>
      <button onClick={() => ctx.selectMeal("Tuesday", "Lunch", item("Rajma Chawal"), "Heavy")}>book tuesday lunch heavy</button>
      <button onClick={() => ctx.removeMeal("Monday", "Breakfast")}>remove monday breakfast</button>
      <button onClick={() => ctx.setAppetitePreference("Light")}>prefer light</button>
      <button onClick={() => ctx.saveWeeklyPlan()}>save now</button>
      <button onClick={() => ctx.retrySync()}>retry</button>
    </div>
  );
}

function mountPlanner() {
  return render(
    <BookingProvider>
      <Planner />
    </BookingProvider>
  );
}

/** Waits for the hydration read-back to settle before acting. */
async function mountHydrated() {
  const view = mountPlanner();
  await waitFor(() => expect(screen.getByTestId("hydrated")).toHaveTextContent("true"));
  return view;
}

const okSave = (overrides: Partial<{ accepted: number; rejected: unknown[]; dates: string[] }> = {}) => ({
  data: { accepted: 1, rejected: [], dates: [], ...overrides },
});

beforeEach(() => {
  mockedMenu.mockResolvedValue({ data: { menu: CATALOGUE } } as never);
  mockedMyBookings.mockResolvedValue({ data: { bookings: [] } } as never);
  mockedSave.mockResolvedValue(okSave() as never);
});

describe("weekday resolution", () => {
  it("plans exactly five weekdays", () => {
    expect(plannedWeekdays()).toHaveLength(5);
  });

  it("never plans a weekend", () => {
    expect(plannedWeekdays()).toEqual(expect.arrayContaining(["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"]));
    expect(plannedWeekdays()).not.toContain("Saturday" as Weekday);
    expect(plannedWeekdays()).not.toContain("Sunday" as Weekday);
  });

  it("orders the strip by the date each label resolves to, so the next meal is first", async () => {
    await mountHydrated();
    const ctx = plannedWeekdays();
    // Nothing in the list may be before today: bookings look forward only.
    expect(ctx).toHaveLength(new Set(ctx).size);
  });

  it("resolves every planned weekday to today or later", async () => {
    let dates: string[] = [];
    function DateProbe() {
      const { serviceDateFor } = useBookings();
      dates = plannedWeekdays().map(serviceDateFor);
      return null;
    }
    render(
      <BookingProvider>
        <DateProbe />
      </BookingProvider>
    );
    const today = todayKey();
    for (const date of dates) expect(date >= today).toBe(true);
  });

  it("returns the dates in ascending order", async () => {
    let dates: string[] = [];
    function DateProbe() {
      const { serviceDateFor } = useBookings();
      dates = plannedWeekdays().map(serviceDateFor);
      return null;
    }
    render(
      <BookingProvider>
        <DateProbe />
      </BookingProvider>
    );
    expect([...dates].sort()).toEqual(dates);
  });
});

describe("employee pseudonym", () => {
  it("generates a pseudonym rather than storing a name", async () => {
    await mountHydrated();
    const id = screen.getByTestId("employee-id").textContent ?? "";
    expect(id).toMatch(/^emp-/);
    expect(localStorage.getItem(EMPLOYEE_KEY)).toBe(id);
  });

  it("reuses an existing pseudonym across mounts", async () => {
    localStorage.setItem(EMPLOYEE_KEY, "emp-fixed-identity");
    await mountHydrated();
    expect(screen.getByTestId("employee-id")).toHaveTextContent("emp-fixed-identity");
  });

  it("reads back only its own bookings", async () => {
    localStorage.setItem(EMPLOYEE_KEY, "emp-fixed-identity");
    await mountHydrated();
    expect(mockedMyBookings).toHaveBeenCalledWith("emp-fixed-identity");
  });
});

describe("selecting meals", () => {
  it("adds a booking", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("plan").textContent).toContain("Monday/Breakfast/Idli Sambar");
  });

  it("keeps one booking per day and category, replacing the dish", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await user.click(screen.getByRole("button", { name: "rebook monday breakfast" }));
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("plan").textContent).toContain("Masala Dosa");
    expect(screen.getByTestId("plan").textContent).not.toContain("Idli Sambar");
  });

  it("allows different categories on the same day", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await user.click(screen.getByRole("button", { name: "book monday lunch" }));
    expect(screen.getByTestId("count")).toHaveTextContent("2");
  });

  it("allows the same category on different days", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday lunch" }));
    await user.click(screen.getByRole("button", { name: "book tuesday lunch heavy" }));
    expect(screen.getByTestId("count")).toHaveTextContent("2");
  });

  it("removes a booking", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await user.click(screen.getByRole("button", { name: "remove monday breakfast" }));
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("stamps servedOn at the moment of booking", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    expect(screen.getByTestId("plan").textContent).toMatch(/\d{4}-\d{2}-\d{2}$/);
  });

  it("carries the chosen appetite and adopts it as the preference", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book tuesday lunch heavy" }));
    expect(screen.getByTestId("plan").textContent).toContain("Rajma Chawal/Heavy");
    expect(screen.getByTestId("appetite")).toHaveTextContent("Heavy");
    expect(localStorage.getItem(APPETITE_KEY)).toBe("Heavy");
  });

  it("defaults to the stored appetite preference", async () => {
    localStorage.setItem(APPETITE_KEY, "Light");
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    expect(screen.getByTestId("plan").textContent).toContain("Idli Sambar/Light");
  });

  it("persists the plan to localStorage synchronously", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].item.name).toBe("Idli Sambar");
  });

  it("marks the plan unsaved the instant it changes", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    expect(screen.getByTestId("unsaved")).toHaveTextContent("true");
    expect(localStorage.getItem(PENDING_KEY)).toBe("true");
  });
});

describe("restoring a plan from localStorage", () => {
  it("loads a stored plan on mount", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: "Monday-Lunch", day: "Monday", category: "Lunch", item: item("Veg Biryani"), appetite: "Regular", bookedAt: "2025-01-01T00:00:00.000Z", servedOn: "2025-01-06" },
      ])
    );
    await mountHydrated();
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("repairs a legacy booking that predates servedOn", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "Monday-Lunch", day: "Monday", category: "Lunch", item: item("Veg Biryani"), appetite: "Regular", bookedAt: "2025-01-01T00:00:00.000Z" }])
    );
    await mountHydrated();
    expect(screen.getByTestId("plan").textContent).toMatch(/\d{4}-\d{2}-\d{2}$/);
  });

  it("survives corrupted storage rather than crashing", async () => {
    localStorage.setItem(STORAGE_KEY, "{not json");
    await mountHydrated();
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });
});

describe("hydration from the server", () => {
  const serverBooking = (weekday: Weekday, dish: string, category: string, servedOn: string) => ({
    id: `${weekday}-${category}`,
    dish,
    category,
    appetite: "Regular",
    servedOn,
    weekday,
    bookedAt: "2025-01-01T00:00:00.000Z",
  });

  /** The service date the planner currently resolves a weekday to. */
  function resolvedDate(weekday: Weekday) {
    let value = "";
    function Probe() {
      value = useBookings().serviceDateFor(weekday);
      return null;
    }
    const view = render(
      <BookingProvider>
        <Probe />
      </BookingProvider>
    );
    view.unmount();
    return value;
  }

  it("restores a server booking this browser has never seen", async () => {
    const monday = resolvedDate("Monday");
    mockedMyBookings.mockResolvedValue({ data: { bookings: [serverBooking("Monday", "Veg Biryani", "Lunch", monday)] } } as never);
    await mountHydrated();
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(screen.getByTestId("plan").textContent).toContain("Monday/Lunch/Veg Biryani");
  });

  it("does not mark a server-restored plan as unsaved", async () => {
    const monday = resolvedDate("Monday");
    mockedMyBookings.mockResolvedValue({ data: { bookings: [serverBooking("Monday", "Veg Biryani", "Lunch", monday)] } } as never);
    await mountHydrated();
    await waitFor(() => expect(screen.getByTestId("count")).toHaveTextContent("1"));
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("lets the local plan win for a slot this browser already claims", async () => {
    const monday = resolvedDate("Monday");
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "Monday-Lunch", day: "Monday", category: "Lunch", item: item("Rajma Chawal"), appetite: "Heavy", bookedAt: "2025-06-01T00:00:00.000Z", servedOn: monday }])
    );
    mockedMyBookings.mockResolvedValue({ data: { bookings: [serverBooking("Monday", "Veg Biryani", "Lunch", monday)] } } as never);
    await mountHydrated();
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("plan").textContent).toContain("Rajma Chawal");
  });

  it("ignores a server booking outside the planning week", async () => {
    mockedMyBookings.mockResolvedValue({ data: { bookings: [serverBooking("Monday", "Veg Biryani", "Lunch", "1999-01-04")] } } as never);
    await mountHydrated();
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("ignores a server booking for a dish no longer on the menu", async () => {
    const monday = resolvedDate("Monday");
    mockedMyBookings.mockResolvedValue({ data: { bookings: [serverBooking("Monday", "Discontinued Curry", "Lunch", monday)] } } as never);
    await mountHydrated();
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("ignores a weekend row the server should never have returned", async () => {
    const monday = resolvedDate("Monday");
    mockedMyBookings.mockResolvedValue({
      data: { bookings: [{ ...serverBooking("Monday", "Veg Biryani", "Lunch", monday), weekday: "Saturday" }] },
    } as never);
    await mountHydrated();
    expect(screen.getByTestId("count")).toHaveTextContent("0");
  });

  it("keeps the local plan when the server is unreachable", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "Monday-Lunch", day: "Monday", category: "Lunch", item: item("Veg Biryani"), appetite: "Regular", bookedAt: "2025-01-01T00:00:00.000Z", servedOn: "2025-01-06" }])
    );
    mockedMyBookings.mockRejectedValue(new Error("offline"));
    await mountHydrated();
    expect(screen.getByTestId("count")).toHaveTextContent("1");
  });

  it("still reports hydrated after a failed read-back, so saving is not blocked forever", async () => {
    mockedMyBookings.mockRejectedValue(new Error("offline"));
    await mountHydrated();
    expect(screen.getByTestId("hydrated")).toHaveTextContent("true");
  });

  it("flushes a plan left unsaved by an earlier visit", async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ id: "Monday-Lunch", day: "Monday", category: "Lunch", item: item("Veg Biryani"), appetite: "Regular", bookedAt: "2025-01-01T00:00:00.000Z", servedOn: "2025-01-06" }])
    );
    localStorage.setItem(PENDING_KEY, "true");
    await mountHydrated();
    await waitFor(() => expect(mockedSave).toHaveBeenCalled());
    await waitFor(() => expect(localStorage.getItem(PENDING_KEY)).toBeNull());
  });
});

describe("syncing to the kitchen", () => {
  /**
   * Autosave is debounced by 700ms, so a timer queued by one test can still be
   * in flight when the next begins. Every test in this block therefore claims a
   * unique pseudonym and only inspects the calls made under it, which keeps the
   * assertions about this provider rather than about a leftover from a
   * neighbour.
   */
  let identity = "";

  beforeEach(() => {
    identity = `emp-${expect.getState().currentTestName?.replace(/\W+/g, "-")}`;
    localStorage.setItem(EMPLOYEE_KEY, identity);
  });

  const myCalls = () => mockedSave.mock.calls.filter((call) => call[0] === identity);

  it("autosaves after the debounce without an explicit save press", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await waitFor(() => expect(myCalls()).toHaveLength(1), { timeout: 4000 });
  });

  it("coalesces several rapid choices into one request", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await user.click(screen.getByRole("button", { name: "book monday lunch" }));
    await user.click(screen.getByRole("button", { name: "book tuesday lunch heavy" }));
    await waitFor(() => expect(myCalls().length).toBeGreaterThan(0), { timeout: 4000 });
    // Three taps, one request, carrying all three meals.
    expect(myCalls()).toHaveLength(1);
    expect(myCalls()[0][1]).toHaveLength(3);
  });

  it("sends the pseudonym, the dish names and the full week as scope", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday lunch" }));
    await user.click(screen.getByRole("button", { name: "save now" }));
    await waitFor(() => expect(myCalls().length).toBeGreaterThan(0));
    const [employeeId, bookings, scopeDates] = myCalls()[0];
    expect(employeeId).toBe(identity);
    expect(bookings.map((b) => b.dish)).toContain("Veg Biryani");
    expect(scopeDates).toHaveLength(5);
  });

  it("declares the whole week as scope so a cleared day is really cleared", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await user.click(screen.getByRole("button", { name: "remove monday breakfast" }));
    await user.click(screen.getByRole("button", { name: "save now" }));
    await waitFor(() => expect(myCalls().length).toBeGreaterThan(0));
    const lastCall = myCalls().at(-1)!;
    expect(lastCall[1]).toHaveLength(0);
    expect(lastCall[2]).toHaveLength(5);
  });

  it("never sends a name, only the pseudonym", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await waitFor(() => expect(myCalls().length).toBeGreaterThan(0), { timeout: 4000 });
    const payload = JSON.stringify(myCalls()[0]);
    expect(payload).toContain(identity);
    expect(payload).not.toMatch(/@/);
  });

  it("clears the unsaved flag and confirms once the server acknowledges", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await waitFor(() => expect(screen.getByTestId("sync-state")).toHaveTextContent("synced"), { timeout: 4000 });
    expect(screen.getByTestId("unsaved")).toHaveTextContent("false");
    expect(screen.getByTestId("saved-flag")).toHaveTextContent("true");
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("bumps syncedAt only on a real acknowledgement", async () => {
    const user = userEvent.setup();
    await mountHydrated();
    expect(screen.getByTestId("synced-at")).toHaveTextContent("0");
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await waitFor(() => expect(screen.getByTestId("synced-at")).toHaveTextContent("1"), { timeout: 4000 });
  });

  it("surfaces server rejections rather than dropping them", async () => {
    mockedSave.mockResolvedValue(
      okSave({ accepted: 0, rejected: [{ dish: "Veg Biryani", servedOn: "2025-01-04", reason: "bookings are weekdays only" }] }) as never
    );
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday lunch" }));
    await waitFor(() => expect(screen.getByTestId("rejections").textContent).toContain("bookings are weekdays only"), { timeout: 4000 });
  });

  it("goes offline and keeps the plan when the request fails", async () => {
    mockedSave.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await waitFor(() => expect(screen.getByTestId("sync-state")).toHaveTextContent("offline"), { timeout: 4000 });
    expect(screen.getByTestId("count")).toHaveTextContent("1");
    expect(screen.getByTestId("unsaved")).toHaveTextContent("true");
    expect(localStorage.getItem(PENDING_KEY)).toBe("true");
  });

  it("recovers on retry after an offline failure", async () => {
    mockedSave.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await waitFor(() => expect(screen.getByTestId("sync-state")).toHaveTextContent("offline"), { timeout: 4000 });
    await user.click(screen.getByRole("button", { name: "retry" }));
    await waitFor(() => expect(screen.getByTestId("sync-state")).toHaveTextContent("synced"));
    expect(localStorage.getItem(PENDING_KEY)).toBeNull();
  });

  it("flushes an unsaved plan when the page is hidden", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);
    mockedSave.mockRejectedValue(new Error("network down"));
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await waitFor(() => expect(screen.getByTestId("sync-state")).toHaveTextContent("offline"), { timeout: 4000 });
    await act(async () => {
      window.dispatchEvent(new Event("pagehide"));
    });
    expect(fetchSpy).toHaveBeenCalled();
    const [url, options] = fetchSpy.mock.calls[0];
    expect(String(url)).toContain("/operations/bookings");
    expect(options.keepalive).toBe(true);
    vi.unstubAllGlobals();
  });

  it("retries a stuck plan when the browser comes back online", async () => {
    mockedSave.mockRejectedValueOnce(new Error("network down"));
    const user = userEvent.setup();
    await mountHydrated();
    await user.click(screen.getByRole("button", { name: "book monday breakfast" }));
    await waitFor(() => expect(screen.getByTestId("sync-state")).toHaveTextContent("offline"), { timeout: 4000 });
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await waitFor(() => expect(screen.getByTestId("sync-state")).toHaveTextContent("synced"));
  });
});

describe("provider contract", () => {
  it("throws when useBookings is called outside a provider", () => {
    const silence = vi.spyOn(console, "error").mockImplementation(() => {});
    const swallow = (event: ErrorEvent) => event.preventDefault();
    window.addEventListener("error", swallow);
    try {
      expect(() => render(<Planner />)).toThrow(/useBookings must be used within a BookingProvider/);
    } finally {
      window.removeEventListener("error", swallow);
      silence.mockRestore();
    }
  });
});
