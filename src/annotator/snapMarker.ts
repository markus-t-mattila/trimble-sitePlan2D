import type { Vec2 } from "../types";
import type { SnapResult } from "./SnapEngine";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Half-edge of the snap marker square, in screen pixels. The marker
 *  stays this size on screen regardless of zoom because we compute the
 *  world-units equivalent via the SVG's current CTM on every repaint. */
const MARKER_HALF_EDGE_PIXELS = 9;

/**
 * Paint a visible "snap-to-here" marker at `snap.point` inside the
 * given SVG group. Shape varies by snap kind so the user can tell at a
 * glance whether they're locking onto a corner or onto an edge:
 *
 *   - vertex snaps  → square (rotated 0°), matches CAD-app conventions
 *     for endpoint / corner snaps
 *   - edge snaps    → square rotated 45° (= diamond), the convention
 *     for "midpoint / on-edge" snaps
 *
 * Colour is the project's `--color-snap` token; we add a thin white
 * halo so the marker stays visible against any underlying paint
 * (light IFC fills, dark site polygons, etc.).
 *
 * Returns the wrapper `<g>` so the caller can remove it on next paint
 * — the draft overlays rebuild their content from scratch each tick.
 */
export function paintSnapMarker(svgElement: SVGSVGElement, snap: SnapResult): SVGGElement {
  const ownerDoc = svgElement.ownerDocument;
  const group = ownerDoc.createElementNS(SVG_NS, "g");
  group.classList.add("snap-marker__group");

  const halfWorld = pixelsToWorld(svgElement, MARKER_HALF_EDGE_PIXELS);
  const [x, y] = snap.point;
  const isEdge = snap.kind === "ifc-edge" || snap.kind === "user-edge";

  // The shape — a rotated square reads as either a marker (0°) or a
  // diamond (45°). We translate into the snap point so the rotation
  // origin is the centre.
  const square = ownerDoc.createElementNS(SVG_NS, "rect");
  square.classList.add("snap-marker__shape");
  square.setAttribute("x", String(-halfWorld));
  square.setAttribute("y", String(-halfWorld));
  square.setAttribute("width", String(halfWorld * 2));
  square.setAttribute("height", String(halfWorld * 2));
  const rotation = isEdge ? 45 : 0;
  square.setAttribute("transform", `translate(${x} ${y}) rotate(${rotation})`);
  group.appendChild(square);

  // Centre dot so the eye locks onto the exact snap point even when
  // the marker overlaps a busy area. Small (1/3 of the half-edge).
  const dot = ownerDoc.createElementNS(SVG_NS, "circle");
  dot.classList.add("snap-marker__dot");
  dot.setAttribute("cx", String(x));
  dot.setAttribute("cy", String(y));
  dot.setAttribute("r", String(halfWorld / 3));
  group.appendChild(dot);

  return group;
}

/**
 * Translate a screen-pixel distance into the SVG's current world-unit
 * frame by inverting the screen CTM. Used to keep the snap marker the
 * same visual size regardless of zoom.
 */
function pixelsToWorld(svgElement: SVGSVGElement, pixels: number): number {
  const ctm = svgElement.getScreenCTM();
  if (!ctm) return 0.5;
  const inverse = ctm.inverse();
  const a = svgElement.createSVGPoint();
  const b = svgElement.createSVGPoint();
  b.x = pixels;
  const aw = a.matrixTransform(inverse);
  const bw = b.matrixTransform(inverse);
  const dist = Math.hypot(bw.x - aw.x, bw.y - aw.y);
  return Math.max(0.05, dist);
}

/** Stub exported so the caller can still use the snap-marker
 *  geometry helpers in tests without paying for the rendered DOM. */
export function snapMarkerCenter(snap: SnapResult): Vec2 {
  return snap.point;
}

/**
 * Toggle the snap-state CSS classes on the canvas container so the
 * cursor switches to an X (vertex / endpoint snap) or a square (edge
 * snap) while a drawing tool is active. Called from each tool's
 * pointermove handler with the latest snap result; pass `null` when
 * the snap has lapsed (e.g. cursor moved out of radius, or Alt is
 * held to skip snap) so we revert to plain crosshair.
 *
 * The class additions are cheap and idempotent — class manipulation
 * doesn't reflow.
 */
export function applySnapCursor(container: Element | null, snap: SnapResult | null): void {
  if (!container) return;
  const isVertex = snap?.kind === "ifc-vertex" || snap?.kind === "user-vertex";
  const isEdge = snap?.kind === "ifc-edge" || snap?.kind === "user-edge";
  container.classList.toggle("viewer__canvas--snap-vertex", isVertex);
  container.classList.toggle("viewer__canvas--snap-edge", isEdge);
}

/** Drawing tools call this on cleanup so the snap-state classes don't
 *  leak when the user finishes drawing or switches tools. */
export function clearSnapCursor(container: Element | null): void {
  if (!container) return;
  container.classList.remove("viewer__canvas--snap-vertex");
  container.classList.remove("viewer__canvas--snap-edge");
}
