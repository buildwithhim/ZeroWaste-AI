import { motion } from "framer-motion";
import { ChefHat, ChevronDown, Gauge, TrendingDown, Users, Utensils } from "lucide-react";
import CountUp from "../components/CountUp";
import { useBookings } from "../context/BookingContext";

export default function AdminOverviewPage() {
  const { bookings } = useBookings();
  const lunchPreOrders = bookings.filter((booking) => booking.category === "Lunch").length;
  const breakfastBookings = bookings.filter((booking) => booking.category === "Breakfast").length;
  const snackBookings = bookings.filter((booking) => booking.category === "Snacks").length;
  const expectedWalkIns = Math.round(lunchPreOrders * 0.08);
  const historicalCancellations = Math.round(lunchPreOrders * 0.03);
  const predictedLunchDemand = lunchPreOrders + expectedWalkIns - historicalCancellations;
  const metrics = [
    { label: "Total Employees", value: 400, detail: "Active cafeteria population", icon: Users, tone: "blue" },
    { label: "Lunch Pre-orders", value: lunchPreOrders, detail: "Booked lunch meals", icon: Utensils, tone: "violet" },
    { label: "Breakfast Bookings", value: breakfastBookings, detail: "Booked breakfast meals", icon: Gauge, tone: "green" },
    { label: "Snack Bookings", value: snackBookings, detail: "Booked snack meals", icon: TrendingDown, tone: "orange" },
  ];

  return <div className="page-frame admin-portal-page"><div className="page-intro"><div><span className="eyebrow">OVERVIEW</span><h1>Operations at a glance.</h1><p>Live meal bookings from the employee weekly planner.</p></div><span className="portal-date">Friday, 22 August 2026</span></div><motion.section className="metric-grid" aria-label="Live booking metrics" initial="hidden" animate="visible" variants={{ visible: { transition: { staggerChildren: 0.08 } } }}>{metrics.map(({ label, value, detail, icon: Icon, tone }) => <motion.article className="metric-card" key={label} variants={{ hidden: { opacity: 0, y: 12 }, visible: { opacity: 1, y: 0 } }} whileHover={{ y: -4, boxShadow: "0 16px 30px rgba(0,0,0,.11)" }}><span className={`metric-icon ${tone}`}><Icon size={19} /></span><span className="metric-label">{label}</span><strong><CountUp value={value} /></strong><small>{detail}</small></motion.article>)}</motion.section><motion.section className="overview-callout" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}><span className="callout-mark"><ChefHat size={22} /></span><div><span className="eyebrow light">PREDICTED LUNCH DEMAND</span><h2><CountUp value={predictedLunchDemand} /> meals expected.</h2><p>{lunchPreOrders} lunch pre-orders are the baseline, adjusted for normal walk-ins and historical cancellations.</p></div></motion.section><details className="forecast-breakdown"><summary>How AI calculated this forecast <ChevronDown size={17} /></summary><div className="breakdown-grid"><span><small>Lunch pre-orders</small><strong>{lunchPreOrders}</strong></span><span className="positive"><small>Expected walk-ins · 8%</small><strong>+{expectedWalkIns}</strong></span><span className="negative"><small>Historical cancellations · 3%</small><strong>-{historicalCancellations}</strong></span><span className="breakdown-total"><small>Predicted lunch demand</small><strong>{predictedLunchDemand}</strong></span></div></details></div>;
}
