import { CheckCircle2, Clock3, Leaf, ShoppingBag } from "lucide-react";
import { Link } from "react-router-dom";
import { useBookings } from "../context/BookingContext";
import MealFeedback from "../components/MealFeedback";

export default function OrderHistoryPage() {
  const { bookings } = useBookings();
  return <div className="page-frame history-page"><div className="page-intro"><div><span className="eyebrow">MY ORDERS</span><h1>Your weekly bookings.</h1><p>A simple record of the Indian meals you planned for each workday.</p></div><div className="history-count"><strong>{bookings.length}</strong><span>meals booked</span></div></div>{bookings.length === 0 ? <div className="history-empty"><span className="empty-icon"><ShoppingBag size={24} /></span><h2>No meals booked yet</h2><p>Choose one breakfast, lunch and snack for each workday.</p><Link className="primary-button" to="../menu">Build weekly plan</Link></div> : <div className="history-list">{bookings.map((booking) => <article className="history-item" key={booking.id}><img src={booking.item.image} alt="" /><div className="history-item-content"><h2>{booking.item.name}</h2><span><Clock3 size={13} /> {booking.day} · {booking.category}</span><div className="history-item-meta"><strong>₹{booking.item.price.toFixed(0)}</strong><span className="history-status"><CheckCircle2 size={13} /> Booked</span></div>{booking.category === "Lunch" && <MealFeedback booking={booking} />}</div></article>)}</div>}<div className="history-impact"><Leaf size={19} /><span><strong>Your weekly plan</strong><small>Advance bookings help the cafeteria prepare the right amount.</small></span></div></div>;
}
