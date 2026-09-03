/**
 * Whether the kitchen actually knows about this plan.
 *
 * BookingContext has always tracked the sync state and the lines the server
 * refused, but nothing rendered either of them. An employee could pick five
 * meals, have the server reject the lot, and see a screen that looked exactly
 * like success -- which in an app whose purpose is telling the kitchen what to
 * cook is the worst thing it could do quietly.
 *
 * This is deliberately a plain-language strip, not a status code. "Saved" and
 * "not saved" are the only two things the employee needs to act on.
 */

import { AlertTriangle, Check, CloudOff, Loader2 } from "lucide-react";

import { useBookings } from "../context/BookingContext";

export default function PlanSyncStatus() {
  const { syncState, syncRejections, hasUnsavedChanges, retrySync, bookings } = useBookings();

  // Nothing to report before the first meal is chosen.
  if (bookings.length === 0 && syncRejections.length === 0) return null;

  if (syncState === "offline") {
    return (
      <div className="plan-sync plan-sync-error" role="alert">
        <CloudOff size={16} />
        <span>
          <strong>Your plan is saved on this device but has not reached the cafeteria.</strong>
          <small>The kitchen will not see these meals until it syncs.</small>
        </span>
        <button type="button" className="secondary-button" onClick={retrySync}>
          Retry
        </button>
      </div>
    );
  }

  if (syncRejections.length > 0) {
    return (
      <div className="plan-sync plan-sync-error" role="alert">
        <AlertTriangle size={16} />
        <span>
          <strong>
            {syncRejections.length} {syncRejections.length === 1 ? "meal was" : "meals were"} not accepted.
          </strong>
          <small>
            {syncRejections
              .slice(0, 3)
              .map((rejection) => `${rejection.dish ?? "A meal"} — ${rejection.reason}`)
              .join(" · ")}
          </small>
        </span>
        <button type="button" className="secondary-button" onClick={retrySync}>
          Retry
        </button>
      </div>
    );
  }

  if (syncState === "syncing" || hasUnsavedChanges) {
    return (
      <div className="plan-sync" role="status">
        <Loader2 size={16} className="spin" />
        <span>
          <strong>Saving your plan…</strong>
        </span>
      </div>
    );
  }

  if (syncState === "synced") {
    return (
      <div className="plan-sync plan-sync-ok" role="status">
        <Check size={16} />
        <span>
          <strong>Saved. The kitchen has your plan.</strong>
          <small>Changes save automatically.</small>
        </span>
      </div>
    );
  }

  return null;
}
