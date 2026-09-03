import { useEffect, useState } from "react";
import { AlertTriangle, Award, Loader2, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { getFeedbackAnalytics, type FeedbackAnalytics } from "../services/feedbackService";

const chartColors = { blue: "#0f6cbd", green: "#107c41", amber: "#c07800", red: "#b3261e", muted: "#616161", grid: "#e6e6e6" };
const tooltipStyle = { border: "1px solid #e1e1e1", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)" };
const responseColors: Record<string, string> = {
  Finished: chartColors.green,
  "Left some": chartColors.amber,
  "Left most": chartColors.red,
  "Wanted more": chartColors.blue,
};

const formatWeek = (weekStart: string) =>
  new Date(`${weekStart}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function FeedbackAnalyticsPanel() {
  const [analytics, setAnalytics] = useState<FeedbackAnalytics | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");

  useEffect(() => {
    getFeedbackAnalytics()
      .then(({ data }) => {
        setAnalytics(data);
        setStatus("ready");
      })
      .catch(() => setStatus("error"));
  }, []);

  if (status === "loading") {
    return (
      <section className="feedback-analytics is-loading">
        <Loader2 size={18} className="spin" /> <span>Aggregating meal feedback…</span>
      </section>
    );
  }

  if (status === "error" || !analytics) {
    return (
      <section className="feedback-analytics is-empty">
        <AlertTriangle size={18} />
        <div>
          <strong>Feedback analytics unavailable</strong>
          <small>Start the backend to load aggregated portion feedback.</small>
        </div>
      </section>
    );
  }

  if (analytics.totals.responses === 0) {
    return (
      <section className="feedback-analytics is-empty">
        <ShieldCheck size={18} />
        <div>
          <strong>No feedback yet</strong>
          <small>Portion analytics appear once employees start rating their meals.</small>
        </div>
      </section>
    );
  }

  const distribution = Object.entries(analytics.portionSatisfaction.distribution).map(([label, value]) => ({ label, value }));
  const trend = analytics.weeklyWasteTrend.map((point) => ({ ...point, week: formatWeek(point.weekStart) }));
  const delta = analytics.weeklyTrendDeltaPoints;
  const multiplierChange = Math.round((analytics.learningSignal.globalPortionMultiplier - 1) * 100);

  return (
    <section className="feedback-analytics">
      <div className="feedback-analytics-heading">
        <div>
          <span className="eyebrow">CLOSED-LOOP FEEDBACK</span>
          <h2>Portion intelligence</h2>
          <p>Aggregated from optional post-meal responses across the cafeteria.</p>
        </div>
        <span className="feedback-sample">
          <ShieldCheck size={13} /> {analytics.totals.responses} anonymous responses
        </span>
      </div>

      <p className="feedback-privacy-banner">
        <ShieldCheck size={14} /> {analytics.privacy.note} Dishes with fewer than {analytics.privacy.minimumSampleSize} responses are
        hidden{analytics.privacy.suppressedDishes > 0 ? ` (${analytics.privacy.suppressedDishes} currently hidden)` : ""}.
      </p>

      <div className="feedback-kpis">
        <article>
          <strong>{analytics.portionSatisfaction.score}%</strong>
          <span>Portion satisfaction</span>
          <small>Finished their meal</small>
        </article>
        <article>
          <strong>{analytics.averageLeftoverRate}%</strong>
          <span>Average leftover rate</span>
          <small className={delta <= 0 ? "trend-good" : "trend-bad"}>
            {delta <= 0 ? <TrendingDown size={12} /> : <TrendingUp size={12} />} {Math.abs(delta)} pts week over week
          </small>
        </article>
        <article>
          <strong>{analytics.portionSatisfaction.wantedMoreRate}%</strong>
          <span>Wanted more</span>
          <small>Under-portioned meals</small>
        </article>
        <article>
          <strong>
            {multiplierChange > 0 ? "+" : ""}
            {multiplierChange}%
          </strong>
          <span>Learned portion change</span>
          <small>Applied to the next forecast</small>
        </article>
      </div>

      <div className="feedback-grid">
        <article className="feedback-chart">
          <h3>Response mix</h3>
          <ResponsiveContainer width="100%" height={190}>
            <BarChart data={distribution} barCategoryGap="28%">
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} />
              <YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="value" name="Responses" radius={[5, 5, 0, 0]}>
                {distribution.map((item) => (
                  <Cell key={item.label} fill={responseColors[item.label] ?? chartColors.blue} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </article>

        <article className="feedback-chart">
          <h3>Weekly waste trend</h3>
          <ResponsiveContainer width="100%" height={190}>
            <LineChart data={trend}>
              <CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="week" axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} unit="%" />
              <Tooltip contentStyle={tooltipStyle} formatter={(value) => [`${value}%`, "Leftover rate"]} />
              <Line
                type="monotone"
                dataKey="averageLeftoverRate"
                name="Leftover rate"
                stroke={chartColors.blue}
                strokeWidth={3}
                dot={{ fill: "#fff", stroke: chartColors.blue, strokeWidth: 2, r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </article>
      </div>

      <div className="feedback-grid">
        <article className="dish-ranking wasteful">
          <h3>
            <AlertTriangle size={15} /> Most wasteful dishes
          </h3>
          <ul>
            {analytics.mostWastefulDishes.map((dish) => (
              <li key={dish.dish}>
                <span className="dish-ranking-name">{dish.dish}</span>
                <span className="dish-ranking-meta">
                  <b>{dish.averageLeftoverRate}%</b> leftover · {dish.estimatedWasteKg} kg · portion {dish.recommendedPortionChange}%
                </span>
              </li>
            ))}
          </ul>
        </article>

        <article className="dish-ranking best">
          <h3>
            <Award size={15} /> Best performing dishes
          </h3>
          <ul>
            {analytics.bestPerformingDishes.map((dish) => (
              <li key={dish.dish}>
                <span className="dish-ranking-name">{dish.dish}</span>
                <span className="dish-ranking-meta">
                  <b>{dish.portionSatisfaction}%</b> satisfied · {dish.averageLeftoverRate}% leftover
                </span>
              </li>
            ))}
          </ul>
        </article>
      </div>
    </section>
  );
}
