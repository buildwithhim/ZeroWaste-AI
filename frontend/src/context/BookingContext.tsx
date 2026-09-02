import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { MenuItem } from "../components/MenuCard";

export type Weekday = "Monday" | "Tuesday" | "Wednesday" | "Thursday" | "Friday";
export type MealCategory = "Breakfast" | "Lunch" | "Snacks";
export type Appetite = "Light" | "Regular" | "Heavy";
export type Booking = { id: string; day: Weekday; category: MealCategory; item: MenuItem; appetite: Appetite; bookedAt: string };

type BookingContextValue = { bookings: Booking[]; appetitePreference: Appetite; setAppetitePreference: (appetite: Appetite) => void; selectMeal: (day: Weekday, category: MealCategory, item: MenuItem, appetite?: Appetite) => void; removeMeal: (day: Weekday, category: MealCategory) => void; saveWeeklyPlan: () => void; planSaved: boolean };
const BookingContext = createContext<BookingContextValue | null>(null);
const STORAGE_KEY = "zerowaste-weekly-bookings";
const APPETITE_KEY = "zerowaste-appetite-preference";

export function BookingProvider({ children }: { children: ReactNode }) {
  const [bookings, setBookings] = useState<Booking[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) as Booking[] : [];
    } catch {
      return [];
    }
  });
  const [appetitePreference, setAppetitePreferenceState] = useState<Appetite>(() => {
    const stored = localStorage.getItem(APPETITE_KEY);
    return stored === "Light" || stored === "Heavy" ? stored : "Regular";
  });
  const [planSaved, setPlanSaved] = useState(false);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
  }, [bookings]);

  const setAppetitePreference = (appetite: Appetite) => {
    localStorage.setItem(APPETITE_KEY, appetite);
    setAppetitePreferenceState(appetite);
  };

  const selectMeal = (day: Weekday, category: MealCategory, item: MenuItem, appetite = appetitePreference) => {
    setBookings((current) => [...current.filter((booking) => booking.day !== day || booking.category !== category), { id: `${day}-${category}`, day, category, item, appetite, bookedAt: new Date().toISOString() }]);
    setAppetitePreference(appetite);
    setPlanSaved(false);
  };

  const removeMeal = (day: Weekday, category: MealCategory) => {
    setBookings((current) => current.filter((booking) => booking.day !== day || booking.category !== category));
    setPlanSaved(false);
  };

  const saveWeeklyPlan = () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bookings));
    setPlanSaved(true);
    window.setTimeout(() => setPlanSaved(false), 2800);
  };

  return <BookingContext.Provider value={{ bookings, appetitePreference, setAppetitePreference, selectMeal, removeMeal, saveWeeklyPlan, planSaved }}>{children}</BookingContext.Provider>;
}

export function useBookings() {
  const context = useContext(BookingContext);
  if (!context) throw new Error("useBookings must be used within a BookingProvider");
  return context;
}
