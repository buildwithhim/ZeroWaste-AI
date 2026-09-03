/**
 * The employee home page.
 *
 * It exists to answer one question on sight: "what am I eating this week?"
 *
 * The previous version answered none of it. It greeted a hardcoded name, then
 * showed three counters -- meals selected, workdays planned, and a literal `3`
 * captioned "choices per day", which was a constant of the menu structure
 * dressed up as a personal statistic. None of it told anybody what they were
 * actually going to eat.
 *
 * Everything below is either this employee's own plan or a number the backend
 * computed for them. Nothing on this page is invented in the browser, and
 * nothing on it belongs to anybody else -- there is no cafeteria-wide figure
 * here, and no route from here to an administrator screen.
 */

import { ArrowRight, CalendarDays, CalendarPlus, Droplets, Leaf, Sparkles, UtensilsCrossed, Wind } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import LoadingSkeleton from "../components/LoadingSkeleton";
import DishImage from "../components/DishImage";
import PlanSyncStatus from "../components/PlanSyncStatus";
import { EmptyState, ErrorState } from "../components/UxStates";
import { useBookings, plannedWeekdays, todayKey, type Booking, type Weekday } from "../context/BookingContext";
import { useMenu } from "../hooks/useMenu";
import { getMyImpact, type PersonalImpact } from "../services/operationsService";

const mealOrder = { Breakfast: 0, Lunch: 1, Snacks: 2 } as const;

/** A greeting that matches the clock rather than always saying "morning". */
function greeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

const byMealOrder = (a: Booking, b: Booking) => mealOrder[a.category] - mealOrder[b.category];

