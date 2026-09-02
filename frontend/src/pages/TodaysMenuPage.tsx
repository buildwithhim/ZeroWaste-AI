import { Check, ChevronRight, LockKeyhole, Save, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { useBookings, type Appetite, type MealCategory, type Weekday } from "../context/BookingContext";
import WeeklyMealCard from "../components/WeeklyMealCard";
import type { MenuItem } from "../components/MenuCard";
import SmartPlate from "../components/SmartPlate";

const image = (id: string) => `https://images.unsplash.com/${id}?auto=format&fit=crop&w=900&q=85`;
const weekdays: Weekday[] = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];
const categories: MealCategory[] = ["Breakfast", "Lunch", "Snacks"];
const menuItems: MenuItem[] = [
  { id: 1, name: "Idli Sambar", category: "Breakfast", description: "Steamed rice cakes with lentil sambar and coconut chutney.", calories: 290, protein: 9, price: 55, isVeg: true, image: image("photo-1630383249896-424e482df921") },
  { id: 2, name: "Masala Dosa", category: "Breakfast", description: "Crisp dosa with spiced potato, sambar and chutney.", calories: 410, protein: 10, price: 75, isVeg: true, image: image("photo-1668236543090-82eba5ee5976") },
  { id: 3, name: "Poha", category: "Breakfast", description: "Yellow poha with peanuts, curry leaves and lemon.", calories: 270, protein: 7, price: 45, isVeg: true, image: image("photo-1601050690117-94f5f6fa8bd7") },
  { id: 4, name: "Upma", category: "Breakfast", description: "Vegetable upma with tempered spices and coriander.", calories: 260, protein: 6, price: 45, isVeg: true, image: image("photo-1547592180-85f173990554") },
  { id: 5, name: "Veg Biryani", category: "Lunch", description: "Fragrant basmati rice with vegetables and raita.", calories: 520, protein: 13, price: 125, isVeg: true, image: image("photo-1563379091339-03246963d51a") },
  { id: 6, name: "Rajma Chawal", category: "Lunch", description: "Slow-cooked rajma with steamed rice and salad.", calories: 480, protein: 17, price: 110, isVeg: true, image: image("photo-1546833999-b9f581a1996d") },
  { id: 7, name: "Paneer Butter Masala + Roti", category: "Lunch", description: "Paneer in tomato gravy with two whole-wheat rotis.", calories: 560, protein: 21, price: 135, isVeg: true, image: image("photo-1631452180519-c014fe946bc7") },
  { id: 8, name: "Dal Khichdi", category: "Lunch", description: "Comforting rice and lentils with pickle and papad.", calories: 390, protein: 15, price: 95, isVeg: true, image: image("photo-1601050690597-df0568f70950") },
  { id: 9, name: "South Indian Thali", category: "Lunch", description: "Rice, sambar, rasam, vegetables and papad.", calories: 610, protein: 19, price: 150, isVeg: true, image: image("photo-1630383249896-424e482df921") },
  { id: 10, name: "Fruit Bowl", category: "Snacks", description: "Fresh seasonal fruit finished with lime.", calories: 160, protein: 3, price: 65, isVeg: true, image: image("photo-1490474418585-ba9bad8fd0ea") },
  { id: 11, name: "Sprouts Chaat", category: "Snacks", description: "Moong sprouts with onion, tomato and chaat masala.", calories: 190, protein: 11, price: 60, isVeg: true, image: image("photo-1540420773420-3366772f4999") },
  { id: 12, name: "Dhokla", category: "Snacks", description: "Yellow steamed dhokla with green chutney.", calories: 210, protein: 8, price: 50, isVeg: true, image: image("photo-1601050690597-df0568f70950") },
  { id: 13, name: "Samosa", category: "Snacks", description: "Two crisp samosas with mint chutney.", calories: 280, protein: 5, price: 35, isVeg: true, image: image("photo-1601050690117-94f5f6fa8bd7") },
];

export default function TodaysMenuPage() {
  const { bookings, appetitePreference, setAppetitePreference, selectMeal, saveWeeklyPlan, planSaved } = useBookings();
  const [selectedDay, setSelectedDay] = useState<Weekday>("Monday");
  const [smartPlateItem, setSmartPlateItem] = useState<MenuItem | null>(null);
  const [smartPlateAppetite, setSmartPlateAppetite] = useState<Appetite>(appetitePreference);
  const mealsForCategory = (category: MealCategory) => menuItems.filter((item) => item.category === category);
  const dayBookings = useMemo(() => bookings.filter((booking) => booking.day === selectedDay), [bookings, selectedDay]);
  const completedCount = bookings.length;

  return <div className="page-frame menu-page"><div className="page-intro"><div><span className="eyebrow">WEEKLY MEAL PLAN · REDMOND CAFETERIA</span><h1>Weekly Meal Planner</h1><p>Choose one breakfast, lunch and snack for each workday. Weekends are closed.</p></div><button type="button" className="primary-button" onClick={saveWeeklyPlan}><Save size={16} /> Save Weekly Plan</button></div><div className="week-strip" aria-label="Choose a weekday">{weekdays.map((day) => <button type="button" className={selectedDay === day ? "selected" : ""} onClick={() => setSelectedDay(day)} key={day}><span>{day.slice(0, 3)}</span><small>{bookings.filter((booking) => booking.day === day).length}/3 selected</small></button>)}<button type="button" className="disabled-day" disabled><LockKeyhole size={15} /><span>Sat</span><small>Office Closed</small></button><button type="button" className="disabled-day" disabled><LockKeyhole size={15} /><span>Sun</span><small>Office Closed</small></button></div><div className="plan-progress"><span><strong>{completedCount} of 15 meals selected</strong><small>{planSaved ? "Weekly plan saved" : "Select one meal in each category"}</small></span><i><em style={{ width: `${(completedCount / 15) * 100}%` }} /></i></div><div className="schedule-heading"><div><span className="eyebrow">{selectedDay.toUpperCase()}</span><h2>Choose your cafeteria meals</h2></div><ChevronRight size={19} /></div><div className="schedule-sections">{categories.map((category) => { const selected = dayBookings.find((booking) => booking.category === category)?.item.id; return <section className="schedule-section" key={category}><div className="category-heading"><span className="category-marker"><Sparkles size={15} /></span><div><h3>{category}</h3><p>Choose one {category.toLowerCase()} for {selectedDay}.</p></div>{selected && <span className="category-complete"><Check size={13} /> Selected</span>}</div><div className="menu-grid">{mealsForCategory(category).map((item) => <WeeklyMealCard item={item} selected={selected === item.id} onSelect={() => { setSmartPlateItem(item); setSmartPlateAppetite(appetitePreference); }} key={item.id} />)}</div></section>; })}</div>{smartPlateItem && <SmartPlate item={smartPlateItem} appetite={smartPlateAppetite} onChange={setSmartPlateAppetite} onCancel={() => setSmartPlateItem(null)} onConfirm={() => { setAppetitePreference(smartPlateAppetite); selectMeal(selectedDay, smartPlateItem.category as MealCategory, smartPlateItem, smartPlateAppetite); setSmartPlateItem(null); }} />}{planSaved && <div className="success-toast" role="status"><span><Check size={18} /></span><div><strong>Weekly plan saved</strong><small>Your cafeteria bookings are ready for the week.</small></div></div>}</div>;
}
