import { useEffect } from "react";
import { useTranslations } from "../i18n";

interface ConfirmDialogProps {
  title: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * Confirmation dialog used in place of `window.confirm`. Native browser
 * confirms look out of place inside the Trimble Connect shell, and the
 * native `<dialog>` element collided with React's render lifecycle —
 * `showModal()` was called while a parent re-render was tearing the
 * dialog back down, so the click on "Confirm" went to a detached node
 * and the delete never fired. This component uses a plain div overlay
 * with the same Modus styling — open/close is just whether the parent
 * renders us, so handlers attach on the very first paint.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  destructive = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): JSX.Element {
  const t = useTranslations();

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="confirm-dialog-title"
      onClick={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div className="dialog__panel">
        <h3 id="confirm-dialog-title" className="dialog__title">
          {title}
        </h3>
        {message ? <p>{message}</p> : null}
        <div className="btn-row btn-row--end">
          <button type="button" className="btn" onClick={onCancel}>
            {cancelLabel ?? t.areas.cancel}
          </button>
          <button
            type="button"
            className={`btn ${destructive ? "btn--danger" : "btn--primary"}`}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel ?? t.areas.save}
          </button>
        </div>
      </div>
    </div>
  );
}
