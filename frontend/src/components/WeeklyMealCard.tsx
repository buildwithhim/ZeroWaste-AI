import { Check, Sparkles } from "lucide-react";
import type { MenuItem } from "./MenuCard";

type WeeklyMealCardProps = { item: MenuItem; selected: boolean; onSelect: () => void };

export default function WeeklyMealCard({ item, selected, onSelect }: WeeklyMealCardProps) {
  return <article className={`menu-card weekly-meal-card${selected ? " selected" : ""}`}><img src={item.image} alt={item.name} /><div className="menu-card-body"><div className="menu-card-top"><div><span className="menu-category">{item.category}</span><h3>{item.name}</h3></div><span className="veg-badge"><i /> {item.isVeg ? "Veg" : "Non-Veg"}</span></div><div className="menu-card-meta"><span>{item.calories} kcal <b>·</b> {item.protein}g protein</span><strong>₹{item.price.toFixed(0)}</strong></div><div className="recommendation"><Sparkles size={14} /><span>AI Recommended Portion: <b>Regular</b></span></div><button type="button" className="order-button" onClick={onSelect}>{selected ? <><Check size={15} /> Selected for plan</> : "Choose for this day"}</button></div></article>;
}
