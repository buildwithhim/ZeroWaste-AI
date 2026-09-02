import { Minus, Plus } from "lucide-react";

type QuantitySelectorProps = { value: number; onChange: (value: number) => void };

export default function QuantitySelector({ value, onChange }: QuantitySelectorProps) {
  return <div className="quantity-selector" aria-label="Quantity selector"><button type="button" onClick={() => onChange(Math.max(1, value - 1))} aria-label="Decrease quantity"><Minus size={15} /></button><strong>{value}</strong><button type="button" onClick={() => onChange(value + 1)} aria-label="Increase quantity"><Plus size={15} /></button></div>;
}
