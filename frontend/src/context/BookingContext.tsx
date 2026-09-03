/**
 * The employee's weekly meal plan.
 *
 * Bookings used to live only in this browser's localStorage, which meant the
 * cafeteria could not see them: the admin dashboard's "pre-orders" figure was
 * really the logged-in admin's own meal plan, capped at fifteen. The plan is
 * now mirrored to the server so aggregate demand is real, while localStorage
 * stays as the offline copy this device works from.
 *
 * Identity never leaves as a name. The pseudonym below is a random per-browser
 * id, which the server hashes again before storage.
 */

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { MenuItem } from "../components/MenuCard";
import { saveBookings as postBookings } from "../services/operationsService";

export type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";
export type MealCategory = "Breakfast" | "Lunch" | "Snacks";
export type Appetite = "Light" | "Regular" | "Heavy";
export type Booking = { id: string; day: Weekday; category: MealCategory; item: MenuItem; appetite: Appetite; bookedAt: string };

export type SyncState = "idle" | "syncing" | "synced" | "offline";

type BookingContextValue = {
  bookings: Booking[];
  appetitePreference: Appetite;
  setAppetitePreference: (appetite: Appetite) => void;
  selectMeal: (day: Weekday, category: MealCategory, item: MenuItem, appetite?: Appetite) => void;
  removeMeal: (day: Weekday, category: MealCategory) => void;
  saveWeeklyPlan: () => void;
  planSaved: boolean;
  syncState: SyncState;
  /** Lines the server refused. Surfaced rather than silently dropped. */
  syncRejections: { dish: string | null; servedOn: string | null; reason: string }[];
};

const BookingContext = createContext<BookingContextValue | null>(null);
const STORAGE_KEY = "zerowaste-weekly-bookings";
const APPETITE_KEY = "zerowaste-appetite-preference";
const EMPLOYEE_KEY = "zerowaste-employee-id";
const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

/** Shares the pseudonym with FeedbackContext so one person is one person to the server. */
function getEmployeeId() {
  const existing = localStorage.getItem(EMPLOYEE_KEY);
  if (existing) return existing;
  const generated = `emp-${crypto.randomUUID()}`;
  localStorage.setItem(EMPLOYEE_KEY, generated);
  return generated;
}

/** Local-timezone date key. Avoids the UTC shift that toISOString() would apply. */
function toLocalDateKey(date: Date) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

/**
 * The service date a weekday refers to, looking *forward* — today if it matches,
 * otherwise the next occurrence.
 *
 * This is the mirror image of FeedbackContext's serviceDateFor, which looks
 * backwards, and the difference is deliberate: a booking is a meal not yet
 * eaten, so resolving Monday to the Monday just gone would file the order
 * against a service that has already happened.
 */
function bookingDateFor(weekday: Weekday) {
  const today = new Date();
  const targetIndex = WEEKDAYS.indexOf(weekday);
  const todayIndex = (today.getDay() + 6) % 7;
  const daysAhead = targetIndex >= todayIndex ? targetIndex - todayIndex : targetIndex + 7 - todayIndex;
  const serviceDate = new Date(today);
  serviceDate.setDate(today.getDate() + daysAhead);
  return toLocalDateKey(serviceDate);
}

/** Every service date this week's planner covers, booked or not. */
const plannedWeekDates = () => WEEKDAYS.map(bookingDateFor);

export function BookingProvider({ children }: { children: ReactNode }) {
  const [bookings, setBookings] = useState<Booking[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? (JSON.parse(stored) as Booking[]) : [];
    } catch {
      return [];
    }
  });
  const [appetitePreference, setAppetitePreferenceState] = useState<Appetite>(() => {
    const stored = localStorage.getItem(APPETITE_KEY);
    return stored === "Light" || stored === "Heavy" ? stored : "Regular";
  });
  const [planSaved, setPlanSaved] = useState(false);
  const [syncState, setSyncState] = useState<SyncState>("idle");
  const [syncRejections, setSyncRejections] = useState<BookingContextValue["syncRejections"]>([]);

  const employeeId = useMemo(getEmployeeId, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
  }, [bookings]);

  const setAppetitePreference = (appetite: Appetite) => {
    localStorage.setItem(APPETITE_KEY, appetite);
    setAppetitePreferenceState(appetite);
  };

  const selectMeal = (day: Weekday, category: MealCategory, item: MenuItem, appetite = appetitePreference) => {
    setBookings((current) => [
      ...current.filter((booking) => booking.day !== day || booking.category !== category),
      { id: `${day}-${category}`, day, category, item, appetite, bookedAt: new Date().toISOString() },
    ]);
    setAppetitePreference(appetite);
    setPlanSaved(false);
  };

  const removeMeal = (day: Weekday, category: MealCategory) => {
    setBookings((current) => current.filter((booking) => booking.day !== day || booking.category !== category));
    setPlanSaved(false);
  };

  /**
   * Pushes the plan to the server. The local copy is saved first and kept even
   * if the request fails, so a cafeteria network problem never costs an
   * employee the plan they just built.
   */
  const syncPlan = useCallback(
    async (plan: Booking[]) => {
      setSyncState("syncing");
      try {
        const { data } = await postBookings(
          employeeId,
          plan.map((booking) => ({
            id: booking.id,
            dish: booking.item.name,
            category: booking.category,
            servedOn: bookingDateFor(booking.day),
            appetite: booking.appetite,
          })),
          plannedWeekDates()
        );
        setSyncRejections(data.rejected ?? []);
        setSyncState("synced");
      } catch {
        setSyncRejections([]);
        setSyncState("offline");
      }
    },
    [employeeId]
  );

  const saveWeeklyPlan = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    setPlanSaved(true);
    void syncPlan(bookings);
    window.setTimeout(() => setPlanSaved(false), 2800);
  };

  return (
    <BookingContext.Provider
      value={{
        bookings,
        appetitePreference,
        setAppetitePreference,
        selectMeal,
        removeMeal,
        saveWeeklyPlan,
        planSaved,
        syncState,
        syncRejections,
      }}
    >
      {children}
    </BookingContext.Provider>
  );
}

export function useBookings() {
  const context = useContext(BookingContext);
  if (!context) throw new Error("useBookings must be used within a BookingProvider");
  return context;
}
