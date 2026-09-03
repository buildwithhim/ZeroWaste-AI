/**
 * Booking a week of meals.
 *
 * DESIGN CONSTRAINT: booking a meal must take at most two or three
 * interactions. The previous flow took six -- pick a day, open a dish, open the
 * Smart Plate modal, choose a size, confirm the plate, then find and press a
 * separate "Save weekly plan" button somewhere else on the page. Every one of
 * those steps was a place to give up, and the last one was a place to *think*
 * you had booked when you had not.
 *
 * The flow here is:
 *   1. the day is already today,
 *   2. tap a dish -- it is booked, with the recommended plate, and saved.
 *
 * Adjusting the plate is an optional third tap on the booked card rather than a
 * gate in front of the booking. Removing a meal is confirmed, because it is the
 * one action here that cannot be undone.
 */

import { AlertCircle, Check, ChevronLeft, ChevronRight, Sparkles, Trash2, UtensilsCrossed } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import ConfirmDialog from "../components/ConfirmDialog";
import DishImage from "../components/DishImage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import PlanSyncStatus from "../components/PlanSyncStatus";
import { EmptyState, ErrorState } from "../components/UxStates";
import { useBookings, plannedWeekdays, todayKey, type Appetite, type MealCategory, type Weekday } from "../context/BookingContext";
import { useMenu } from "../hooks/useMenu";
import type { MenuItem } from "../types/menu";

const categories: MealCategory[] = ["Breakfast", "Lunch", "Snacks"];
const plates: { name: Appetite; hint: string }[] = [
  { name: "Light", hint: "Smaller plate" },
  { name: "Regular", hint: "Standard serving" },
  { name: "Heavy", hint: "Fuller plate" },
];

/**
 * The day to open on.
 *
 * The page used to always open on Monday, so on a Thursday the first thing an
 * employee saw was a day they had already eaten. The ordered planning week
 * always starts at the next bookable service day, so opening on its first entry
 * lands on today when today is still bookable.
 */
function defaultDay(days: Weekday[]): Weekday {
  return days[0];
}

