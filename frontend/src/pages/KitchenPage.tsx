/**
 * The kitchen's copy of today's plan.
 *
 * This page used to recompute its own demand figures from the browser's
 * bookings with its own hardcoded walk-in, cancellation and buffer rates, which
 * meant the kitchen and the admin overview could disagree about how much to
 * cook. Both now read the same plan from GET /admin/operations/today, so there
 * is exactly one recommended quantity per dish in the system.
 *
 * The preparation checklist below is deliberately local: it tracks what the
 * kitchen has physically done this morning, which is not something the backend
 * knows or should guess.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Check, CircleCheck, ClipboardCheck, CookingPot, Salad, Soup, Utensils } from "lucide-react";

import { getTodayPlan, type TodayPlan } from "../services/operationsService";

type PrepItem = { name: string; icon: typeof CookingPot };

/**
 * The prep checklist is a local scratchpad for what the kitchen has physically
 * done this morning; nothing measures it, so nothing here reports a measurement.
 * These rows used to carry literal starting percentages (70, 45, 25, 10) that
 * were rendered as "70% complete" with a matching progress bar -- a fabricated
 * figure that never moved until the button was pressed. A row is now simply
 * done or not done.
 */
const prepItems: PrepItem[] = [
  { name: "Rice", icon: CookingPot },
  { name: "Curry", icon: Soup },
  { name: "Roti", icon: Utensils },
  { name: "Salad", icon: Salad },
  { name: "Dessert", icon: CircleCheck },
];

const TONES = ["blue", "green", "violet", "orange"];

export default function KitchenPage() {
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let live = true;
    getTodayPlan()
      .then(({ data }) => live && setPlan(data))
      .catch((cause) => {
        if (!live) return;
        setError(cause?.response?.data?.error ?? "Could not load today's cooking plan from the operations service.");
      });
    return () => {
      live = false;
    };
  }, []);

  const preparedCount = prepItems.filter((item) => prepared[item.name]).length;

  if (error) {
    return (
      <div className="page-frame admin-portal-page kitchen-intelligence-page">
        <div className="ops-error" role="alert">
          <AlertTriangle size={18} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="page-frame admin-portal-page kitchen-intelligence-page">
        <p className="ops-status">Loading today's cooking plan…</p>
      </div>
    );
  }

  const portionChangePercent = Math.round(
    (plan.dishes.reduce((sum, dish) => sum + dish.portionMultiplier, 0) / plan.dishes.length - 1) * 100
  );

  return (
    <div className="page-frame admin-portal-page kitchen-intelligence-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">KITCHEN INTELLIGENCE</span>
          <h1>Dish-wise recommendations.</h1>
          <p>The same plan the operations overview shows, issued for {plan.weekday}.</p>
        </div>
        <span className="live-pill">
          <i />{" "}
          {plan.method.feedbackResponses > 0
            ? `Portions ${portionChangePercent > 0 ? "+" : ""}${portionChangePercent}% from ${plan.method.feedbackResponses} responses`
            : "Live from bookings"}
        </span>
      </div>

      <section className="dish-recommendation-grid" aria-label="Dish-wise cooking recommendations">
        {plan.dishes.map((dish, index) => (
          <motion.article
            className={`dish-recommendation-card ${TONES[index % TONES.length]}`}
            key={dish.dish}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            whileHover={{ y: -4, boxShadow: "0 16px 30px rgba(0,0,0,.11)" }}
          >
            <div className="dish-card-heading">
              <span className="dish-card-icon">
                <Utensils size={18} />
              </span>
              <span className="dish-live">{dish.category.toUpperCase()}</span>
            </div>
            <h2>{dish.dish}</h2>
            <div className="dish-metrics">
              <span>
                <small>Pre-booked</small>
                <strong>{dish.preBooked}</strong>
              </span>
              <span>
                <small>Predicted demand</small>
                <strong>{dish.predictedDemand}</strong>
              </span>
              <span>
                <small>Recommended cook</small>
                <strong>{dish.recommendedCook}</strong>
              </span>
              <span>
                <small>Food to prepare</small>
                <strong>{dish.preparedFoodKg} kg</strong>
              </span>
            </div>
            <div className="risk-row">
              <span>
                <small>Waste risk</small>
                <b className={`risk-${dish.risk.toLowerCase()}`}>{dish.risk}</b>
              </span>
              <span>
                <small>Portion size</small>
                <b>×{dish.portionMultiplier}</b>
              </span>
            </div>
          </motion.article>
        ))}
      </section>

      <section className="kitchen-intelligence-columns">
        <motion.article
          className="surface-panel preparation-checklist"
          initial={{ opacity: 0, x: -12 }}
          animate={{ opacity: 1, x: 0 }}
        >
          <div className="panel-heading">
            <div>
              <span className="eyebrow">PREPARATION CHECKLIST</span>
              <h2>Today's kitchen run</h2>
            </div>
            <span className="checklist-count">
              {preparedCount}/{prepItems.length} ready
            </span>
          </div>
          {prepItems.map(({ name, icon: Icon }) => {
            const isPrepared = prepared[name] === true;
            const progress = isPrepared ? 100 : 0;
            return (
              <div className="prep-check-row" key={name}>
                <span className="prep-check-icon">
                  <Icon size={18} />
                </span>
                <span className="prep-check-content">
                  <span>
                    <strong>{name}</strong>
                    <small>{isPrepared ? "Prepared" : "Not started"}</small>
                  </span>
                  <i>
                    <em style={{ width: `${progress}%` }} />
                  </i>
                </span>
                <button
                  type="button"
                  className={`prep-toggle${isPrepared ? " is-prepared" : ""}`}
                  onClick={() => setPrepared((current) => ({ ...current, [name]: !isPrepared }))}
                  aria-pressed={isPrepared}
                >
                  {isPrepared ? (
                    <>
                      <Check size={14} /> Prepared
                    </>
                  ) : (
                    "Mark Prepared"
                  )}
                </button>
              </div>
            );
          })}
        </motion.article>

        <motion.aside
          className="kitchen-intelligence-note"
          initial={{ opacity: 0, x: 12 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 }}
        >
          <span className="guidance-icon">
            <ClipboardCheck size={22} />
          </span>
          <span className="eyebrow light">SERVICE SIGNAL</span>
          <h2>{plan.today.preBookings} bookings mapped.</h2>
          <p>
            Cook {plan.today.recommendedCook} servings — {plan.today.preparedFoodKg} kg of food. Demand assumes a{" "}
            {Math.round(plan.method.turnoutRatio * 100)}% turnout{" "}
            {plan.method.turnoutMeasured ? "measured from service history" : "assumed until service history exists"}, plus
            a {Math.round(plan.method.bufferRate * 1000) / 10}% safety buffer.
          </p>
        </motion.aside>
      </section>
    </div>
  );
}
