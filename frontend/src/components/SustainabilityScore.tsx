import { motion } from "framer-motion";
import type { CSSProperties } from "react";
import { Droplets, Leaf, Recycle, Sparkles, Wind } from "lucide-react";
import { useBookings } from "../context/BookingContext";
import { useFeedback, LEFTOVER_RATE } from "../context/FeedbackContext";

export default function SustainabilityScore() {
  const { bookings } = useBookings();
  const { feedback } = useFeedback();
  const feedbackByBooking = new Map(feedback.map((item) => [item.bookingId, item]));
  const lunchBookings = bookings.filter((booking) => booking.category === "Lunch");
  const answeredFeedback = lunchBookings.map((booking) => feedbackByBooking.get(booking.id)).filter((item) => item !== undefined);
  const finishedMeals = answeredFeedback.filter((item) => item.response === "Finished").length;
  // "Left most" wastes more than "Left some", so weight rather than count.
  const wastedPortions = answeredFeedback.reduce((total, item) => total + LEFTOVER_RATE[item.response], 0);
  const planningConsistency = Math.round(Math.min(100, (new Set(bookings.map((booking) => booking.day)).size / 5) * 100));
  const portionFeedback = answeredFeedback.length ? Math.round((finishedMeals / answeredFeedback.length) * 100) : 0;
  const leftoverFrequency = answeredFeedback.length ? Math.round((wastedPortions / answeredFeedback.length) * 100) : 0;
  const score = Math.round(planningConsistency * 0.4 + portionFeedback * 0.35 + (100 - leftoverFrequency) * 0.25);
  const mealsSaved = Math.max(0, Math.round(bookings.length - wastedPortions));
  const foodSavedKg = mealsSaved * 0.45;
  const co2Saved = foodSavedKg * 2.5;
  const waterSaved = foodSavedKg * 1200;
  const inputs = [{ label: "Weekly planning", value: planningConsistency, detail: `${new Set(bookings.map((booking) => booking.day)).size} of 5 workdays` }, { label: "Portion feedback", value: portionFeedback, detail: answeredFeedback.length ? `${finishedMeals} finished meals` : "No feedback yet" }, { label: "Low leftover frequency", value: 100 - leftoverFrequency, detail: answeredFeedback.length ? `${leftoverFrequency}% average leftovers` : "No feedback yet" }];

  return <motion.section className="sustainability-score" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} aria-labelledby="sustainability-score-title"><div className="score-heading"><div><span className="eyebrow">PERSONAL IMPACT</span><h2 id="sustainability-score-title">Sustainability Score</h2><p>Your weekly planning habits, portion feedback, and leftover choices in one view.</p></div><span className="green-plate-badge"><Leaf size={16} /> Green Plate</span></div><div className="score-overview"><div className="score-ring" style={{ "--score-progress": `${score * 3.6}deg` } as CSSProperties}><div><strong>{score}</strong><small>/ 100</small></div></div><div className="score-message"><span className="score-spark"><Sparkles size={16} /> Personal score</span><h3>{score >= 80 ? "Excellent plate habits." : score >= 60 ? "A thoughtful plate in progress." : "Start building your green plate."}</h3><p>Keep planning ahead and share portion feedback after lunch to improve your score.</p></div></div><div className="score-inputs">{inputs.map((input) => <div key={input.label}><span><strong>{input.label}</strong><small>{input.detail}</small></span><b>{input.value}%</b><i><em style={{ width: `${input.value}%` }} /></i></div>)}</div><div className="impact-metrics"><article><span><Recycle size={17} /></span><strong>{mealsSaved}</strong><small>Meals saved</small></article><article><span><Wind size={17} /></span><strong>{co2Saved.toFixed(1)} kg</strong><small>CO₂ saved</small></article><article><span><Droplets size={17} /></span><strong>{Math.round(waterSaved).toLocaleString()} L</strong><small>Water saved</small></article></div></motion.section>;
}
