/**
 * Performance analytics.
 *
 * Every series on this page used to be a hardcoded literal — a waste curve that
 * always fell, a popularity ranking of menus the cafeteria does not serve, and
 * a "predicted vs actual" chart whose actuals were invented. They looked like
 * evidence while being decoration.
 *
 * All four now come from GET /admin/operations/accuracy, which is built from
 * forecasts frozen before service and actuals recorded after it. Where there is
 * no history yet, the chart says so rather than drawing a shape.
 */

import { useEffect, useState } from "react";
import { AlertTriangle, BarChart3, TrendingDown, TrendingUp } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import FeedbackAnalyticsPanel from "../components/FeedbackAnalyticsPanel";
import { getAccuracyReport, type AccuracyReport } from "../services/operationsService";

const chartConfig = { grid: "#e6e6e6", muted: "#616161", blue: "#0f6cbd", green: "#107c41" };
const tooltipStyle = { border: "1px solid #e1e1e1", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)" };
const axisTick = { fill: chartConfig.muted, fontSize: 11 };

const shortDate = (iso: string) =>
  new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export default function AnalyticsPage() {
  const [report, setReport] = useState<AccuracyReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    getAccuracyReport(30)
      .then(({ data }) => live && setReport(data))
      .catch((cause) => {
        if (!live) return;
        setError(cause?.response?.data?.error ?? "Could not load measured performance from the operations service.");
      });
    return () => {
      live = false;
    };
  }, []);

  if (error) {
    return (
      <div className="page-frame analytics-page">
        <div className="ops-error" role="alert">
          <AlertTriangle size={18} />
          <p>{error}</p>
        </div>
      </div>
    );
  }

  if (!report) {
    return (
      <div className="page-frame analytics-page">
        <p className="ops-status">Loading measured performance…</p>
      </div>
    );
  }

  const { forecastAccuracy, historicalWaste, predictionVsActual, dishPerformance } = report;

  const dailyWaste = historicalWaste.daily.map((day) => ({ day: shortDate(day.servedOn), waste: day.leftoverKg }));
  const dishOrders = dishPerformance.slice(0, 6).map((dish) => ({ menu: dish.dish, orders: dish.servedPortions }));
  const accuracySeries = predictionVsActual.map((day) => ({
    day: shortDate(day.servedOn),
    actual: day.actualServed,
    predicted: day.predictedDemand,
  }));
  const weeklyTrend = historicalWaste.weekly.map((week) => ({ week: shortDate(week.weekStart), waste: week.leftoverKg }));

  return (
    <div className="page-frame analytics-page">
      <div className="page-intro">
        <div>
          <span className="eyebrow">ANALYTICS</span>
          <h1>Performance intelligence.</h1>
          <p>Measured from {historicalWaste.daysRecorded} closed service days. No projected or illustrative figures.</p>
        </div>
        <span className="analytics-score">
          {forecastAccuracy.accuracyPercent === null ? (
            <>
              <strong>—</strong>
              <small>{forecastAccuracy.reason}</small>
            </>
          ) : (
            <>
              <strong>{forecastAccuracy.accuracyPercent}%</strong>
              <small>forecast accuracy · {forecastAccuracy.gradedDays} graded days</small>
            </>
          )}
        </span>
      </div>

      <FeedbackAnalyticsPanel />

      <section className="chart-grid">
        <ChartPanel
          icon={TrendingDown}
          eyebrow="DAILY FOOD WASTE"
          title="Waste by service day"
          detail="Kilograms cooked but not served, from close-of-service records."
          empty={dailyWaste.length === 0}
        >
          <ResponsiveContainer width="100%" height={245}>
            <BarChart data={dailyWaste}>
              <CartesianGrid stroke={chartConfig.grid} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={axisTick} />
              <YAxis axisLine={false} tickLine={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="waste" name="Waste (kg)" fill={chartConfig.blue} radius={[5, 5, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          icon={BarChart3}
          eyebrow="DISH POPULARITY"
          title="Most eaten dishes"
          detail="Portions actually served, not portions booked."
          empty={dishOrders.length === 0}
        >
          <ResponsiveContainer width="100%" height={245}>
            <BarChart data={dishOrders} layout="vertical" margin={{ left: 12, right: 12 }}>
              <CartesianGrid stroke={chartConfig.grid} strokeDasharray="4 4" horizontal={false} />
              <XAxis type="number" axisLine={false} tickLine={false} tick={axisTick} />
              <YAxis dataKey="menu" type="category" width={110} axisLine={false} tickLine={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Bar dataKey="orders" name="Portions served" fill={chartConfig.green} radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          icon={TrendingUp}
          eyebrow="PREDICTED VS ACTUAL"
          title="Forecast accuracy"
          detail="Forecasts frozen before service, against what was served."
          empty={accuracySeries.length === 0}
        >
          <ResponsiveContainer width="100%" height={245}>
            <LineChart data={accuracySeries}>
              <CartesianGrid stroke={chartConfig.grid} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="day" axisLine={false} tickLine={false} tick={axisTick} />
              <YAxis axisLine={false} tickLine={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} />
              <Line type="monotone" dataKey="actual" name="Actual" stroke={chartConfig.green} strokeWidth={2.5} dot={false} />
              <Line type="monotone" dataKey="predicted" name="Predicted" stroke={chartConfig.blue} strokeWidth={2.5} dot={false} />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>

        <ChartPanel
          icon={TrendingDown}
          eyebrow="WASTE TREND"
          title="Weekly waste"
          detail="Leftover kilograms per week of service."
          empty={weeklyTrend.length === 0}
        >
          <ResponsiveContainer width="100%" height={245}>
            <LineChart data={weeklyTrend}>
              <CartesianGrid stroke={chartConfig.grid} strokeDasharray="4 4" vertical={false} />
              <XAxis dataKey="week" axisLine={false} tickLine={false} tick={axisTick} />
              <YAxis axisLine={false} tickLine={false} tick={axisTick} />
              <Tooltip contentStyle={tooltipStyle} />
              <Line
                type="monotone"
                dataKey="waste"
                name="Waste (kg)"
                stroke={chartConfig.blue}
                strokeWidth={3}
                dot={{ fill: "#fff", stroke: chartConfig.blue, strokeWidth: 2, r: 4 }}
              />
            </LineChart>
          </ResponsiveContainer>
        </ChartPanel>
      </section>
    </div>
  );
}

function ChartPanel({
  icon: Icon,
  eyebrow,
  title,
  detail,
  empty,
  children,
}: {
  icon: typeof TrendingDown;
  eyebrow: string;
  title: string;
  detail: string;
  empty?: boolean;
  children: React.ReactNode;
}) {
  return (
    <article className="chart-panel">
      <div className="chart-heading">
        <span className="chart-icon">
          <Icon size={18} />
        </span>
        <div>
          <span className="eyebrow">{eyebrow}</span>
          <h2>{title}</h2>
          <p>{detail}</p>
        </div>
      </div>
      {empty ? <p className="ops-status">No service history recorded yet.</p> : children}
    </article>
  );
}
