/**
 * Confirmation before a destructive action.
 *
 * Removing a meal is not recoverable from the interface -- there is no undo,
 * and the removal is pushed to the kitchen immediately -- so it gets a stop.
 * The dialog names the specific thing being removed rather than asking "are you
 * sure?", because a generic prompt trains people to click through it.
 */

import { AlertTriangle, X } from "lucide-react";
import { useEffect, useRef } from "react";

type ConfirmDialogProps = {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function ConfirmDialog({
  title,
  message,
  confirmLabel = "Remove",
  cancelLabel = "Keep it",
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  /**
   * Focus management for a dialog that guards an irreversible action.
   *
   * Focus goes to the *safe* choice. It previously landed on "Remove", so a
   * keyboard user pressing Enter to open the dialog and Enter again -- the
   * ordinary rhythm of dismissing a prompt -- destroyed the booking without
   * ever reading it. The safe default is the whole reason to interrupt.
   *
   * Tab is trapped inside, because `aria-modal` only tells assistive tech the
   * rest of the page is inert; it does not stop the browser tabbing into
   * everything behind the backdrop. And focus is returned to whatever opened
   * the dialog, so keyboard users are not dropped at the top of the document
   * (WCAG 2.4.3).
   */
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    cancelRef.current?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onCancel();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = dialogRef.current?.querySelectorAll<HTMLElement>("button:not([disabled])");
      if (!focusable || focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      opener?.focus?.();
    };
  }, [onCancel]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onCancel}>
      <section
        ref={dialogRef}
        className="order-modal confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onCancel} aria-label="Close">
          <X size={18} />
        </button>
        <span className="confirm-dialog-icon">
          <AlertTriangle size={22} />
        </span>
        <h2 id="confirm-dialog-title">{title}</h2>
        <p id="confirm-dialog-message">{message}</p>
        <div className="modal-actions">
          <button type="button" className="secondary-button" ref={cancelRef} onClick={onCancel}>
            {cancelLabel}
          </button>
          <button type="button" className="danger-button" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </section>
    </div>
  );
}