export default function EmployeeHomePage() {
  const { bookings, employeeId, hydrated, serviceDateFor, syncedAt } = useBookings();
  const { advice, state: menuState, adviceState } = useMenu();

  const [impact, setImpact] = useState<PersonalImpact | null>(null);
  const [impactState, setImpactState] = useState<"loading" | "ready" | "error">("loading");

  /**
   * The next five service days in the order they happen. `today` is the first
   * of them, which is the current day whenever it is still bookable and the
   * next working day otherwise -- so the page never opens on a service that has
   * already been and gone.
   */
  const weekdays = useMemo(plannedWeekdays, []);
  const today = weekdays[0];
  const isWeekend = useMemo(() => [0, 6].includes(new Date().getDay()), []);
  const todayDate = useMemo(todayKey, []);

  useEffect(() => {
    let cancelled = false;
    setImpactState("loading");
    getMyImpact(employeeId)
      .then(({ data }) => {
        if (cancelled) return;
        setImpact(data);
        setImpactState("ready");
      })
      .catch(() => {
        if (!cancelled) setImpactState("error");
      });
    return () => {
      cancelled = true;
    };
    /**
     * Keyed on acknowledged saves, not on the local plan.
     *
     * `bookings.length` changes the instant a dish is tapped -- roughly 700ms
     * before the autosave even leaves the browser -- so re-reading on it asked
     * the server about a booking it had not been told about yet, and then never
     * asked again. A first-time booker was left looking at "no impact yet"
     * permanently, having just booked their whole week.
     */
  }, [employeeId, syncedAt]);

  const todaysMeals = useMemo(() => bookings.filter((booking) => booking.day === today).sort(byMealOrder), [bookings, today]);

  /**
   * The next meal still ahead. `weekdays` is already in service order, so the
   * first day with a booking is the next one the employee will actually eat.
   */
  const upcoming = useMemo(() => {
    for (const day of weekdays) {
      const meals = bookings.filter((booking) => booking.day === day).sort(byMealOrder);
      if (meals.length > 0) return { day, meal: meals[0] };
    }
    return null;
  }, [bookings, weekdays]);

  const plannedDays = new Set(bookings.map((booking) => booking.day)).size;

  /**
   * The Smart Plate line. It only speaks when the cafeteria has measured enough
   * feedback for the dish; otherwise the panel says the plan is not tuned yet
   * rather than presenting the default serving as advice.
   */
  const plateTip = useMemo(() => {
    for (const booking of [...todaysMeals, ...bookings].sort(byMealOrder)) {
      const entry = advice.get(booking.item.name);
      if (entry?.measured) return { booking, entry };
    }
    return null;
  }, [advice, bookings, todaysMeals]);

  return (
    <div className="page-frame employee-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">MY WEEK</span>
          <h1>{greeting()}.</h1>
          <p>Here is what you are eating this week.</p>
        </div>
        <div className="date-card">
          <CalendarDays size={17} /> {isWeekend ? "Planning for Monday" : today}
        </div>
      </div>

      <PlanSyncStatus />

      <section className="home-today" aria-labelledby="home-today-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">{isWeekend ? "NEXT SERVICE" : "TODAY"}</span>
            <h2 id="home-today-title">{isWeekend ? "Monday’s meals" : `${today}’s meals`}</h2>
          </div>
          <Link className="link-button" to="menu">
            Change <ArrowRight size={15} />
          </Link>
        </div>

        {!hydrated ? (
          <div className="today-meal-grid" aria-busy="true">
            <span className="visually-hidden">Loading your plan</span>
            <LoadingSkeleton className="skeleton-card" />
            <LoadingSkeleton className="skeleton-card" />
          </div>
        ) : todaysMeals.length === 0 ? (
          <EmptyState
            icon={UtensilsCrossed}
            title="Nothing booked yet"
            message="Book a meal and the kitchen will cook for you instead of guessing. It takes one tap."
            action={
              <Link className="primary-button" to="menu">
                Book a meal <ArrowRight size={16} />
              </Link>
            }
          />
        ) : (
          <div className="today-meal-grid">
            {todaysMeals.map((booking) => (
              <article className="today-meal-card" key={booking.id}>
                <DishImage src={booking.item.image} />
                <div>
                  <span className="menu-category">{booking.category}</span>
                  <strong>{booking.item.name}</strong>
                  <small>
                    {booking.appetite} plate · {booking.item.calories} kcal
                  </small>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      <div className="home-columns">
        <section className="home-panel" aria-labelledby="home-week-title">
          <div className="section-heading">
            <div>
              <span className="eyebrow">NEXT 5 SERVICE DAYS</span>
              <h2 id="home-week-title">Your weekly plan</h2>
            </div>
            <span className="plan-progress compact">
              <strong>{plannedDays}/5</strong>
              <small>days</small>
            </span>
          </div>

          <ul className="week-plan-list">
            {weekdays.map((day) => {
              const meals = bookings.filter((booking) => booking.day === day).sort(byMealOrder);
              const isToday = serviceDateFor(day) === todayDate;
              return (
                <li key={day} className={isToday ? "is-today" : ""}>
                  <span className="week-plan-day">
                    {day}
                    {isToday && <em>Today</em>}
                  </span>
                  {meals.length === 0 ? (
                    <Link className="week-plan-empty" to="menu">
                      <CalendarPlus size={14} /> Add a meal
                    </Link>
                  ) : (
                    <span className="week-plan-meals">
                      {meals.map((meal) => (
                        <b key={meal.id}>{meal.item.name}</b>
                      ))}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <div className="home-side">
          <section className="home-panel home-upcoming" aria-labelledby="home-upcoming-title">
            <span className="eyebrow">UP NEXT</span>
            <h2 id="home-upcoming-title">Your next meal</h2>
            {upcoming ? (
              <>
                <strong className="upcoming-dish">{upcoming.meal.item.name}</strong>
                <p>
                  {upcoming.day} · {upcoming.meal.category} · {upcoming.meal.appetite} plate
                </p>
              </>
            ) : (
              <p className="muted">Nothing booked for the rest of this week.</p>
            )}
            <Link className="secondary-button" to="menu">
              {upcoming ? "Change my plan" : "Book a meal"}
            </Link>
          </section>

          <section className="home-panel home-smart-plate" aria-labelledby="home-plate-title">
            <span className="smart-plate-icon">
              <Sparkles size={18} />
            </span>
            <span className="eyebrow">SMART PLATE</span>
            <h2 id="home-plate-title">Portion suggestion</h2>
            {menuState === "loading" && <LoadingSkeleton className="skeleton-line" />}
            {menuState === "error" && <p className="muted">Suggestions are unavailable right now.</p>}
            {menuState === "ready" && adviceState === "unavailable" && (
              /**
               * A failed advice request used to fall through to "not enough
               * ratings yet", which blamed missing data for a network fault and
               * invited an action that could not fix it.
               */
              <p className="muted">Portion suggestions are unavailable right now. Your bookings are unaffected.</p>
            )}
            {menuState === "ready" &&
              adviceState === "ready" &&
              (plateTip ? (
                <>
                  <p>
                    For <strong>{plateTip.booking.item.name}</strong>, a{" "}
                    <strong>{plateTip.entry.recommendedPlate.toLowerCase()}</strong> plate suits most people.
                  </p>
                  <small className="muted">{plateTip.entry.reason}</small>
                </>
              ) : bookings.length === 0 ? (
                <p className="muted">
                  Book a meal and we will suggest a portion size for it, based on how much of that dish other diners
                  actually finish.
                </p>
              ) : (
                <p className="muted">
                  Not enough ratings yet for the dishes you booked. Rate your lunches and this will start advising you.
                </p>
              ))}
          </section>
        </div>
      </div>

      <section className="home-panel home-impact" aria-labelledby="home-impact-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">MY IMPACT</span>
            <h2 id="home-impact-title">What your planning saved</h2>
          </div>
          <span className="green-plate-badge">
            <Leaf size={15} /> Personal
          </span>
        </div>

        {impactState === "loading" && (
          <div className="impact-metrics" aria-busy="true">
            {[0, 1, 2].map((index) => (
              <LoadingSkeleton className="skeleton-metric" key={index} />
            ))}
          </div>
        )}

        {impactState === "error" && (
          <ErrorState
            title="Impact unavailable"
            message="We could not reach the cafeteria service to work out your impact. Your bookings are unaffected."
          />
        )}

        {impactState === "ready" && impact && (impact.ratedMeals === 0 ? (
          /**
           * Keyed on ratings, not bookings.
           *
           * The figure below is this employee's share of the food the cafeteria
           * did not cook *because* ratings lowered the recommended portion. A
           * booking alone contributes nothing to it, so showing zeroes to
           * someone who has booked a full week would look like their planning
           * did not matter. It names the one action that does move the number.
           */
          <EmptyState
            icon={Leaf}
            title={impact.meals === 0 ? "No impact to show yet" : "Rate a meal to see your impact"}
            message={
              impact.meals === 0
                ? "Book a meal, then rate it after you have eaten. Your ratings are what tell the kitchen how much to cook."
                : `You have ${impact.mealsThisWeek} ${impact.mealsThisWeek === 1 ? "meal" : "meals"} booked this week. Rate a lunch after you have eaten it and your share of the food saved will appear here.`
            }
          />
        ) : (
          <>
            <div className="impact-metrics">
              <article>
                <span>
                  <UtensilsCrossed size={17} />
                </span>
                <strong>{impact.savedKg.toFixed(1)} kg</strong>
                <small>Your share of food not wasted</small>
              </article>
              <article>
                <span>
                  <Wind size={17} />
                </span>
                <strong>{impact.co2eSavedKg.toFixed(1)} kg</strong>
                <small>CO₂e avoided</small>
              </article>
              <article>
                <span>
                  <Droplets size={17} />
                </span>
                <strong>{impact.waterSavedLitres.toLocaleString()} L</strong>
                <small>Water avoided</small>
              </article>
            </div>
            <p className="impact-basis">
              {impact.basis.explanation} You rated {impact.ratedMeals} {impact.ratedMeals === 1 ? "meal" : "meals"} of the{" "}
              {impact.basis.totalRatings} rated across the cafeteria, so {impact.basis.sharePercent}% of the{" "}
              {impact.basis.cafeteriaSavedKg} kg saved is counted as yours.{" "}
              {impact.finishedSharePercent !== null ? `You finished ${impact.finishedSharePercent}% of them. ` : ""}
              {impact.factors.basis}
            </p>
          </>
        ))}
      </section>
    </div>
  );
}
