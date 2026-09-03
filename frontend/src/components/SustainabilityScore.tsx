/**
 * The employee's personal sustainability panel.
 *
 * The habit score below is a UI construct and says so: it rates how completely
 * someone plans their week and how often their portion was right, which are
 * behaviours this screen is trying to encourage. It is not a measurement.
 *
 * The kilograms, carbon and water underneath it *are* measurements, and they
 * now come from the server. Previously this component multiplied by its own
 * copies of 2.5 kg CO2e, 1,200 L and a flat 0.45 kg per meal, none of which
 * matched the figures the ESG report used -- so the same person's impact was
 * worth different amounts depending on which page they were looking at, and a
 * fruit bowl counted as the same weight of food as a full thali.
 */

import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import { useEffect, useState } from "react";
import { Droplets, Leaf, Recycle, Sparkles, Wind } from "lucide-react";

import LoadingSkeleton from "./LoadingSkeleton";
import { ErrorState } from "./UxStates";
import { useBookings } from "../context/BookingContext";
import { getMyImpact, type PersonalImpact } from "../services/operationsService";

const WORKDAYS = 5;

export default function SustainabilityScore() {
  const { employeeId, syncedAt } = useBookings();
  const [impact, setImpact] = useState<PersonalImpact | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    let cancelled = false;
    setState("loading");
    getMyImpact(employeeId)
      .then(({ data }) => {
        if (cancelled) return;
        setImpact(data);
        setState("ready");
      })
      .catch(() => {
        if (!cancelled) setState("error");
      });
    return () => {
      cancelled = true;
    };
  // Keyed on acknowledged saves: the local plan changes before the server has
  // been told, so refetching on it would ask about a booking that had not
  // arrived yet and then never ask again.
  }, [employeeId, syncedAt]);

  const load = () => {
    setState("loading");
    getMyImpact(employeeId)
      .then(({ data }) => {
        setImpact(data);
        setState("ready");
      })
      .catch(() => setState("error"));
  };

  if (state === "loading") {
    return (
      <section className="sustainability-score" aria-busy="true">
        <LoadingSkeleton className="skeleton-heading" />
        <div className="impact-metrics">
          {[0, 1, 2].map((index) => (
            <LoadingSkeleton className="skeleton-metric" key={index} />
          ))}
        </div>
      </section>
    );
  }

  if (state === "error" || !impact) {
    return (
      <section className="sustainability-score">
        <ErrorState
          title="Impact unavailable"
          message="We could not reach the cafeteria service to work out your impact."
          onRetry={load}
        />
      </section>
    );
  }

  const planningConsistency = Math.round(Math.min(100, (impact.daysPlanned / WORKDAYS) * 100));
  const portionAccuracy = impact.finishedSharePercent;
  const lowLeftovers = impact.leftoverSharePercent === null ? null : Math.round(100 - impact.leftoverSharePercent);

  /**
   * Unrated components are left out of the score rather than counted as zero.
   * Scoring an unanswered question as a failure would punish someone for not
   * having eaten yet, and the panel would open at a discouraging number for
   * every new employee.
   */
  const parts = [
    { weight: 0.4, value: planningConsistency },
    { weight: 0.35, value: portionAccuracy },
    { weight: 0.25, value: lowLeftovers },
  ].filter((part): part is { weight: number; value: number } => part.value !== null);
  const totalWeight = parts.reduce((sum, part) => sum + part.weight, 0);
  const score = totalWeight ? Math.round(parts.reduce((sum, part) => sum + part.value * part.weight, 0) / totalWeight) : 0;

  const inputs = [
    { label: "Weekly planning", value: planningConsistency, detail: `${impact.daysPlanned} of ${WORKDAYS} days booked this week` },
    {
      label: "Portion accuracy",
      value: portionAccuracy,
      detail: impact.ratedMeals ? `${impact.finishedMeals} of ${impact.ratedMeals} meals finished` : "No ratings yet",
    },
    {
      label: "Low leftovers",
      value: lowLeftovers,
      detail: impact.leftoverSharePercent === null ? "No ratings yet" : `${impact.leftoverSharePercent}% left on the plate`,
    },
  ];

  return (
    <motion.section
      className="sustainability-score"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      aria-labelledby="sustainability-score-title"
    >
      <div className="score-heading">
        <div>
          <span className="eyebrow">PERSONAL IMPACT</span>
          <h2 id="sustainability-score-title">Sustainability score</h2>
          <p>Your weekly planning, portion feedback and leftovers in one view. Only you can see this.</p>
        </div>
        <span className="green-plate-badge">
          <Leaf size={16} /> Green Plate
        </span>
      </div>

      <div className="score-overview">
        <div className="score-ring" style={{ "--score-progress": `${score * 3.6}deg` } as CSSProperties}>
          <div>
            <strong>{score}</strong>
            <small>/ 100</small>
          </div>
        </div>
        <div className="score-message">
          <span className="score-spark">
            <Sparkles size={16} /> Personal score
          </span>
          <h3>
            {score >= 80 ? "Excellent plate habits." : score >= 60 ? "A thoughtful plate in progress." : "Start building your green plate."}
          </h3>
          <p>
            {impact.ratedMeals === 0
              ? "Rate a lunch after you have eaten it and this score will start reflecting your portions too."
              : "Keep planning ahead and rating your meals to improve your score."}
          </p>
        </div>
      </div>

      <div className="score-inputs">
        {inputs.map((input) => (
          <div key={input.label}>
            <span>
              <strong>{input.label}</strong>
              <small>{input.detail}</small>
            </span>
            <b>{input.value === null ? "—" : `${input.value}%`}</b>
            <i>
              <em style={{ width: `${input.value ?? 0}%` }} />
            </i>
          </div>
        ))}
      </div>

      <div className="impact-metrics">
        <article>
          <span>
            <Recycle size={17} />
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

      <p className="impact-basis">{impact.basis.explanation}</p>
      <p className="impact-basis">{impact.factors.basis}</p>
    </motion.section>
  );
}
