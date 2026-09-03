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

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { toMenuItem, type MenuItem } from "../types/menu";
import { getMenu, getMyBookings, saveBookings as postBookings } from "../services/operationsService";
import { API_BASE } from "../services/feedbackService";

export type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";
export type MealCategory = "Breakfast" | "Lunch" | "Snacks";
export type Appetite = "Light" | "Regular" | "Heavy";
/**
 * `servedOn` is stored rather than derived because booking and feedback resolve
 * a weekday in opposite directions -- bookings look forward, feedback looks
 * back. Recomputing it on the feedback side stamped a rating for tomorrow's
 * Friday lunch with *last* Friday's date: the rating never joined its booking,
 * and it polluted the previous week's signal bucket. Carrying the date the
 * booking was actually made for removes the guesswork from both sides.
 */
export type Booking = {
  id: string;
  day: Weekday;
  category: MealCategory;
  item: MenuItem;
  appetite: Appetite;
  bookedAt: string;
  servedOn: string;
};

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
  /** This browser's pseudonym, for self-service reads such as personal impact. */
  employeeId: string;
  /** True once a change is waiting to reach the server, for the saving indicator. */
  hasUnsavedChanges: boolean;
  /** Re-sends the current plan after an offline failure. */
  retrySync: () => void;
  /** The weekday a booking for `day` will actually be served on. */
  serviceDateFor: (day: Weekday) => string;
  /** False until the plan already held by the kitchen has been read back. */
  hydrated: boolean;
  /** Increments each time the server acknowledges a save. */
  syncedAt: number;
};

const BookingContext = createContext<BookingContextValue | null>(null);
const STORAGE_KEY = "zerowaste-weekly-bookings";
/**
 * Set whenever the plan changes, cleared only by a successful save.
 *
 * Without it an unsynced plan was indistinguishable from a saved one after a
 * reload: the failure lived only in React state, so an employee could tap a
 * dish, lose the network for a moment, close the tab, and see "Booked" on every
 * screen forever while the kitchen had no record of the meal at all.
 */
const PENDING_KEY = "zerowaste-weekly-bookings-unsynced";
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

/** Today's service date. Single definition so every screen agrees on "today". */
export const todayKey = () => toLocalDateKey(new Date());

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

/**
 * The five service days ahead, in the order they will actually happen.
 *
 * Because `bookingDateFor` looks forward, on a Thursday "Monday" means the
 * Monday four days away while "Thursday" means today. Listing the days in
 * calendar-name order therefore produced a strip reading Mon 7, Tue 8, Wed 9,
 * Thu 3, Fri 4 -- five dates out of sequence, with today buried in the middle.
 * Sorting by the date each label resolves to puts the next meal first and makes
 * the strip read forwards, which is the only order that matches what the
 * employee can actually still book.
 */
export function plannedWeekdays(): Weekday[] {
  return [...WEEKDAYS].sort((a, b) => bookingDateFor(a).localeCompare(bookingDateFor(b)));
}

