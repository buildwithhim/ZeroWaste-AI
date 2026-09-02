import { Check, Lightbulb, X } from "lucide-react";
import type { Appetite } from "../context/BookingContext";
import type { MenuItem } from "./MenuCard";

type SmartPlateProps = { item: MenuItem; appetite: Appetite; onChange: (appetite: Appetite) => void; onCancel: () => void; onConfirm: () => void };
const options: { name: Appetite; grams: number; multiplier: number; description: string }[] = [
  { name: "Light", grams: 220, multiplier: 0.72, description: "A smaller plate for a lighter day" },
  { name: "Regular", grams: 320, multiplier: 1, description: "A balanced everyday serving" },
  { name: "Heavy", grams: 420, multiplier: 1.28, description: "A fuller plate for a bigger appetite" },
];

export default function SmartPlate({ item, appetite, onChange, onCancel, onConfirm }: SmartPlateProps) {
  const selected = options.find((option) => option.name === appetite) ?? options[1];
  return <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}><section className="order-modal smart-plate-modal" role="dialog" aria-modal="true" aria-labelledby="smart-plate-title" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onCancel} aria-label="Close Smart Plate"><X size={18} /></button><span className="smart-plate-icon"><Lightbulb size={22} /></span><span className="eyebrow">SMART PLATE</span><h2 id="smart-plate-title">How hungry are you?</h2><p>Set your plate size for <strong>{item.name}</strong>. SmartQ will use this preference for your buffet booking.</p><div className="appetite-options">{options.map((option) => <button type="button" className={`appetite-option${appetite === option.name ? " selected" : ""}`} onClick={() => onChange(option.name)} key={option.name}><span><strong>{option.name}</strong><small>{option.grams}g · {option.description}</small></span>{option.name === "Regular" && <em>AI recommended</em>}{appetite === option.name && <Check size={17} />}</button>)}</div><div className="plate-estimate"><span>Estimated nutrition</span><strong>{Math.round(item.calories * selected.multiplier)} kcal</strong><b>{Math.round(item.protein * selected.multiplier)}g protein</b></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>Go back</button><button type="button" className="order-button" onClick={onConfirm}>Confirm plate</button></div></section></div>;
}