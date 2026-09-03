/**
 * The cafeteria's operating page.
 *
 * It exists to answer one question — how much should we prepare today? — and is
 * ordered accordingly: the decision first, the dish-level instructions second,
 * and the evidence that the forecast can be trusted last.
 *
 * Every figure on this page is read from GET /admin/operations/today or
 * /accuracy. There are no constants here: no assumed headcount, no assumed
 * walk-in or cancellation rate, no assumed buffer. Where the backend cannot yet
 * measure something it says so, and the page prints that reason instead of a
 * number. A plausible-looking invented figure is worse than a visible gap,
 * because a kitchen will cook to it.
 */

import { useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  ChefHat,
  ChevronDown,
  Info,
  Scale,
  Target,
  TrendingDown,
  Users,
  Utensils,
} from "lucide-react";

import CountUp from "../components/CountUp";
import {
  getAccuracyReport,
  getTodayPlan,
  type AccuracyReport,
  type DishPlan,
  type MealCategory,
  type RiskLevel,
  type TodayPlan,
} from "../services/operationsService";

const CATEGORY_ORDER: MealCategory[] = ["Breakfast", "Lunch", "Snacks"];

const RISK_TONE: Record<RiskLevel, string> = {
  Low: "risk-low",
  Medium: "risk-medium",
  High: "risk-high",
  Unrated: "risk-unrated",
};

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** Renders a measured number, or the backend's reason for not having one. */
function Measured({ value, suffix = "", unavailable }: { value: number | null; suffix?: string; unavailable: string }) {
  if (value === null || value === undefined) return <span className="stat-unavailable">{unavailable}</span>;
  // Rendered exactly rather than counted up: 94.2% must not display as 94%.
  return (
    <>
      {value}
      {suffix}
    </>
  );
}

