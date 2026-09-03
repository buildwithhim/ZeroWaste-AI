/**
 * ESG impact.
 *
 * This page previously derived every figure from the bookings held in the
 * signed-in admin's own browser, applied hardcoded walk-in and cancellation
 * rates, invented a "traditional" cooking quantity 12% higher than the plan so
 * a saving always existed, and drew a six-month improvement curve by
 * multiplying today's number by fixed factors ending at 1.0 — which guaranteed
 * an upward trend regardless of performance.
 *
 * It now reads GET /admin/operations/esg. Kilograms come from close-of-service
 * records and the feedback-attributable saving; the conversion factors are
 * declared server-side with their sources. The saving and the remaining waste
 * are shown separately, because presenting logged leftovers as an achievement
 * would overstate the result several times over.
 */

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { AlertTriangle, Cloud, Droplets, Leaf, Recycle, TrendingDown } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getEsgReport, type EsgReport } from "../services/operationsService";

const chartColors = { blue: "#0f6cbd", green: "#107c41", muted: "#616161", grid: "#e6e6e6" };
const tooltipStyle = { border: "1px solid #e1e1e1", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)" };
const axisTick = { fill: chartColors.muted, fontSize: 11 };

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default function EsgImpactPage() {
  const [report, setReport] = useState<EsgReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getEsgReport()
      .then(({ data }) => live && setReport(data))
      .catch((cause) => {
        if (!live) return;
        setError(cause?.response?.data?.error ?? "Could not load measured impact from the operations service.");
      });
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <div className="page-frame esg-impact-page">
        <div className="ops-error" role="alert">
          <AlertTriangle size={18} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="page-frame esg-impact-page">
        <p className="ops-status">Loading measured impact…</p>
      </div>
    );
  }

  const { attributable, stillWasted, weeklyTrend, factors } = report;

  const metrics = [
    {
      label: "Meals Preserved",
      value: attributable.mealsPreserved.toLocaleString(),
      detail: `Food saved ÷ ${factors.mealKg} kg per meal`,
      icon: Recycle,
      tone: "green",
    },
    {
      label: "Food Saved",
      value: `${attributable.foodKg} kg`,
      detail: `Measured over ${attributable.daysCovered} service days`,
      icon: TrendingDown,
      tone: "blue",
    },
    {
      label: "CO₂e Prevented",
      value: `${attributable.co2ePreventedKg} kg`,
      detail: `Food saved × ${factors.co2eKgPerKg}`,
      icon: Cloud,
      tone: "violet",
    },
    {
      label: "Water Saved",
      value: `${attributable.waterSavedLitres.toLocaleString()} L`,
      detail: `Food saved × ${factors.waterLitresPerKg.toLocaleString()} L`,
      icon: Droplets,
      tone: "cyan",
    },
    {
      label: "Kitchen Cost Saved",
      value: `₹${attributable.costSavedInr.toLocaleString()}`,
      detail: `Food saved × ₹${factors.costInrPerKg}`,
      icon: Leaf,
      tone: "orange",
    },
  ];

  return (
    <div className="page-frame esg-impact-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">ESG IMPACT</span>
          <h1>Impact that adds up.</h1>
          <p>Measured from close-of-service records, not projected from a target.</p>
        </div>
        <span className="portal-date">Across {attributable.daysCovered} service days</span>
      </div>

      <motion.section
        className="esg-metric-grid"
        initial="hidden"
        animate="visible"
        variants={{ visible: { transition: { staggerChildren: 0.08 } } }}
      >
        {metrics.map(({ label, value, detail, icon: Icon, tone }) => (
          <motion.article
            className="esg-impact-card"
            key={label}
            variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }}
            whileHover={{ y: -4, boxShadow: "0 16px 30px rgba(0,0,0,.11)" }}
          >
            <span className={`metric-icon ${tone}`}>
              <Icon size={19} />
            </span>
            <span className="metric-label">{label}</span>
            <strong>{value}</strong>
            <small>{detail}</small>
          </motion.article>
        ))}
      </motion.section>

      <section className="esg-impact-summary">
        <span className="esg-summary-icon">
          <Leaf size={22} />
        </span>
        <div>
          <span className="eyebrow light">WHAT THIS COUNTS</span>
          <h2>{attributable.foodKg} kg of food saved.</h2>
          <p>{attributable.basis}</p>
        </div>
        <span className="esg-summary-stat">
          <strong>{stillWasted.foodKg} kg</strong>
          <small>still thrown away — the remaining problem</small>
        </span>
      </section>

      <section className="chart-grid esg-chart-grid">
        <article className="chart-panel">
          <div className="chart-heading">
            <span className="chart-icon">
              <TrendingDown size={18} />
            </span>
            <div>
              <span className="eyebrow">WEEKLY WASTE</span>
              <h2>Food wasted per week</h2>
              <p>Kilograms cooked but not served, from close-of-service records.</p>
            </div>
          </div>
          {weeklyTrend.length === 0 ? (
            <p className="ops-status">No service history recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={245}>
              <LineChart data={weeklyTrend.map((week) => ({ ...week, week: shortDate(week.weekStart) }))}>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="week" axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="leftoverKg"
                  name="Waste (kg)"
                  stroke={chartColors.blue}
                  strokeWidth={3}
                  dot={{ fill: "#fff", stroke: chartColors.blue, strokeWidth: 2, r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </article>

        <article className="chart-panel">
          <div className="chart-heading">
            <span className="chart-icon">
              <Cloud size={18} />
            </span>
            <div>
              <span className="eyebrow">CARBON OF WASTE</span>
              <h2>CO₂e still being emitted</h2>
              <p>The carbon embodied in the food thrown away each week.</p>
            </div>
          </div>
          {weeklyTrend.length === 0 ? (
            <p className="ops-status">No service history recorded yet.</p>
          ) : (
            <ResponsiveContainer width="100%" height={245}>
              <LineChart data={weeklyTrend.map((week) => ({ ...week, week: shortDate(week.weekStart) }))}>
                <CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} />
                <XAxis dataKey="week" axisLine={false} tickLine={false} tick={axisTick} />
                <YAxis axisLine={false} tickLine={false} tick={axisTick} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line
                  type="monotone"
                  dataKey="co2eKg"
                  name="CO₂e (kg)"
                  stroke={chartColors.green}
                  strokeWidth={3}
                  dot={{ fill: "#fff", stroke: chartColors.green, strokeWidth: 2, r: 4 }}
                />
              </LineChart>
            </ResponsiveContainer>
          )}
        </article>
      </section>

      <p className="ops-fineprint">{factors.basis}</p>
    </div>
  );
}