/** "Thu 14 Aug", for the day strip. */
function shortDate(iso: string) {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return "";
  return parsed.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

export default function TodaysMenuPage() {
  const { bookings, appetitePreference, selectMeal, removeMeal, serviceDateFor, hydrated } = useBookings();
  const { items, advice, state, reload, recommendedPlate } = useMenu();

  const weekdays = useMemo(plannedWeekdays, []);
  const today = useMemo(() => defaultDay(weekdays), [weekdays]);
  const [selectedDay, setSelectedDay] = useState<Weekday>(today);
  /** The booked card whose plate picker is open. Null means none. */
  const [platePickerFor, setPlatePickerFor] = useState<MealCategory | null>(null);
  const [pendingRemoval, setPendingRemoval] = useState<{ category: MealCategory; dish: string } | null>(null);
  /** The dish just booked, so the card can acknowledge the tap. */
  const [justBooked, setJustBooked] = useState<string | null>(null);
  const ackTimer = useRef<number | null>(null);

  const dayBookings = useMemo(
    () => new Map(bookings.filter((booking) => booking.day === selectedDay).map((booking) => [booking.category, booking])),
    [bookings, selectedDay]
  );

  const acknowledge = (dish: string) => {
    setJustBooked(dish);
    if (ackTimer.current) window.clearTimeout(ackTimer.current);
    ackTimer.current = window.setTimeout(() => setJustBooked(null), 1600);
  };

  /** One tap: book the dish at the recommended plate and let autosave carry it. */
  const bookDish = (category: MealCategory, item: MenuItem) => {
    selectMeal(selectedDay, category, item, recommendedPlate(item.name, appetitePreference));
    acknowledge(item.name);
    setPlatePickerFor(null);
  };

  const changePlate = (category: MealCategory, item: MenuItem, plate: Appetite) => {
    selectMeal(selectedDay, category, item, plate);
    setPlatePickerFor(null);
  };

  const confirmRemoval = () => {
    if (pendingRemoval) removeMeal(selectedDay, pendingRemoval.category);
    setPendingRemoval(null);
  };

  const plannedDays = new Set(bookings.map((booking) => booking.day)).size;

  return (
    <div className="page-frame employee-booking">
      <div className="page-intro">
        <div>
          <span className="eyebrow">MY WEEK</span>
          <h1>Book your meals</h1>
          <p>Tap a dish to book it. Your plan saves by itself — there is no submit button to remember.</p>
        </div>
        <div className="plan-progress" aria-label={`${plannedDays} of 5 workdays planned`}>
          <strong>{plannedDays}/5</strong>
          <small>days planned</small>
        </div>
      </div>

      <PlanSyncStatus />

      <nav className="day-strip" aria-label="Choose a day">
        {weekdays.map((day) => {
          const count = bookings.filter((booking) => booking.day === day).length;
          const serviceDate = serviceDateFor(day);
          const isToday = serviceDate === todayKey();
          return (
            <button
              key={day}
              type="button"
              className={`day-chip${day === selectedDay ? " selected" : ""}`}
              onClick={() => setSelectedDay(day)}
              aria-current={day === selectedDay ? "true" : undefined}
            >
              <span className="day-chip-name">
                {day.slice(0, 3)}
                {isToday && <em>Today</em>}
              </span>
              <small>{shortDate(serviceDate)}</small>
              <b className={count ? "has-meals" : ""}>{count ? `${count} booked` : "Nothing yet"}</b>
            </button>
          );
        })}
      </nav>

      {(state === "loading" || !hydrated) && (
        <div className="menu-loading" aria-busy="true" aria-live="polite">
          <span className="visually-hidden">Loading today’s menu</span>
          {categories.map((category) => (
            <div className="meal-group" key={category}>
              <LoadingSkeleton className="skeleton-heading" />
              <div className="dish-picker-grid">
                {[0, 1, 2].map((index) => (
                  <LoadingSkeleton className="skeleton-card" key={index} />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {state === "error" && (
        <ErrorState
          title="We could not load the menu"
          message="The cafeteria service is not responding, so we cannot show you what is being cooked. Your existing bookings are safe."
          onRetry={reload}
        />
      )}

      {state === "ready" && hydrated && items.length === 0 && (
        <EmptyState
          icon={UtensilsCrossed}
          title="No menu published yet"
          message="The cafeteria has not published dishes for this week. Check back later today."
        />
      )}

      {state === "ready" &&
        hydrated &&
        items.length > 0 &&
        categories.map((category) => {
          const choices = items.filter((item) => item.category === category);
          if (choices.length === 0) return null;
          const booked = dayBookings.get(category);
          /**
           * The booked dish is already shown in full above the picker, so
           * repeating it in the grid made the same meal appear twice in one
           * group -- on a phone the two cards were often the only two visible,
           * which read as a double booking. The grid is therefore the list of
           * dishes you could switch to.
           */
          const alternatives = booked ? choices.filter((item) => item.name !== booked.item.name) : choices;

          return (
            <div className="meal-group" key={category}>
              <div className="meal-group-heading">
                <h2>{category}</h2>
                {booked ? (
                  <span className="meal-group-status booked">
                    <Check size={14} /> Booked
                  </span>
                ) : (
                  <span className="meal-group-status">Not booked</span>
                )}
              </div>

              {booked && (
                <article className="booked-meal">
                  <DishImage src={booked.item.image} />
                  <div className="booked-meal-body">
                    <strong>{booked.item.name}</strong>
                    <small>
                      {booked.appetite} plate · {booked.item.calories} kcal · {booked.item.protein}g protein
                    </small>
                    {/**
                     * The tap acknowledgement. It lives on the booked card
                     * because the booked dish is no longer in the grid below,
                     * and it is announced so a screen-reader user gets the same
                     * confirmation a sighted one does.
                     */}
                    {justBooked === booked.item.name && (
                      <span className="booked-meal-ack" role="status">
                        <Check size={13} /> Added to your week
                      </span>
                    )}
                    {platePickerFor === category ? (
                      <div className="plate-picker" role="group" aria-label="Choose your plate size">
                        {plates.map((plate) => (
                          <button
                            key={plate.name}
                            type="button"
                            className={`plate-chip${booked.appetite === plate.name ? " selected" : ""}`}
                            onClick={() => changePlate(category, booked.item, plate.name)}
                          >
                            <strong>{plate.name}</strong>
                            <small>{plate.hint}</small>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="booked-meal-actions">
                        <button type="button" className="link-button" onClick={() => setPlatePickerFor(category)}>
                          Change plate size
                        </button>
                        <button
                          type="button"
                          className="link-button danger"
                          onClick={() => setPendingRemoval({ category, dish: booked.item.name })}
                        >
                          <Trash2 size={14} /> Remove
                        </button>
                      </div>
                    )}
                  </div>
                </article>
              )}

              <div className="dish-picker-grid">
                {alternatives.map((item) => {
                  const tip = advice.get(item.name);
                  return (
                    <button
                      key={item.name}
                      type="button"
                      className="dish-picker-card"
                      onClick={() => bookDish(category, item)}
                    >
                      <DishImage src={item.image} />
                      <span className="dish-picker-body">
                        <strong>{item.name}</strong>
                        <small>{item.description}</small>
                        <span className="dish-picker-meta">
                          {item.calories} kcal · {item.protein}g protein
                        </span>
                        {tip?.measured && (
                          <span className="dish-picker-tip" title={tip.reason}>
                            <Sparkles size={12} /> {tip.recommendedPlate} plate suits most people
                          </span>
                        )}
                      </span>
                      <span className="dish-picker-action">
                        {booked ? (
                          <>
                            Switch to this <ChevronRight size={15} />
                          </>
                        ) : (
                          <>
                            Book <ChevronRight size={15} />
                          </>
                        )}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}

      {state === "ready" && hydrated && items.length > 0 && (
        <div className="booking-footer-nav">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setSelectedDay(weekdays[Math.max(0, weekdays.indexOf(selectedDay) - 1)])}
            disabled={weekdays.indexOf(selectedDay) === 0}
          >
            <ChevronLeft size={15} /> Previous day
          </button>
          <button
            type="button"
            className="order-button"
            onClick={() => setSelectedDay(weekdays[Math.min(weekdays.length - 1, weekdays.indexOf(selectedDay) + 1)])}
            disabled={weekdays.indexOf(selectedDay) === weekdays.length - 1}
          >
            Next day <ChevronRight size={15} />
          </button>
        </div>
      )}

      <p className="booking-privacy">
        <AlertCircle size={14} /> Your plan is shared with the kitchen as a count only. Nobody sees what you personally
        booked.
      </p>

      {pendingRemoval && (
        <ConfirmDialog
          title={`Remove ${pendingRemoval.dish}?`}
          message={`This cancels your ${pendingRemoval.category.toLowerCase()} booking for ${selectedDay} and tells the kitchen to cook one less. You can book again any time before service.`}
          confirmLabel="Remove meal"
          cancelLabel="Keep it"
          onConfirm={confirmRemoval}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
    </div>
  );
}
