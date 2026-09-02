import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useBookings } from "../context/BookingContext";
import { useFeedback } from "../context/FeedbackContext";

const leftoverByResponse = { "Finished meal": 0, "Left some food": 35, "Still hungry": 0 } as const;
const chartColors = { blue: "#0f6cbd", green: "#107c41", muted: "#616161", grid: "#e6e6e6" };

export default function FeedbackAnalyticsPanel() {
  const { bookings } = useBookings();
  const { feedback } = useFeedback();
  const lunchBookingIds = new Set(bookings.filter((booking) => booking.category === "Lunch").map((booking) => booking.id));
  const lunchFeedback = feedback.filter((item) => lunchBookingIds.has(item.bookingId));
  const finishedCount = lunchFeedback.filter((item) => item.response === "Finished meal").length;
  const satisfaction = lunchFeedback.length ? Math.round((finishedCount / lunchFeedback.length) * 100) : 0;
  const averageLeftovers = lunchFeedback.length ? Math.round(lunchFeedback.reduce((total, item) => total + leftoverByResponse[item.response], 0) / lunchFeedback.length) : 0;
  const wastedDishCounts = lunchFeedback.filter((item) => item.response === "Left some food").reduce<Record<string, number>>((counts, item) => ({ ...counts, [item.dish]: (counts[item.dish] || 0) + 1 }), {});
  const mostWastedDish = Object.entries(wastedDishCounts).sort(([, first], [, second]) => second - first)[0]?.[0] || "No dish reported yet";
  const chartData = [{ label: "Finished", value: finishedCount }, { label: "Left some", value: lunchFeedback.filter((item) => item.response === "Left some food").length }, { label: "Hungry", value: lunchFeedback.filter((item) => item.response === "Still hungry").length }];

  return <section className="feedback-analytics"><div className="feedback-analytics-heading"><div><span className="eyebrow">MEAL FEEDBACK</span><h2>Portion satisfaction</h2><p>Insights from employee lunch feedback.</p></div><span className="feedback-sample">{lunchFeedback.length} responses</span></div><div className="feedback-kpis"><article><strong>{satisfaction}%</strong><span>Portion satisfaction</span><small>Finished meal responses</small></article><article><strong>{averageLeftovers}%</strong><span>Average leftovers</span><small>Estimated per lunch</small></article><article><strong>{mostWastedDish}</strong><span>Most wasted dish</span><small>Most “left some food” responses</small></article></div><div className="feedback-chart"><ResponsiveContainer width="100%" height={190}><BarChart data={chartData} barCategoryGap="28%"><CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} /><XAxis dataKey="label" axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} /><YAxis allowDecimals={false} axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} /><Tooltip /><Bar dataKey="value" name="Responses" fill={chartColors.blue} radius={[5, 5, 0, 0]} /></BarChart></ResponsiveContainer></div></section>;
}
