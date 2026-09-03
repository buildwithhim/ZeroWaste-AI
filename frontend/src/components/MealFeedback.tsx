import { useState } from "react";
import { Check, CircleSlash, CloudOff, Loader2, ShieldCheck, Soup, UtensilsCrossed } from "lucide-react";
import type { Booking } from "../context/BookingContext";
import { useFeedback, type FeedbackResponse } from "../context/FeedbackContext";

type MealFeedbackProps = { booking: Booking };

const options: { label: FeedbackResponse; hint: string; icon: typeof Check }[] = [
  { label: "Finished", hint: "Portion was right", icon: Check },
  { label: "Left some", hint: "A little too much", icon: Soup },
  { label: "Left most", hint: "Far too much", icon: CircleSlash },
  { label: "Wanted more", hint: "Not enough", icon: UtensilsCrossed },
];

export default function MealFeedback({ booking }: MealFeedbackProps) {
  const { feedbackFor, isPending, submit } = useFeedback();
  const [pending, setPending] = useState<FeedbackResponse | null>(null);
  const selected = feedbackFor(booking.id);
  const awaitingSync = isPending(booking.id);

  const choose = async (response: FeedbackResponse) => {
    setPending(response);
    await submit(booking, response);
    setPending(null);
  };

  return (
    <div className="meal-feedback">
      <span className="feedback-label">
        <UtensilsCrossed size={13} /> How was your portion? <em>Optional</em>
      </span>
      <div className="feedback-options">
        {options.map(({ label, hint, icon: Icon }) => (
          <button
            type="button"
            key={label}
            className={selected === label ? "selected" : ""}
            onClick={() => choose(label)}
            disabled={pending !== null}
            aria-pressed={selected === label}
            title={hint}
          >
            {pending === label ? <Loader2 size={13} className="spin" /> : <Icon size={13} />}
            <span>{label}</span>
          </button>
        ))}
      </div>
      {selected ? (
        awaitingSync ? (
          <small className="feedback-offline">
            <CloudOff size={12} /> Saved on this device — we'll send it as soon as the service is reachable.
          </small>
        ) : (
          <small className="feedback-confirmation">
            <ShieldCheck size={12} /> Thanks — this is pooled anonymously to size tomorrow's portions.
          </small>
        )
      ) : (
        <small className="feedback-privacy">
          <ShieldCheck size={12} /> Your answer is anonymous. Admins only ever see combined totals.
        </small>
      )}
    </div>
  );
}