export function BookingProvider({ children }: { children: ReactNode }) {
  const [bookings, setBookings] = useState<Booking[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? (JSON.parse(stored) as Booking[]) : [];
      // Plans saved before `servedOn` existed are repaired on read rather than
      // discarded, so an upgrade never costs anyone their week.
      return parsed.map((booking) => ({ ...booking, servedOn: booking.servedOn || bookingDateFor(booking.day) }));
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
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  /** Increments on every acknowledged save, so server-derived panels can refetch. */
  const [syncedAt, setSyncedAt] = useState(0);

  const employeeId = useMemo(getEmployeeId, []);
  /**
   * The plan the autosave timer will send.
   *
   * Written synchronously by `commitPlan` at the moment the plan changes, never
   * mirrored from state in an effect. That ordering matters: `hydratedRef` is
   * set in a promise callback (a microtask) while a passive effect runs a
   * macrotask later, so a ref updated by an effect would spend at least one full
   * task behind the hydration flag. The autosave re-polls every 200ms while it
   * waits, so it would eventually land inside that window and post the
   * pre-hydration plan -- with the whole week as its scope, deleting exactly the
   * bookings hydration had just recovered.
   */
  const latestPlan = useRef<Booking[]>(bookings);
  const hydratedRef = useRef(false);
  const savePending = useRef(false);
  const saveTimer = useRef<number | null>(null);
  const successTimer = useRef<number | null>(null);

  /**
   * The single writer for the plan. Keeps `latestPlan`, localStorage and React
   * state in step in one synchronous step, so no reader can observe them
   * disagreeing.
   */
  const commitPlan = useCallback((next: Booking[], { unsynced = true } = {}) => {
    latestPlan.current = next;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    if (unsynced) localStorage.setItem(PENDING_KEY, "true");
    setBookings(next);
  }, []);

  /**
   * Reads back the plan the kitchen already holds for this week.
   *
   * Without this the plan existed only in one browser's localStorage, so on a
   * second device -- or after clearing site data -- the app believed the
   * employee had booked nothing. That was not merely a display problem: saving
   * declares the whole week as its scope, so the first tap on a fresh browser
   * replaced a full week of real bookings with a single meal, and the employee
   * was never told. Meals vanished from the kitchen's counts silently.
   *
   * Anything already in this browser wins, because it is either newer or was
   * made offline and has not reached the server yet; the server only fills the
   * slots the browser has no opinion about. A failure here is not fatal -- the
   * local copy stands and the save path stays blocked until we know what the
   * server holds.
   */
  useEffect(() => {
    let cancelled = false;
    const weekDates = new Set(plannedWeekDates());

    Promise.all([getMyBookings(employeeId), getMenu()])
      .then(([saved, catalogue]) => {
        if (cancelled) return;
        const byName = new Map(catalogue.data.menu.map((entry, index) => [entry.dish, toMenuItem(entry, index)]));
        const restored: Booking[] = [];

        for (const row of saved.data.bookings) {
          // Only this planning week, and only dishes still on the menu -- a
          // booking we cannot render is worse than one we quietly drop, and the
          // server keeps its own copy either way.
          if (!weekDates.has(row.servedOn)) continue;
          if (!WEEKDAYS.includes(row.weekday as Weekday)) continue;
          const item = byName.get(row.dish);
          if (!item) continue;
          const day = row.weekday as Weekday;
          restored.push({
            id: `${day}-${row.category}`,
            day,
            category: row.category,
            item,
            appetite: row.appetite || "Regular",
            bookedAt: row.bookedAt,
            servedOn: row.servedOn,
          });
        }

        // Merged synchronously, and the ref written before `hydratedRef` is
        // raised, so the autosave can never see "hydrated" alongside a stale
        // plan. Hydration does not itself make the plan unsynced -- these rows
        // came from the server.
        const claimed = new Set(latestPlan.current.map((booking) => `${booking.day}-${booking.category}`));
        const additions = restored.filter((booking) => !claimed.has(`${booking.day}-${booking.category}`));
        if (additions.length > 0) {
          commitPlan([...latestPlan.current, ...additions], { unsynced: false });
        }
      })
      .catch(() => {
        // Offline. The local plan is still the employee's plan.
      })
      .finally(() => {
        if (cancelled) return;
        hydratedRef.current = true;
        setHydrated(true);
        // A plan left unsaved by an earlier visit is flushed as soon as we know
        // what the server already holds, so a meal cannot stay "Booked" on this
        // device but unknown to the kitchen.
        if (localStorage.getItem(PENDING_KEY) === "true") {
          savePending.current = true;
          setHasUnsavedChanges(true);
          void syncPlanRef.current?.(latestPlan.current);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [employeeId, commitPlan]);

  const setAppetitePreference = (appetite: Appetite) => {
    localStorage.setItem(APPETITE_KEY, appetite);
    setAppetitePreferenceState(appetite);
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
            servedOn: booking.servedOn,
            appetite: booking.appetite,
          })),
          plannedWeekDates()
        );
        setSyncRejections(data.rejected ?? []);
        setSyncState("synced");
        setHasUnsavedChanges(false);
        savePending.current = false;
        localStorage.removeItem(PENDING_KEY);
        // Bumped only on a real server acknowledgement. Panels that read
        // server-derived figures key off this rather than off the local plan
        // length, which changes 700ms before the server has heard anything.
        setSyncedAt((count) => count + 1);
        setPlanSaved(true);
        if (successTimer.current) window.clearTimeout(successTimer.current);
        successTimer.current = window.setTimeout(() => setPlanSaved(false), 2800);
      } catch {
        setSyncRejections([]);
        setSyncState("offline");
        // The change stays flagged as unsaved, in storage as well as in state,
        // so a reload still knows the kitchen has not been told.
        savePending.current = true;
        localStorage.setItem(PENDING_KEY, "true");
        setHasUnsavedChanges(true);
      }
    },
    [employeeId]
  );

  /** Lets the hydration effect call the newest sync without depending on it. */
  const syncPlanRef = useRef(syncPlan);
  syncPlanRef.current = syncPlan;

  /**
   * Flushes an unsaved plan when the page is being torn down.
   *
   * A React effect cleanup does not run on tab close, reload or navigation away
   * -- the browser simply discards the page -- and this provider sits above the
   * router, so it never unmounts during normal use either. `pagehide` is the
   * event that does fire, and `keepalive` is what allows the request to outlive
   * the document; an ordinary XHR is cancelled during unload.
   */
  useEffect(() => {
    const flush = () => {
      if (!savePending.current || !hydratedRef.current) return;
      const payload = JSON.stringify({
        employeeId,
        bookings: latestPlan.current.map((booking) => ({
          id: booking.id,
          dish: booking.item.name,
          category: booking.category,
          servedOn: booking.servedOn,
          appetite: booking.appetite,
        })),
        scopeDates: plannedWeekDates(),
      });
      try {
        void fetch(`${API_BASE}/operations/bookings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: payload,
          keepalive: true,
        });
      } catch {
        // Nothing useful can be done while the page is going away.
      }
    };

    const onHidden = () => {
      if (document.visibilityState === "hidden") flush();
    };
    const onOnline = () => {
      // Coming back online is the other moment a stuck plan can get through.
      if (savePending.current && hydratedRef.current) void syncPlanRef.current(latestPlan.current);
    };

    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("online", onOnline);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("online", onOnline);
    };
  }, [employeeId]);

  /**
   * Queues an autosave.
   *
   * Booking used to require a separate "Save weekly plan" press, which meant a
   * plan could look chosen on screen while the kitchen had never been told
   * about it -- the most costly possible failure in an app whose whole purpose
   * is telling the kitchen. Saving now follows the choice automatically, with a
   * short debounce so picking several dishes in a row is one request.
   *
   * The timer sends whatever the plan is when it fires rather than the plan as
   * it was when the tap happened, and it waits for hydration: a save that
   * overtook the read-back would declare the week complete while still missing
   * the meals the kitchen already knew about.
   */
  const queueSave = useCallback(() => {
    savePending.current = true;
    setHasUnsavedChanges(true);
    if (saveTimer.current) window.clearTimeout(saveTimer.current);

    const attempt = () => {
      if (!hydratedRef.current) {
        saveTimer.current = window.setTimeout(attempt, 200);
        return;
      }
      // `savePending` stays true until syncPlan succeeds; clearing it here
      // would mark the plan as handled before we knew whether it landed.
      void syncPlan(latestPlan.current);
    };

    saveTimer.current = window.setTimeout(attempt, 700);
  }, [syncPlan]);

  useEffect(
    () => () => {
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      if (successTimer.current) window.clearTimeout(successTimer.current);
    },
    []
  );

  const selectMeal = (day: Weekday, category: MealCategory, item: MenuItem, appetite = appetitePreference) => {
    commitPlan([
      ...latestPlan.current.filter((booking) => booking.day !== day || booking.category !== category),
      { id: `${day}-${category}`, day, category, item, appetite, bookedAt: new Date().toISOString(), servedOn: bookingDateFor(day) },
    ]);
    queueSave();
    setAppetitePreference(appetite);
  };

  const removeMeal = (day: Weekday, category: MealCategory) => {
    commitPlan(latestPlan.current.filter((booking) => booking.day !== day || booking.category !== category));
    queueSave();
  };

  /** Explicit save. Kept for the retry affordance and for an immediate flush. */
  const saveWeeklyPlan = useCallback(() => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
    savePending.current = true;
    void syncPlan(latestPlan.current);
  }, [syncPlan]);

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
        employeeId,
        hasUnsavedChanges,
        retrySync: saveWeeklyPlan,
        serviceDateFor: bookingDateFor,
        hydrated,
        syncedAt,
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
