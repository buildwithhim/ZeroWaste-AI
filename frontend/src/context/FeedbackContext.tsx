import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { Booking } from "./BookingContext";

export type MealFeedback = "Finished meal" | "Left some food" | "Still hungry";
export type Feedback = { bookingId: string; dish: string; response: MealFeedback; submittedAt: string };

type FeedbackContextValue = { feedback: Feedback[]; submitFeedback: (booking: Booking, response: MealFeedback) => void; feedbackFor: (bookingId: string) => MealFeedback | undefined };
const FeedbackContext = createContext<FeedbackContextValue | null>(null);
const STORAGE_KEY = "zerowaste-meal-feedback";

export function FeedbackProvider({ children }: { children: ReactNode }) {
  const [feedback, setFeedback] = useState<Feedback[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) as Feedback[] : [];
    } catch {
      return [];
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(feedback));
  }, [feedback]);

  const submitFeedback = (booking: Booking, response: MealFeedback) => {
    setFeedback((current) => [...current.filter((item) => item.bookingId !== booking.id), { bookingId: booking.id, dish: booking.item.name, response, submittedAt: new Date().toISOString() }]);
  };

  const feedbackFor = (bookingId: string) => feedback.find((item) => item.bookingId === bookingId)?.response;
  return <FeedbackContext.Provider value={{ feedback, submitFeedback, feedbackFor }}>{children}</FeedbackContext.Provider>;
}

export function useFeedback() {
  const context = useContext(FeedbackContext);
  if (!context) throw new Error("useFeedback must be used within a FeedbackProvider");
  return context;
}