export default function AdminOverviewPage() {
  const [plan, setPlan] = useState<TodayPlan | null>(null);
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let live = true;

    Promise.all([getTodayPlan(), getAccuracyReport(14)])
      .then(([planResponse, reportResponse]) => {
        if (!live) return;
        setPlan(planResponse.data);
        setReport(reportResponse.data);
        setError(null);
      })
      .catch((cause) => {
        if (!live) return;
        setError(
          cause?.response?.data?.error ??
            "Could not reach the operations service. Start the backend on port 5000 and reload."
        );
      })
      .finally(() => live && setLoading(false));

    return () => {
      live = false;
    };
  }, []);

  const grouped = useMemo(() => {
    if (!plan) return [] as { category: MealCategory; dishes: DishPlan[] }[];
    return CATEGORY_ORDER.map((category) => ({
      category,
      dishes: plan.dishes.filter((dish) => dish.category === category),
    })).filter((group) => group.dishes.length > 0);
  }, [plan]);

  if (loading) {
    return (
      <div className="page-frame admin-portal-page">
        <p className="ops-status">Building today's cooking plan…</p>
      </div>
    );
  }

  if (error || !plan || !report) {
    return (
      <div className="page-frame admin-portal-page">
        <div className="ops-error" role="alert">
          <AlertTriangle size={18} />
          <p>{error ?? "No plan available."}</p>
        </div>
      </div>
    );
  }

  const { today, method } = plan;
  const { forecastAccuracy, wastePrevented, historicalWaste, predictionVsActual } = report;

  const headline = [
    {
      label: "Total employees",
      value: today.totalEmployees,
      detail: today.rosterSource === "roster-file" ? `${today.site} roster` : `${today.site} · ${today.rosterSource}`,
      icon: Users,
      tone: "blue",
    },
    {
      label: "Pre-bookings",
      value: today.preBookings,
      detail: `${today.employeesBooked} employees · ${today.participationPercent}% of headcount`,
      icon: Utensils,
      tone: "violet",
    },
    {
      label: "Predicted demand",
      value: today.predictedDemand,
      detail: `Turnout ${Math.round(method.turnoutRatio * 100)}% ${method.turnoutMeasured ? "measured" : "assumed"}`,
      icon: Target,
      tone: "green",
    },
    {
      label: "Recommended cook",
      value: today.recommendedCook,
      detail: `Demand + ${Math.round(method.bufferRate * 1000) / 10}% buffer`,
      icon: ChefHat,
      tone: "orange",
    },
  ];

  return (
    <div className="page-frame admin-portal-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">TODAY</span>
          <h1>How much should the cafeteria prepare today?</h1>
          <p>
            {today.recommendedCook} servings across {plan.dishes.length} dishes — {today.preparedFoodKg} kg of food,
            sized from {method.feedbackResponses} post-meal responses.
          </p>
        </div>
        <span className="portal-date">{formatDate(plan.date)}</span>
      </div>

      <motion.section
        className="metric-grid"
        aria-label="Today's cooking decision"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.06 } } }}
      >
        {headline.map(({ label, value, detail, icon: Icon, tone }) => (
          <motion.article
            className="metric-card"
            key={label}
            variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
            whileHover={{ y: -4, boxShadow: "0 16px 30px rgba(0,0,0,.11)" }}
          >
            <span className={`metric-icon ${tone}`}>
              <Icon size={19} />
            </span>
            <span className="metric-label">{label}</span>
            <strong>
              <CountUp value={value} />
            </strong>
            <small>{detail}</small>
          </motion.article>
        ))}
      </motion.section>

      <section className="ops-risk-row" aria-label="Expected outcome">
        <article className="ops-risk-card">
          <span className="metric-label">Expected leftovers</span>
          <strong>
            {today.expectedCounterLeftoverKg} <em>kg</em>
          </strong>
          <small>
            Cooked but not taken · {today.expectedCounterSharePercent}% of food prepared. A further{" "}
            {today.expectedPlateWasteKg} kg is expected to be served but left on plates.
          </small>
        </article>
        <article className={`ops-risk-card ${RISK_TONE[today.wasteRisk]}`}>
          <span className="metric-label">Waste risk</span>
          <strong>{today.wasteRisk}</strong>
          <small>
            {today.wasteRiskBasis === "measured-service-history"
              ? `${today.measuredWasteSharePercent}% of cooked food actually went uneaten at the counter across ${today.measuredWasteDays} closed service days`
              : `Needs ${today.minimumRiskDays} closed service days to rate; ${today.measuredWasteDays} recorded so far`}
          </small>
        </article>
        <article className="ops-risk-card">
          <span className="metric-label">Food to prepare</span>
          <strong>
            {today.preparedFoodKg} <em>kg</em>
          </strong>
          <small>
            {today.preparedFoodPortions} full-size portions of ingredients for {today.recommendedCook} servings
          </small>
        </article>
      </section>

      {method.cappedCategories.length > 0 && (
        <p className="ops-note" role="note">
          <Info size={15} /> Raw model demand exceeded the {today.totalEmployees}-person roster for{" "}
          {method.cappedCategories.join(", ")} and was capped — one employee eats at most one meal per sitting.
        </p>
      )}

      {method.predictorError && (
        <p className="ops-note warn" role="note">
          <AlertTriangle size={15} /> The forecasting model did not respond ({method.predictorError}); demand below
          falls back to pre-bookings adjusted for measured turnout.
        </p>
      )}

      <section className="ops-section" aria-label="Dish-level cooking recommendations">
        <header className="ops-section-head">
          <h2>Cook this much of each dish</h2>
          <p>Recommended cook is servings. Prepared food is that many servings at the portion size feedback supports.</p>
        </header>

        {grouped.map(({ category, dishes }) => (
          <div className="ops-dish-group" key={category}>
            <h3>{category}</h3>
            <div className="ops-table-scroll">
              <table className="ops-table">
                <thead>
                  <tr>
                    <th scope="col">Dish</th>
                    <th scope="col">Pre-booked</th>
                    <th scope="col">Predicted</th>
                    <th scope="col">Recommended cook</th>
                    <th scope="col">Food (kg)</th>
                    <th scope="col">Counter leftover</th>
                    <th scope="col">Risk</th>
                  </tr>
                </thead>
                <tbody>
                  {dishes.map((dish) => (
                    <tr key={dish.dish}>
                      <th scope="row">
                        {dish.dish}
                        <small>
                          Portion ×{dish.portionMultiplier} from{" "}
                          {dish.portionSignalLevel === "none"
                            ? "no feedback yet"
                            : `${dish.portionSignalResponses} ${dish.portionSignalLevel}-level responses`}
                        </small>
                      </th>
                      <td>{dish.preBooked}</td>
                      <td>{dish.predictedDemand}</td>
                      <td className="ops-emphasis">{dish.recommendedCook}</td>
                      <td>{dish.preparedFoodKg}</td>
                      <td>
                        {dish.expectedCounterLeftoverKg} kg
                        <small>{dish.expectedCounterSharePercent}% of prepared</small>
                      </td>
                      <td>
                        <span className={`ops-pill ${RISK_TONE[dish.risk]}`}>{dish.risk}</span>
                        <small>
                          {dish.riskBasis === "measured-dish-history"
                            ? `${dish.measuredWasteSharePercent}% wasted over ${dish.measuredWasteDays} days`
                            : `Needs ${dish.minimumRiskDays} service days`}
                        </small>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}
      </section>

      <section className="ops-section" aria-label="Forecast performance">
        <header className="ops-section-head">
          <h2>Can this forecast be trusted?</h2>
          <p>Graded against plans frozen before service, never recomputed afterwards.</p>
        </header>

        <div className="ops-evidence-grid">
          <article className="ops-evidence-card">
            <span className="metric-icon green">
              <Target size={18} />
            </span>
            <span className="metric-label">Forecast accuracy</span>
            <strong>
              <Measured
                value={forecastAccuracy.accuracyPercent}
                suffix="%"
                unavailable="Not yet measured"
              />
            </strong>
            <small>
              {forecastAccuracy.reason ??
                `${forecastAccuracy.gradedDays} graded days · mean error ${forecastAccuracy.meanAbsoluteErrorPortions} portions per dish`}
            </small>
          </article>

          <article className="ops-evidence-card">
            <span className="metric-icon blue">
              <TrendingDown size={18} />
            </span>
            <span className="metric-label">Waste prevented</span>
            <strong>
              {wastePrevented.kg} <em>kg</em>
            </strong>
            <small>{wastePrevented.basis}</small>
          </article>

          <article className="ops-evidence-card">
            <span className="metric-icon orange">
              <Scale size={18} />
            </span>
            <span className="metric-label">Historical waste</span>
            <strong>
              {historicalWaste.totalLeftoverKg} <em>kg</em>
            </strong>
            <small>Recorded across {historicalWaste.daysRecorded} closed service days</small>
          </article>
        </div>

        <div className="ops-split">
          <div className="ops-table-scroll">
            <h3>Prediction vs actual</h3>
            <table className="ops-table">
              <thead>
                <tr>
                  <th scope="col">Day</th>
                  <th scope="col">Predicted</th>
                  <th scope="col">Actually served</th>
                  <th scope="col">Variance</th>
                  <th scope="col">Accuracy</th>
                </tr>
              </thead>
              <tbody>
                {predictionVsActual.length === 0 && (
                  <tr>
                    <td colSpan={5} className="ops-empty">
                      No service day has been closed against a frozen forecast yet.
                    </td>
                  </tr>
                )}
                {[...predictionVsActual].reverse().map((day) => (
                  <tr key={day.servedOn}>
                    <th scope="row">{shortDate(day.servedOn)}</th>
                    <td>{day.predictedDemand}</td>
                    <td>{day.actualServed}</td>
                    <td className={day.variance > 0 ? "positive" : day.variance < 0 ? "negative" : ""}>
                      {day.variance > 0 ? "+" : ""}
                      {day.variance}
                    </td>
                    <td>{day.accuracyPercent === null ? "—" : `${day.accuracyPercent}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="ops-table-scroll">
            <h3>Weekly waste trend</h3>
            <table className="ops-table">
              <thead>
                <tr>
                  <th scope="col">Week of</th>
                  <th scope="col">Cooked</th>
                  <th scope="col">Left over</th>
                  <th scope="col">Waste share</th>
                </tr>
              </thead>
              <tbody>
                {historicalWaste.weekly.length === 0 && (
                  <tr>
                    <td colSpan={4} className="ops-empty">
                      No close-of-service records yet.
                    </td>
                  </tr>
                )}
                {[...historicalWaste.weekly].reverse().map((week) => (
                  <tr key={week.weekStart}>
                    <th scope="row">{shortDate(week.weekStart)}</th>
                    <td>{week.cookedPortions}</td>
                    <td>{week.leftoverKg} kg</td>
                    <td>{week.wasteSharePercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <details className="forecast-breakdown">
        <summary>
          How these numbers were produced <ChevronDown size={17} />
        </summary>
        <div className="breakdown-grid">
          <span>
            <small>Headcount</small>
            <strong>{today.totalEmployees}</strong>
            <small>{today.rosterSource === "roster-file" ? "Configured roster" : today.rosterSource}</small>
          </span>
          <span>
            <small>Turnout rate</small>
            <strong>{Math.round(method.turnoutRatio * 100)}%</strong>
            <small>
              {method.turnoutMeasured
                ? `Measured from ${method.turnoutObservations} dish-days`
                : "Assumed — no service history yet"}
            </small>
          </span>
          <span>
            <small>Safety buffer</small>
            <strong>{Math.round(method.bufferRate * 1000) / 10}%</strong>
            <small>
              {method.bufferMeasured
                ? `Measured from under-prediction across ${method.bufferGradedDays} graded days`
                : "Default — not enough graded days to measure"}
            </small>
          </span>
          <span className="breakdown-total">
            <small>Recommended cook</small>
            <strong>{today.recommendedCook}</strong>
            <small>{today.predictedDemand} predicted + buffer</small>
          </span>
        </div>
        <p className="ops-fineprint">
          Portion sizes come from aggregated post-meal feedback only. A dish with fewer than {method.minimumSampleSize}{" "}
          responses falls back to its menu family, then to the cafeteria average, so no individual's answer can be
          inferred from a dish-level figure.
        </p>
      </details>
    </div>
  );
}
