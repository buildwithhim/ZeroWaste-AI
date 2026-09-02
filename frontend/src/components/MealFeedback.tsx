import { Check, Heart, ThumbsDown, Utensils } from "lucide-react";
import type { Booking } from "../context/BookingContext";
import { useFeedback, type MealFeedback as FeedbackOption } from "../context/FeedbackContext";

type MealFeedbackProps = { booking: Booking };
const options: { label: FeedbackOption; icon: typeof Check }[] = [
  { label: "Finished meal", icon: Check },
  { label: "Left some food", icon: ThumbsDown },
  { label: "Still hungry", icon: Utensils },
];

export default function MealFeedback({ booking }: MealFeedbackProps) {
  const { feedbackFor, submitFeedback } = useFeedback();
  const selected = feedbackFor(booking.id);
  return <div className="meal-feedback"><span className="feedback-label"><Heart size={13} /> How was your portion?</span><div className="feedback-options">{options.map(({ label, icon: Icon }) => <button type="button" className={selected === label ? "selected" : ""} onClick={() => submitFeedback(booking, label)} key={label}><Icon size={13} />{label}{selected === label && <Check size={12} />}</button>)}</div>{selected && <small className="feedback-confirmation">Thanks for helping improve portion planning.</small>}</div>;
}
