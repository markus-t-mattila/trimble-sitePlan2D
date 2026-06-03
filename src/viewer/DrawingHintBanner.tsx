import { useFloorplanStore, type ToolMode } from "../state/floorplanStore";
import { findCatalogEntry } from "../annotator/siteElementCatalog";
import { useTranslations } from "../i18n";
import type { Translations } from "../i18n/types";

/**
 * Floating banner pinned at the top of the viewer while any drawing tool is
 * active. Reminds the supervisor what gestures the tool listens for —
 * "click to add a point, Enter or double-click to finish, Esc to cancel" —
 * so the polyline / polygon tools don't need a static legend in the
 * sidebar to be discoverable.
 *
 * The banner content adapts to the geometry kind of the active tool:
 *
 *   - Area (closed polygon): same gesture set + the "closes when you
 *     double-click or press Enter" hint.
 *   - Polyline (route, fence): same gestures but Enter "finishes" the
 *     line rather than closing it back to the start vertex.
 *   - Point (markers): a single click places the symbol.
 *   - Background calibrate: tells the user they can drag the image.
 */
export function DrawingHintBanner(): JSX.Element | null {
  const t = useTranslations();
  const activeTool = useFloorplanStore((state) => state.activeTool);
  if (!activeTool) return null;
  const hint = describeTool(activeTool, t);
  if (!hint) return null;
  return (
    <div className="drawing-hint" role="status" aria-live="polite">
      <span className="drawing-hint__title">{hint.title}</span>
      <span className="drawing-hint__body">{hint.body}</span>
    </div>
  );
}

interface ResolvedHint {
  title: string;
  body: string;
}

function describeTool(tool: ToolMode, t: Translations): ResolvedHint | null {
  if (tool.kind === "area") {
    return {
      title: t.viewer.drawAreaToggle,
      body: t.viewer.polygonHint,
    };
  }
  if (tool.kind === "background-calibrate") {
    return {
      title: t.background.title,
      body: t.background.calibrateHint,
    };
  }
  if (tool.kind === "site") {
    const entry = findCatalogEntry(tool.category);
    if (!entry) return null;
    const label = t.siteElements[entry.labelKey];
    if (entry.geometryKind === "polyline") {
      return { title: label, body: t.viewer.polylineHint };
    }
    if (entry.geometryKind === "polygon") {
      return { title: label, body: t.viewer.polygonHint };
    }
    return { title: label, body: t.viewer.pointHint };
  }
  return null;
}
