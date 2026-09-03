/**
 * Empty and error states.
 *
 * These are components rather than inline markup because an employee screen
 * that has nothing to show still has to say something useful. A blank panel
 * reads as a broken app, and "no meals" and "we could not reach the cafeteria"
 * call for different actions from the person looking at it -- one is a prompt,
 * the other is a retry.
 */

import type { LucideIcon } from "lucide-react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import type { ReactNode } from "react";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  message: string;
  action?: ReactNode;
};

export function EmptyState({ icon: Icon, title, message, action }: EmptyStateProps) {
  return (
    <div className="ux-empty-state" role="status">
      <span className="ux-state-icon">
        <Icon size={22} />
      </span>
      <strong>{title}</strong>
      <p>{message}</p>
      {action}
    </div>
  );
}

type ErrorStateProps = {
  title?: string;
  message: string;
  onRetry?: () => void;
  retryLabel?: string;
};

/**
 * `role="alert"` rather than `status`: a failed load is an interruption the
 * employee needs to hear about, not an ambient update.
 */
export function ErrorState({ title = "Something went wrong", message, onRetry, retryLabel = "Try again" }: ErrorStateProps) {
  return (
    <div className="ux-empty-state ux-error-state" role="alert">
      <span className="ux-state-icon">
        <AlertTriangle size={22} />
      </span>
      <strong>{title}</strong>
      <p>{message}</p>
      {onRetry && (
        <button type="button" className="secondary-button" onClick={onRetry}>
          <RefreshCw size={15} /> {retryLabel}
        </button>
      )}
    </div>
  );
}
