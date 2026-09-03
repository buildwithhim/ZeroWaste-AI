import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { Booking, Weekday } from "./BookingContext";
import { FEEDBACK_RESPONSES, LEFTOVER_RATE, submitFeedback, type FeedbackImpact, type FeedbackResponse } from "../services/feedbackService";

export type { FeedbackResponse };
export { FEEDBACK_RESPONSES, LEFTOVER_RATE };

export type Feedback = {
  bookingId: string;
  dish: string;
  category: string;
  weekday: Weekday;
  portionSize: string;
  response: FeedbackResponse;
  servedOn: string;
  submittedAt: string;
  /** False while the response is held locally because the backend was offline. */
  synced: boolean;
};

type FeedbackContextValue = {
  feedback: Feedback[];
  submit: (booking: Booking, response: FeedbackResponse) => Promise<void>;
  feedbackFor: (bookingId: string) => FeedbackResponse | undefined;
  /** True when a response is stored locally but has not reached the server. */
  isPending: (bookingId: string) => boolean;
  lastImpact: FeedbackImpact | null;
  pendingSyncCount: number;
};

const FeedbackContext = createContext<FeedbackContextValue | null>(null);
const STORAGE_KEY = "zerowaste-meal-feedback";
const EMPLOYEE_KEY = "zerowaste-employee-id";
const WEEKDAYS: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

/**
 * Local pseudonym for this browser. The backend hashes it again before storage,
 * so nothing that reaches the server can be traced back to a named employee.
 */
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
 * The most recent occurrence of a weekday, today included.
 *
 * Bookings are keyed by weekday and persist across weeks, so a meal can be
 * rated after its week has rolled over. Anchoring to the current week would
 * stamp that response with a future date and drop it in the wrong trend
 * bucket; feedback always describes a meal already eaten, so we look backwards.
 */
function serviceDateFor(weekday: Weekday) {
  const today = new Date();
  const targetIndex = WEEKDAYS.indexOf(weekday);
  const todayIndex = (today.getDay() + 6) % 7;
  const daysBack = todayIndex >= targetIndex ? todayIndex - targetIndex : todayIndex + 7 - targetIndex;
  const servedDate = new Date(today);
  servedDate.setDate(today.getDate() - daysBack);
  return toLocalDateKey(servedDate);
}

/** Responses used before the four-option scale; mapped so history is not lost. */
const LEGACY_RESPONSES: Record<string, FeedbackResponse> = {
  "Finished meal": "Finished",
  "Left some food": "Left some",
  "Still hungry": "Wanted more",
};

function readStoredFeedback(): Feedback[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return [];
    return (JSON.parse(stored) as Feedback[])
      .map((item) => ({
        ...item,
        response: (LEGACY_RESPONSES[item.response as string] ?? item.response) as FeedbackResponse,
        category: item.category ?? "Lunch",
        weekday: item.weekday ?? (item.bookingId?.split("-")[0] as Weekday) ?? "Monday",
        portionSize: item.portionSize ?? "Regular",
        servedOn: item.servedOn ?? item.submittedAt?.slice(0, 10) ?? toLocalDateKey(new Date()),
        synced: item.synced ?? false,
      }))
      .filter((item) => FEEDBACK_RESPONSES.includes(item.response));
  } catch {
    return [];
  }
}

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<Feedback[]>(readStoredFeedback);
  const [lastImpact, setLastImpact] = useState<FeedbackImpact | null>(null);
  const employeeId = useMemo(getEmployeeId, []);
  /** Booking ids currently being posted, so the retry sweep never duplicates work. */
  const inFlight = useRef(new Set<string>());

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(feedback));
  }, [feedback]);

  /** Posts one entry and marks it synced. Returns null if the server refused. */
  const push = useCallback(
    async (entry: Feedback) => {
      if (inFlight.current.has(entry.bookingId)) return null;
      inFlight.current.add(entry.bookingId);
      try {
        const { data } = await submitFeedback({
          employeeId,
          bookingId: entry.bookingId,
          dish: entry.dish,
          category: entry.category,
          weekday: entry.weekday,
          response: entry.response,
          servedOn: entry.servedOn,
          portionSize: entry.portionSize,
        });
        setFeedback((current) =>
          current.map((item) => (item.bookingId === entry.bookingId ? { ...item, synced: true } : item))
        );
        return data.impact;
      } catch {
        return null;
      } finally {
        inFlight.current.delete(entry.bookingId);
      }
    },
    [employeeId]
  );

  /**
   * Flush anything captured while the backend was unreachable. Without this the
   * response would sit in localStorage forever and never reach aggregation.
   * Re-posting is safe: the server replaces by booking and service date.
   */
  useEffect(() => {
    const unsynced = feedback.filter((item) => !item.synced);
    if (unsynced.length === 0) return;
    let cancelled = false;
    (async () => {
      for (const entry of unsynced) {
        if (cancelled) return;
        await push(entry);
      }
    })();
    return () => {
      cancelled = true;
    };
    // Runs on mount and whenever the pending set changes.
  }, [feedback, push]);

  const submit = useCallback(
    async (booking: Booking, response: FeedbackResponse) => {
      const optimistic: Feedback = {
        bookingId: booking.id,
        dish: booking.item.name,
        category: booking.category,
        weekday: booking.day,
        portionSize: booking.appetite,
        response,
        // The booking's own service date, never a recomputed one. Deriving it
        // here resolved the weekday backwards while the booking had resolved it
        // forwards, so a rating for tomorrow's Friday lunch was filed against
        // last Friday -- it never joined its booking, and it landed in the wrong
        // week's signal bucket.
        servedOn: booking.servedOn || serviceDateFor(booking.day),
        submittedAt: new Date().toISOString(),
        synced: false,
      };

      // Show the choice immediately; reconcile once the server confirms.
      setFeedback((current) => [...current.filter((item) => item.bookingId !== booking.id), optimistic]);
      setLastImpact(await push(optimistic));
    },
    [push]
  );

  const feedbackFor = useCallback(
    (bookingId: string) => feedback.find((item) => item.bookingId === bookingId)?.response,
    [feedback]
  );

  const isPending = useCallback(
    (bookingId: string) => feedback.some((item) => item.bookingId === bookingId && !item.synced),
    [feedback]
  );

  const pendingSyncCount = feedback.filter((item) => !item.synced).length;

  return (
    <FeedbackContext.Provider value={{ feedback, submit, feedbackFor, isPending, lastImpact, pendingSyncCount }}>
      {children}
    </FeedbackContext.Provider>
  );
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback must be used within a FeedbackProvider");
  return context;
}
