/**
 * The employee's own bookings.
 *
 * Two things were missing here. There was no way to cancel a meal at all --
 * removal existed in the booking context but nothing rendered it, so a plan
 * could only ever grow. And the list was flat, which made it hard to see the
 * shape of the week at a glance.
 *
 * Cancelling is confirmed because it immediately tells the kitchen to cook one
 * less, and there is no undo.
 */

import { CalendarPlus, CheckCircle2, Clock3, Leaf, ShoppingBag, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import ConfirmDialog from "../components/ConfirmDialog";
import DishImage from "../components/DishImage";
import LoadingSkeleton from "../components/LoadingSkeleton";
import MealFeedback from "../components/MealFeedback";
import PlanSyncStatus from "../components/PlanSyncStatus";
import { EmptyState } from "../components/UxStates";
import { useBookings, todayKey, type Booking, type MealCategory, type Weekday } from "../context/BookingContext";

const weekdays: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const mealOrder = { Breakfast: 0, Lunch: 1, Snacks: 2 } as const;

export default function OrderHistoryPage() {
  const { bookings, removeMeal, hydrated } = useBookings();
  const [pendingRemoval, setPendingRemoval] = useState<Booking | null>(null);

  /** Grouped by day so the week reads in order rather than in booking order. */
  const byDay = useMemo(
    () =>
      weekdays
        .map((day) => ({
          day,
          meals: bookings
            .filter((booking) => booking.day === day)
            .sort((a, b) => mealOrder[a.category] - mealOrder[b.category]),
        }))
        .filter((group) => group.meals.length > 0),
    [bookings]
  );

  const confirmRemoval = () => {
    if (pendingRemoval) removeMeal(pendingRemoval.day, pendingRemoval.category as MealCategory);
    setPendingRemoval(null);
  };

  return (
    <div className="page-frame history-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">MY BOOKINGS</span>
          <h1>Your weekly bookings.</h1>
          <p>Everything you have booked, and where you can rate a meal after you have eaten it.</p>
        </div>
        <div className="history-count">
          <strong>{hydrated ? bookings.length : "—"}</strong>
          <span>meals booked</span>
        </div>
      </div>

      <PlanSyncStatus />

      {!hydrated ? (
        <div className="history-list" aria-busy="true">
          <span className="visually-hidden">Loading your bookings</span>
          <LoadingSkeleton className="skeleton-card" />
          <LoadingSkeleton className="skeleton-card" />
        </div>
      ) : bookings.length === 0 ? (
        <EmptyState
          icon={ShoppingBag}
          title="No meals booked yet"
          message="Book a meal and it will appear here. Booking ahead is what lets the cafeteria cook the right amount."
          action={
            <Link className="primary-button" to="../menu">
              Book a meal
            </Link>
          }
        />
      ) : (
        byDay.map((group) => (
          <section className="history-day" key={group.day}>
            <h2 className="history-day-heading">{group.day}</h2>
            <div className="history-list">
              {group.meals.map((booking) => (
                <article className="history-item" key={booking.id}>
                  <DishImage src={booking.item.image} />
                  <div className="history-item-content">
                    <h3>{booking.item.name}</h3>
                    <span>
                      <Clock3 size={13} /> {booking.category} · {booking.appetite} plate
                    </span>
                    <div className="history-item-meta">
                      <strong>₹{booking.item.price.toFixed(0)}</strong>
                      <span className="history-status">
                        <CheckCircle2 size={13} /> Booked
                      </span>
                      <button
                        type="button"
                        className="link-button danger"
                        onClick={() => setPendingRemoval(booking)}
                        aria-label={`Cancel ${booking.item.name} on ${booking.day}`}
                      >
                        <Trash2 size={14} /> Cancel
                      </button>
                    </div>
                    {booking.category === "Lunch" &&
                      (booking.servedOn <= todayKey() ? (
                        <MealFeedback booking={booking} />
                      ) : (
                        /**
                         * Rating is offered only once the meal has been served.
                         * It used to appear on every lunch, including ones days
                         * away, which asked people to describe a portion they
                         * had not eaten -- and fed that guess straight into the
                         * signal the kitchen cooks from.
                         */
                        <span className="meal-feedback-pending">
                          <Clock3 size={12} /> You can rate this after it is served.
                        </span>
                      ))}
                  </div>
                </article>
              ))}
            </div>
          </section>
        ))
      )}

      {bookings.length > 0 && bookings.length < weekdays.length && (
        <Link className="secondary-button add-more-link" to="../menu">
          <CalendarPlus size={16} /> Book more meals
        </Link>
      )}

      <div className="history-impact">
        <Leaf size={19} />
        <span>
          <strong>Your weekly plan</strong>
          <small>Advance bookings help the cafeteria prepare the right amount. Your choices are never shown to anyone individually.</small>
        </span>
      </div>

      {pendingRemoval && (
        <ConfirmDialog
          title={`Cancel ${pendingRemoval.item.name}?`}
          message={`This removes your ${pendingRemoval.category.toLowerCase()} booking for ${pendingRemoval.day} and tells the kitchen to cook one less. You can book again any time before service.`}
          confirmLabel="Cancel meal"
          cancelLabel="Keep it"
          onConfirm={confirmRemoval}
          onCancel={() => setPendingRemoval(null)}
        />
      )}
    </div>
  );
}
