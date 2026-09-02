import { useState } from "react";
import { motion } from "framer-motion";
import { Check, CircleCheck, ClipboardCheck, CookingPot, Salad, Soup, Utensils } from "lucide-react";
import { useBookings } from "../context/BookingContext";

type PrepItem = { name: string; icon: typeof CookingPot; initialProgress: number };
const prepItems: PrepItem[] = [
  { name: "Rice", icon: CookingPot, initialProgress: 70 },
  { name: "Curry", icon: Soup, initialProgress: 45 },
  { name: "Roti", icon: Utensils, initialProgress: 25 },
  { name: "Salad", icon: Salad, initialProgress: 10 },
  { name: "Dessert", icon: CircleCheck, initialProgress: 0 },
];
const dishes = [
  { label: "Veg Biryani", match: "Veg Biryani", tone: "blue" },
  { label: "Rajma Chawal", match: "Rajma Chawal", tone: "green" },
  { label: "Paneer Roti", match: "Paneer Butter Masala + Roti", tone: "violet" },
  { label: "Dal Khichdi", match: "Dal Khichdi", tone: "orange" },
];

function riskLevel(value: number) {
  return value >= 20 ? "High" : value >= 8 ? "Medium" : "Low";
}

export default function KitchenPage() {
  const { bookings } = useBookings();
  const [prepared, setPrepared] = useState<Record<string, boolean>>({});
  const lunchBookings = bookings.filter((booking) => booking.category === "Lunch");
  const preparedCount = prepItems.filter((item) => prepared[item.name]).length;
  return <div className="page-frame admin-portal-page kitchen-intelligence-page"><div className="page-intro"><div><span className="eyebrow">KITCHEN INTELLIGENCE</span><h1>Dish-wise recommendations.</h1><p>AI guidance built from live employee lunch bookings.</p></div><span className="live-pill"><i /> Live from bookings</span></div><section className="dish-recommendation-grid" aria-label="Dish-wise AI recommendations">{dishes.map(({ label, match, tone }) => { const preOrders = lunchBookings.filter((booking) => booking.item.name === match).length; const predictedDemand = preOrders + Math.round(preOrders * 0.08) - Math.round(preOrders * 0.03); const safetyBuffer = Math.round(predictedDemand * 0.04); const cookingQuantity = predictedDemand + safetyBuffer; const shortageRisk = riskLevel(Math.max(0, preOrders - cookingQuantity)); const leftoverRisk = riskLevel(cookingQuantity ? Math.round(((cookingQuantity - preOrders) / cookingQuantity) * 100) : 0); return <motion.article className={`dish-recommendation-card ${tone}`} key={label} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -4, boxShadow: "0 16px 30px rgba(0,0,0,.11)" }}><div className="dish-card-heading"><span className="dish-card-icon"><Utensils size={18} /></span><span className="dish-live">AI PLAN</span></div><h2>{label}</h2><div className="dish-metrics"><span><small>Pre-orders</small><strong>{preOrders}</strong></span><span><small>Predicted demand</small><strong>{predictedDemand}</strong></span><span><small>Recommended cooking</small><strong>{cookingQuantity}</strong></span><span><small>Safety buffer</small><strong>+{safetyBuffer}</strong></span></div><div className="risk-row"><span><small>Shortage risk</small><b className={`risk-${shortageRisk.toLowerCase()}`}>{shortageRisk}</b></span><span><small>Leftover risk</small><b className={`risk-${leftoverRisk.toLowerCase()}`}>{leftoverRisk}</b></span></div></motion.article>; })}</section><section className="kitchen-intelligence-columns"><motion.article className="surface-panel preparation-checklist" initial={{ opacity: 0, x: -12 }} animate={{ opacity: 1, x: 0 }}><div className="panel-heading"><div><span className="eyebrow">PREPARATION CHECKLIST</span><h2>Today's kitchen run</h2></div><span className="checklist-count">{preparedCount}/{prepItems.length} ready</span></div>{prepItems.map(({ name, icon: Icon, initialProgress }) => { const isPrepared = prepared[name] === true; const progress = isPrepared ? 100 : initialProgress; return <div className="prep-check-row" key={name}><span className="prep-check-icon"><Icon size={18} /></span><span className="prep-check-content"><span><strong>{name}</strong><small>{progress}% complete</small></span><i><em style={{ width: `${progress}%` }} /></i></span><button type="button" className={`prep-toggle${isPrepared ? " is-prepared" : ""}`} onClick={() => setPrepared((current) => ({ ...current, [name]: !isPrepared }))} aria-pressed={isPrepared}>{isPrepared ? <><Check size={14} /> Prepared</> : "Mark Prepared"}</button></div>; })}</motion.article><motion.aside className="kitchen-intelligence-note" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.15 }}><span className="guidance-icon"><ClipboardCheck size={22} /></span><span className="eyebrow light">SERVICE SIGNAL</span><h2>{lunchBookings.length} lunch bookings mapped.</h2><p>Each dish card separates pre-orders, predicted demand, cooking quantity, and operational risk.</p></motion.aside></section></div>;
}
