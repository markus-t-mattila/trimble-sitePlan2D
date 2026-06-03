import { useTranslations } from "../i18n";
import type { IfcUnit, RenderOptions } from "../types";

interface CoordinateOverlayProps {
  position: { x: number; y: number } | null;
  unit: IfcUnit;
  projectionAxis: RenderOptions["projectionAxis"];
}

/**
 * Pinned overlay in the viewer's lower-left corner that shows the IFC-world
 * coordinates of the cursor as the user moves the pointer over the SVG.
 *
 * The displayed axes match the **IFC model's** coordinate frame, not the
 * 2D screen plane. The auto-detected up-axis on the storey document tells
 * us which two world axes the plan view is using:
 *
 *   - `projectionAxis = "z"` → plan shows (X, Y); displayed as X & Y.
 *   - `projectionAxis = "y"` → plan shows (X, Z); displayed as X & Z.
 *   - `projectionAxis = "x"` → plan shows (Y, Z); displayed as Y & Z.
 */
export function CoordinateOverlay({ position, unit, projectionAxis }: CoordinateOverlayProps): JSX.Element | null {
  const t = useTranslations();
  if (!position) return null;
  const [firstAxisLabel, secondAxisLabel] = labelsForAxis(projectionAxis);
  return (
    <div className="coordinate-overlay" aria-label={t.viewer.coordinateTooltip}>
      <span>
        {firstAxisLabel}: {position.x.toFixed(3)} {unit}
      </span>
      <br />
      <span>
        {secondAxisLabel}: {position.y.toFixed(3)} {unit}
      </span>
    </div>
  );
}

function labelsForAxis(projectionAxis: RenderOptions["projectionAxis"]): [string, string] {
  switch (projectionAxis) {
    case "y":
      return ["X", "Z"];
    case "x":
      return ["Y", "Z"];
    case "z":
    default:
      return ["X", "Y"];
  }
}
