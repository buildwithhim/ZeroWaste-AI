import { useMemo } from "react";
import { motion } from "framer-motion";
import { Cloud, Droplets, Leaf, Recycle, TrendingDown } from "lucide-react";
import { CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useBookings } from "../context/BookingContext";

const chartColors = { blue: "#0f6cbd", green: "#107c41", muted: "#616161", grid: "#e6e6e6" };
const tooltipStyle = { border: "1px solid #e1e1e1", borderRadius: 12, boxShadow: "0 8px 24px rgba(0,0,0,.08)" };
const monthFactors = [{ month: "Mar", factor: 0.52 }, { month: "Apr", factor: 0.64 }, { month: "May", factor: 0.73 }, { month: "Jun", factor: 0.82 }, { month: "Jul", factor: 0.91 }, { month: "Aug", factor: 1 }];

export default function EsgImpactPage() {
  const { bookings } = useBookings();
  const lunchPreOrders = bookings.filter((booking) => booking.category === "Lunch").length;
  const prediction = lunchPreOrders + Math.round(lunchPreOrders * 0.08) - Math.round(lunchPreOrders * 0.03);
  const oldCookingQuantity = Math.round(prediction * 1.12);
  const aiCookingQuantity = prediction + Math.round(prediction * 0.04);
  const foodSaved = Math.max(0, (oldCookingQuantity - aiCookingQuantity) * 0.45);
  const mealsPreserved = foodSaved / 0.5;
  const co2Prevented = foodSaved * 2.5;
  const waterSaved = foodSaved * 1200;
  const costSaved = foodSaved * 180;
  const trendData = useMemo(() => monthFactors.map(({ month, factor }) => ({ month, meals: Math.round(mealsPreserved * factor), foodSaved: Number((foodSaved * factor).toFixed(1)) })), [foodSaved, mealsPreserved]);
  const metrics = [
    { label: "Meals Preserved", value: mealsPreserved.toFixed(1), detail: "Food saved ÷ 0.5 kg", icon: Recycle, tone: "green" },
    { label: "Food Saved", value: `${foodSaved.toFixed(1)} kg`, detail: "Old quantity less AI quantity", icon: TrendingDown, tone: "blue" },
    { label: "CO₂ Prevented", value: `${co2Prevented.toFixed(1)} kg`, detail: "Food saved × 2.5", icon: Cloud, tone: "violet" },
    { label: "Water Saved", value: `${Math.round(waterSaved).toLocaleString()} L`, detail: "Food saved × 1,200 L", icon: Droplets, tone: "cyan" },
    { label: "Kitchen Cost Saved", value: `₹${Math.round(costSaved).toLocaleString()}`, detail: "Food saved × ₹180", icon: Leaf, tone: "orange" },
  ];
  return <div className="page-frame esg-impact-page"><div className="page-intro"><div><span className="eyebrow">ESG IMPACT</span><h1>Impact that adds up.</h1><p>Live sustainability outcomes from the employee meal plan and AI-guided cooking quantity.</p></div><span className="portal-date">Based on {lunchPreOrders} lunch bookings</span></div><motion.section className="esg-metric-grid" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.08 } } }}>{metrics.map(({ label, value, detail, icon: Icon, tone }) => <motion.article className="esg-impact-card" key={label} variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }} whileHover={{ y: -4, boxShadow: "0 16px 30px rgba(0,0,0,.11)" }}><span className={`metric-icon ${tone}`}><Icon size={19} /></span><span className="metric-label">{label}</span><strong>{value}</strong><small>{detail}</small></motion.article>)}</motion.section><section className="esg-impact-summary"><span className="esg-summary-icon"><Leaf size={22} /></span><div><span className="eyebrow light">AI-OPTIMIZED SERVICE</span><h2>{foodSaved.toFixed(1)} kg of food saved.</h2><p>AI cooking quantity: <strong>{aiCookingQuantity} meals</strong> versus an estimated traditional quantity of <strong>{oldCookingQuantity} meals</strong>.</p></div><span className="esg-summary-stat"><strong>{prediction}</strong><small>predicted lunch demand</small></span></section><section className="chart-grid esg-chart-grid"><article className="chart-panel"><div className="chart-heading"><span className="chart-icon"><Recycle size={18} /></span><div><span className="eyebrow">MONTHLY MEALS</span><h2>Meals preserved over time</h2><p>Progress built from the current AI impact model.</p></div></div><ResponsiveContainer width="100%" height={245}><LineChart data={trendData}><CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} /><Line type="monotone" dataKey="meals" name="Meals preserved" stroke={chartColors.green} strokeWidth={3} dot={{ fill: "#fff", stroke: chartColors.green, strokeWidth: 2, r: 4 }} /></LineChart></ResponsiveContainer></article><article className="chart-panel"><div className="chart-heading"><span className="chart-icon"><TrendingDown size={18} /></span><div><span className="eyebrow">MONTHLY WASTE TREND</span><h2>Food saved over time</h2><p>Estimated kilograms avoided through better planning.</p></div></div><ResponsiveContainer width="100%" height={245}><LineChart data={trendData}><CartesianGrid stroke={chartColors.grid} strokeDasharray="4 4" vertical={false} /><XAxis dataKey="month" axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} /><YAxis axisLine={false} tickLine={false} tick={{ fill: chartColors.muted, fontSize: 11 }} /><Tooltip contentStyle={tooltipStyle} /><Legend iconType="circle" wrapperStyle={{ fontSize: 11 }} /><Line type="monotone" dataKey="foodSaved" name="Food saved (kg)" stroke={chartColors.blue} strokeWidth={3} dot={{ fill: "#fff", stroke: chartColors.blue, strokeWidth: 2, r: 4 }} /></LineChart></ResponsiveContainer></article></section></div>;
}
