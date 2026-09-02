import { Sparkles } from "lucide-react";
import { motion } from "framer-motion";
import QuantitySelector from "./QuantitySelector";

export type MenuItem = { id: number; name: string; category: string; description: string; calories: number; protein: number; price: number; image: string; isVeg: boolean };
type MenuCardProps = { item: MenuItem; quantity: number; onQuantityChange: (quantity: number) => void; onPlaceOrder: () => void };

export default function MenuCard({ item, quantity, onQuantityChange, onPlaceOrder }: MenuCardProps) {
  return <motion.article className="menu-card" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} whileHover={{ y: -5, boxShadow: "0 16px 30px rgba(0,0,0,.11)" }}><img src={item.image} alt={item.name} /><div className="menu-card-body"><div className="menu-card-top"><div><span className="menu-category">{item.category}</span><h3>{item.name}</h3></div><span className="veg-badge"><i /> Veg</span></div><p>{item.description}</p><div className="menu-card-meta"><span>{item.calories} kcal <b>·</b> {item.protein}g protein</span><strong>₹{item.price.toFixed(0)}</strong></div><div className="recommendation"><Sparkles size={14} /><span>AI Recommended Portion: <b>Regular</b></span></div><div className="menu-card-actions"><QuantitySelector value={quantity} onChange={onQuantityChange} /><button type="button" className="order-button" onClick={onPlaceOrder}>Place order</button></div></div></motion.article>;
}
