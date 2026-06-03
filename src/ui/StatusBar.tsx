interface StatusBarProps {
  status: string;
  error: string | null;
}

/**
 * Bottom-of-the-window status line. Renders either the most recent error
 * (with `.status-error` styling) or the informational status message.
 *
 * Uses `role="status"` + `aria-live="polite"` so assistive technologies
 * announce status changes — important during a multi-second IFC parse or
 * upload when nothing else moves on the screen.
 */
export function StatusBar({ status, error }: StatusBarProps): JSX.Element {
  return (
    <span role="status" aria-live="polite">
      {error ? <span className="status-error">{error}</span> : status}
    </span>
  );
}
