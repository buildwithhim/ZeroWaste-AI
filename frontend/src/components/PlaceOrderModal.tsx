import { Check, X } from "lucide-react";
import type { MenuItem } from "./MenuCard";
import QuantitySelector from "./QuantitySelector";

type PlaceOrderModalProps = { item: MenuItem; quantity: number; onQuantityChange: (quantity: number) => void; onCancel: () => void; onConfirm: () => void };

export default function PlaceOrderModal({ item, quantity, onQuantityChange, onCancel, onConfirm }: PlaceOrderModalProps) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}><section className="order-modal" role="dialog" aria-modal="true" aria-labelledby="order-title" onMouseDown={(event) => event.stopPropagation()}><button type="button" className="modal-close" onClick={onCancel} aria-label="Close order modal"><X size={18} /></button><span className="modal-icon"><Check size={22} /></span><span className="eyebrow">READY TO ORDER?</span><h2 id="order-title">Confirm your meal</h2><p>{item.name} is a smart choice for your workday. Review your portion before placing the order.</p><div className="order-summary"><span><img src={item.image} alt="" />{item.name}</span><strong>₹{(item.price * quantity).toFixed(0)}</strong></div><div className="modal-quantity"><span>Quantity</span><QuantitySelector value={quantity} onChange={onQuantityChange} /></div><div className="modal-actions"><button type="button" className="secondary-button" onClick={onCancel}>Go back</button><button type="button" className="order-button" onClick={onConfirm}>Confirm order</button></div></section></div>;
}
