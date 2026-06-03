import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type RefObject } from "react";
import type { SiteElement, StoreyDocument, UserArea, Vec2 } from "../types";
import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";
import { useWorldPointer } from "./useWorldPointer";
import { SnapEngine, type SnapResult } from "./SnapEngine";
import { applySnapCursor, clearSnapCursor, paintSnapMarker } from "./snapMarker";
import type { SelectionTarget } from "../viewer/SvgCanvas";
import { isTypingInFormField } from "../utils/keyboardFocus";

const SVG_NS = "http://www.w3.org/2000/svg";

/** Snap search radius in screen pixels — the same value the drawing
 *  tools use so an active drag locks onto a corner at the same
 *  cursor-to-target distance the user already learnt while drawing. */
const SNAP_PIXEL_RADIUS = 12;

/** Pixel size budget for vertex / midpoint / body grab handles. The
 *  visual size in WORLD units is `pixels / current-scale`, computed in
 *  the paint effect via `getScreenCTM` so handles stay the same on-screen
 *  size regardless of zoom. */
const VERTEX_HANDLE_PIXELS = 9;
const MIDPOINT_HANDLE_PIXELS = 5;
/** Centre move handle for points — generous because the visible symbol
 *  (a crane icon, etc.) is what the user instinctively grabs. The
 *  pointerdown handler ALSO accepts the visible symbol itself as a body
 *  drag target (see the data-site-element-id fallback below). */
const POINT_HANDLE_PIXELS = 18;
/** Radius drag handle — large enough to spot from a sidebar glance,
 *  small enough not to occlude the ring. */
const RADIUS_HANDLE_PIXELS = 12;
/** Minimum cursor movement before a drag is considered "real". Below
 *  this we treat the gesture as a click — useful for clicking edge
 *  midpoints to add a new vertex without an accidental tiny drag. */
const DRAG_THRESHOLD_PX = 3;

interface EditOverlayProps {
  document: StoreyDocument;
  selection: SelectionTarget;
  svgRef: RefObject<SVGSVGElement | null>;
  onExit: () => void;
}

interface ResolvedTarget {
  kind: "polygon" | "polyline" | "point";
  /** Polygon: outer ring vertices. Polyline: vertex chain. Point: empty. */
  vertices: Vec2[];
  /** Only set when kind === "point". */
  pointPosition: Vec2 | null;
  /** Current rotation of a point in degrees. */
  pointRotation: number;
  /**
   * Current point radius. Crane only — other point categories don't
   * have a meaningful "reach circle"; for those we expose a `size`
   * handle instead so the user can scale the symbol.
   */
  pointRadius: number;
  /** Current symbol size in metres (for points). */
  pointSize: number;
  /** Which paint mode applies to this point: crane = radius handle,
   *  every other point category = size handle. */
  pointSecondaryHandle: "radius" | "size" | "none";
}

/** Seed radius applied when a crane doesn't yet carry one. */
const CRANE_DEFAULT_RADIUS = 8;
/** Default symbol size for points (matches DEFAULT_POINT_SIZE_WORLD). */
const DEFAULT_POINT_SIZE = 1.5;
/** Angle increments for the rotation handle snap, in degrees. */
const ROTATION_SNAP_DEG = 15;

type DragMode =
  | { kind: "idle" }
  | { kind: "vertex"; index: number; pointerId: number; originStart: Vec2; startVertices: Vec2[]; movedPx: number }
  | { kind: "body"; pointerId: number; originStart: Vec2; startVertices: Vec2[]; startPosition: Vec2 | null; movedPx: number }
  | { kind: "point-move"; pointerId: number; originStart: Vec2; startPosition: Vec2; movedPx: number }
  | { kind: "radius"; pointerId: number; centre: Vec2; startRadius: number; movedPx: number }
  | { kind: "size"; pointerId: number; centre: Vec2; startSize: number; movedPx: number }
  | { kind: "rotate"; pointerId: number; centre: Vec2; startAngle: number; startRotation: number; movedPx: number };

/**
 * In-canvas drag-edit affordance for selected user areas + site elements.
 *
 * Gesture set:
 *   - vertex handle drag  → reshape (move that vertex only)
 *   - body drag            → translate the whole shape
 *   - edge midpoint click  → insert a new vertex at that point (polygon/polyline)
 *   - point drag           → move the marker (point geometry)
 *   - Esc                  → exit edit mode
 *
 * The overlay paints into an SVG `<g class="edit-overlay">` that sits at
 * the end of the canvas SVG so handles stack on top of everything else.
 * Pointer events are bound on the canvas SVG element itself (not a React
 * div) so coordinates come from `getScreenCTM` exactly like the drawing
 * tools' world conversion — no offset drift across zoom levels.
 */
export function EditOverlay({ document: doc, selection, svgRef, onExit }: EditOverlayProps): JSX.Element | null {
  const t = useTranslations();
  const updateUserAreaPolygon = useFloorplanStore((state) => state.updateUserAreaPolygon);
  const updateSiteElementVertices = useFloorplanStore((state) => state.updateSiteElementVertices);
  const updateSiteElementGeometry = useFloorplanStore((state) => state.updateSiteElementGeometry);

  // Memoised: every render used to recompute a fresh ResolvedTarget
  // object literal, which made the paint effect's deps "change" each
  // render and tore down + re-bound the pointer handlers mid-drag — so
  // pointermove would fire on a freshly-detached listener and the
  // gesture would silently die. With useMemo the effect only runs when
  // the underlying doc or selection actually shifts.
  const target = useMemo(() => resolveTarget(doc, selection), [doc, selection]);
  // Local working copy of the geometry — flushed to the store on pointerup.
  // We keep it in a ref so the pointermove handler always reads the latest
  // without re-binding when state changes.
  const draftRef = useRef<{
    vertices: Vec2[];
    position: Vec2 | null;
    radius: number;
    size: number;
    rotation: number;
  }>({
    vertices: target?.vertices ?? [],
    position: target?.pointPosition ?? null,
    radius: target?.pointRadius ?? 0,
    size: target?.pointSize ?? DEFAULT_POINT_SIZE,
    rotation: target?.pointRotation ?? 0,
  });
  // Re-seed the draft only when the underlying store data changes
  // (doc) or the user switches to a different target (selection). NOT
  // on every render — that would clobber the drag-in-progress draft
  // with the stale store value and the cursor would tear free from
  // the vertex it was supposed to be moving.
  useEffect(() => {
    if (!target) return;
    draftRef.current = {
      vertices: target.vertices,
      position: target.pointPosition,
      radius: target.pointRadius,
      size: target.pointSize,
      rotation: target.pointRotation,
    };
  }, [target]);
  const [renderTick, forceRerender] = useState(0);

  // Holds the paint function created inside the setup effect, so the
  // every-render layout effect below can call it without needing to
  // re-bind on every render. Without this, `paint()` only ran on
  // effect mount + viewBox mutations — pointermove's forceRerender()
  // didn't trigger a re-paint, so neither the handles nor the visible
  // body of the dragged element actually followed the cursor.
  const paintRef = useRef<() => void>(() => {});

  const dragRef = useRef<DragMode>({ kind: "idle" });
  const yFlipOffset = doc.boundingBox.yMin + doc.boundingBox.yMax;
  const clientToWorld = useWorldPointer(svgRef, yFlipOffset);

  // Snap engine for the active storey, rebuilt only when the document
  // shifts. The engine indexes EVERY user-area + site-element vertex
  // and edge plus the IFC geometry; during a drag we filter out the
  // element being edited so vertices don't self-snap.
  const snapEngine = useMemo(() => SnapEngine.fromStorey(doc), [doc]);
  // The current snap result, kept in a ref so pointermove can read it
  // without forcing a React re-render every frame.
  const snapRef = useRef<SnapResult | null>(null);
  const altPressedRef = useRef(false);
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      altPressedRef.current = event.altKey;
    }
    function onKeyUp(event: KeyboardEvent): void {
      altPressedRef.current = event.altKey;
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, []);

  // Esc exits edit mode. Caller decides what to do (clear selection or just
  // drop the editing flag) via `onExit`. Skip the listener when the user
  // is typing into a name input (e.g. the edit dialog) — Esc there means
  // "clear my draft text", not "exit the editor".
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (isTypingInFormField(event)) return;
      if (event.key === "Escape") onExit();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onExit]);

  // Commit helper: writes the current draft to the store under the right
  // action depending on the selection kind.
  const commitDraft = useCallback((): void => {
    const draft = draftRef.current;
    if (!target) return;
    if (selection.kind === "userArea" && target.kind === "polygon") {
      updateUserAreaPolygon(doc.storey.expressId, selection.id, draft.vertices);
      return;
    }
    if (selection.kind === "siteElement") {
      if (target.kind === "polygon" || target.kind === "polyline") {
        updateSiteElementVertices(doc.storey.expressId, selection.id, draft.vertices);
        return;
      }
      if (target.kind === "point" && draft.position) {
        // Push position + radius + size + rotation in one call so a
        // single drag writes the full point state. Zero / unset fields
        // are skipped by the store action so we don't accidentally
        // clobber values we didn't touch.
        updateSiteElementGeometry(doc.storey.expressId, selection.id, {
          position: [draft.position[0], draft.position[1]],
          rotationDeg: draft.rotation,
          ...(draft.radius > 0 ? { radiusWorld: draft.radius } : {}),
          ...(draft.size > 0 ? { sizeWorld: draft.size } : {}),
        });
      }
    }
  }, [target, selection, doc.storey.expressId, updateUserAreaPolygon, updateSiteElementVertices, updateSiteElementGeometry]);

  // Paint pass: re-mounts whenever the underlying geometry, selection, or
  // viewport changes. We hang an `<g class="edit-overlay">` on the SVG
  // root and refill its contents on every change.
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !target) return;
    const ownerDoc = svgElement.ownerDocument;
    const group = ownerDoc.createElementNS(SVG_NS, "g");
    group.classList.add("edit-overlay");
    group.setAttribute("transform", `translate(0 ${yFlipOffset}) scale(1 -1)`);
    svgElement.appendChild(group);

    function paint(): void {
      group.innerHTML = "";
      const handleWorld = pixelsToWorld(svgElement!, VERTEX_HANDLE_PIXELS);
      const midpointWorld = pixelsToWorld(svgElement!, MIDPOINT_HANDLE_PIXELS);
      const pointHandleWorld = pixelsToWorld(svgElement!, POINT_HANDLE_PIXELS);
      const radiusHandleWorld = pixelsToWorld(svgElement!, RADIUS_HANDLE_PIXELS);

      const draft = draftRef.current;
      // Live preview: while the user is dragging, the store-backed
      // svgBuilder output is still the PRE-drag geometry. To make the
      // visible body move with the cursor (rather than only on
      // pointerup), we patch the corresponding path / use element
      // directly in the DOM each frame. The store commit on pointerup
      // re-paints the entire SVG with the final values; that overrides
      // whatever we wrote here, so the preview is purely cosmetic.
      reflectDraftOnVisibleElement(svgElement!, selection, target!, draft);

      if (target!.kind === "polygon" || target!.kind === "polyline") {
        // Body silhouette — also serves as the "grab to translate" target.
        const body = ownerDoc.createElementNS(SVG_NS, "path");
        body.classList.add("edit-overlay__body");
        body.setAttribute("d", verticesToPathD(draft.vertices, target!.kind === "polygon"));
        body.setAttribute("data-edit-role", "body");
        group.appendChild(body);

        // Edge midpoint markers (click to insert a vertex).
        const edgeCount = target!.kind === "polygon" ? draft.vertices.length : draft.vertices.length - 1;
        for (let i = 0; i < edgeCount; i++) {
          const a = draft.vertices[i]!;
          const b = draft.vertices[(i + 1) % draft.vertices.length]!;
          const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
          const dot = ownerDoc.createElementNS(SVG_NS, "circle");
          dot.classList.add("edit-overlay__midpoint");
          dot.setAttribute("cx", String(mid[0]));
          dot.setAttribute("cy", String(mid[1]));
          dot.setAttribute("r", String(midpointWorld));
          dot.setAttribute("data-edit-role", "midpoint");
          dot.setAttribute("data-edit-index", String(i));
          group.appendChild(dot);
        }

        // Vertex handles last so they paint on top of edges/midpoints.
        draft.vertices.forEach((vertex, index) => {
          const handle = ownerDoc.createElementNS(SVG_NS, "circle");
          handle.classList.add("edit-overlay__vertex");
          handle.setAttribute("cx", String(vertex[0]));
          handle.setAttribute("cy", String(vertex[1]));
          handle.setAttribute("r", String(handleWorld));
          handle.setAttribute("data-edit-role", "vertex");
          handle.setAttribute("data-edit-index", String(index));
          group.appendChild(handle);
        });
      } else if (target!.kind === "point" && draft.position) {
        // Selection halo so the user has zero doubt about which marker
        // is in edit mode. Painted FIRST (so handles stack on top); the
        // radius is a bit bigger than the centre move handle so the
        // halo reads as a glow rather than a competing target.
        const haloRadiusWorld = pixelsToWorld(svgElement!, POINT_HANDLE_PIXELS * 1.6);
        const halo = ownerDoc.createElementNS(SVG_NS, "circle");
        halo.classList.add("edit-overlay__halo");
        halo.setAttribute("cx", String(draft.position[0]));
        halo.setAttribute("cy", String(draft.position[1]));
        halo.setAttribute("r", String(haloRadiusWorld));
        group.appendChild(halo);
        // Secondary handle: crane → radius reach ring, other points →
        // a "size" handle that scales the symbol. The user can use
        // either to grow the visible footprint; only cranes have the
        // dashed reach-radius concept because it represents jib reach.
        if (target!.pointSecondaryHandle === "radius" && draft.radius > 0) {
          const ring = ownerDoc.createElementNS(SVG_NS, "circle");
          ring.classList.add("edit-overlay__radius-ring");
          ring.setAttribute("cx", String(draft.position[0]));
          ring.setAttribute("cy", String(draft.position[1]));
          ring.setAttribute("r", String(draft.radius));
          group.appendChild(ring);
          const grab = ownerDoc.createElementNS(SVG_NS, "circle");
          grab.classList.add("edit-overlay__radius-handle");
          grab.setAttribute("cx", String(draft.position[0] + draft.radius));
          grab.setAttribute("cy", String(draft.position[1]));
          grab.setAttribute("r", String(radiusHandleWorld));
          grab.setAttribute("data-edit-role", "radius");
          group.appendChild(grab);
        }
        if (target!.pointSecondaryHandle === "size" && draft.size > 0) {
          // Size handle sits at the south-east corner of the symbol's
          // bounding box (half-size offset on both axes), giving the
          // user the same "drag-corner-to-scale" gesture as a generic
          // resize affordance.
          const half = draft.size / 2;
          const grab = ownerDoc.createElementNS(SVG_NS, "circle");
          grab.classList.add("edit-overlay__size-handle");
          grab.setAttribute("cx", String(draft.position[0] + half));
          grab.setAttribute("cy", String(draft.position[1] - half));
          grab.setAttribute("r", String(radiusHandleWorld));
          grab.setAttribute("data-edit-role", "size");
          group.appendChild(grab);
        }
        // Rotation handle: a fixed offset north of the centre,
        // connected by a short line so the gesture reads as "twist".
        // Drag computes the angle from centre and snaps the value to
        // ROTATION_SNAP_DEG-degree increments.
        const rotationArm = Math.max(draft.size, 1.0);
        const rotRad = (draft.rotation * Math.PI) / 180;
        const rotHandleX = draft.position[0] + Math.sin(rotRad) * rotationArm;
        const rotHandleY = draft.position[1] + Math.cos(rotRad) * rotationArm;
        const rotLine = ownerDoc.createElementNS(SVG_NS, "line");
        rotLine.classList.add("edit-overlay__rotation-arm");
        rotLine.setAttribute("x1", String(draft.position[0]));
        rotLine.setAttribute("y1", String(draft.position[1]));
        rotLine.setAttribute("x2", String(rotHandleX));
        rotLine.setAttribute("y2", String(rotHandleY));
        group.appendChild(rotLine);
        const rotHandle = ownerDoc.createElementNS(SVG_NS, "circle");
        rotHandle.classList.add("edit-overlay__rotation-handle");
        rotHandle.setAttribute("cx", String(rotHandleX));
        rotHandle.setAttribute("cy", String(rotHandleY));
        rotHandle.setAttribute("r", String(radiusHandleWorld));
        rotHandle.setAttribute("data-edit-role", "rotate");
        group.appendChild(rotHandle);
        // Centre move handle paints last so it sits on top of the rest.
        const handle = ownerDoc.createElementNS(SVG_NS, "circle");
        handle.classList.add("edit-overlay__vertex");
        handle.setAttribute("cx", String(draft.position[0]));
        handle.setAttribute("cy", String(draft.position[1]));
        handle.setAttribute("r", String(pointHandleWorld));
        handle.setAttribute("data-edit-role", "point");
        group.appendChild(handle);
      }

      // Snap marker — painted last so it stacks on top of the
      // dragged geometry. Reuses the same kind-aware marker shape
      // (square = vertex, diamond = edge) the drawing tools paint.
      if (snapRef.current) {
        group.appendChild(paintSnapMarker(svgElement!, snapRef.current));
      }
    }

    // Expose the closure-bound paint() to the layout effect below so
    // every React render (including the forceRerender() each
    // pointermove fires) causes a re-paint. Without this, only the
    // mount + viewBox-mutation paths would call paint().
    paintRef.current = paint;
    paint();
    // Re-paint on every zoom/pan so handle world-radius keeps a constant
    // screen size. The MutationObserver watches the viewBox attribute on
    // the SVG root.
    const observer = new MutationObserver(() => paint());
    observer.observe(svgElement, { attributes: true, attributeFilter: ["viewBox"] });

    return () => {
      observer.disconnect();
      group.remove();
      paintRef.current = () => {};
    };
  }, [target, svgRef, yFlipOffset, selection]);

  // Re-paint on EVERY render. `useLayoutEffect` (vs `useEffect`) runs
  // synchronously before the browser paints the next frame, so dragging
  // looks frame-perfect: the user moves the mouse, React re-renders,
  // we patch the visible <path> / <use> via paintRef.current(), and
  // the next browser frame already shows the updated geometry.
  useLayoutEffect(() => {
    paintRef.current();
  }, [renderTick]);

  // Pointer handling. Bound to the SVG element directly so coordinate math
  // is consistent with the drawing tools.
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement || !target) return;

    function onPointerDown(event: PointerEvent): void {
      const eventTarget = event.target;
      if (!(eventTarget instanceof Element)) return;
      let role = eventTarget.getAttribute("data-edit-role");
      const indexAttr = eventTarget.getAttribute("data-edit-index");
      const index = indexAttr != null ? Number(indexAttr) : -1;
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      const draft = draftRef.current;

      // Fallback: when the click lands on the SELECTED element's visible
      // geometry itself (not on one of our handles), treat it as a body
      // drag. This is how the user instinctively reaches for points —
      // they grab the crane icon, not the small handle on top — and it
      // also catches polygon clicks that miss the overlay silhouette.
      if (!role && target) {
        const selectedNode = eventTarget.closest<SVGElement>(
          selection.kind === "userArea"
            ? `[data-user-area-id="${cssEscape(selection.id)}"]`
            : `[data-site-element-id="${cssEscape(selection.id)}"]`,
        );
        if (selectedNode) {
          role = target.kind === "point" ? "point" : "body";
        }
      }

      if (role === "vertex") {
        dragRef.current = {
          kind: "vertex",
          index,
          pointerId: event.pointerId,
          originStart: world,
          startVertices: draft.vertices.map((v) => [v[0], v[1]] as Vec2),
          movedPx: 0,
        };
        svgElement!.setPointerCapture(event.pointerId);
        event.stopPropagation();
        return;
      }
      if (role === "midpoint") {
        // Click on a midpoint inserts a new vertex AT the midpoint between
        // vertex `index` and vertex `index+1`. We don't enter drag mode —
        // a quick second click should be able to add another. The store
        // commit happens inline.
        const a = draft.vertices[index];
        const b = draft.vertices[(index + 1) % draft.vertices.length];
        if (!a || !b) return;
        const mid: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const nextVertices = [...draft.vertices.slice(0, index + 1), mid, ...draft.vertices.slice(index + 1)];
        draftRef.current = { ...draft, vertices: nextVertices };
        forceRerender((n) => n + 1);
        // Commit immediately — the user's intent is "add this vertex".
        if (selection.kind === "userArea") {
          updateUserAreaPolygon(doc.storey.expressId, selection.id, nextVertices);
        } else if (selection.kind === "siteElement") {
          updateSiteElementVertices(doc.storey.expressId, selection.id, nextVertices);
        }
        event.stopPropagation();
        return;
      }
      if (role === "point") {
        dragRef.current = {
          kind: "point-move",
          pointerId: event.pointerId,
          originStart: world,
          startPosition: draft.position ?? [0, 0],
          movedPx: 0,
        };
        svgElement!.setPointerCapture(event.pointerId);
        event.stopPropagation();
        return;
      }
      if (role === "radius") {
        if (!draft.position) return;
        dragRef.current = {
          kind: "radius",
          pointerId: event.pointerId,
          centre: draft.position,
          startRadius: draft.radius,
          movedPx: 0,
        };
        svgElement!.setPointerCapture(event.pointerId);
        event.stopPropagation();
        return;
      }
      if (role === "size") {
        if (!draft.position) return;
        dragRef.current = {
          kind: "size",
          pointerId: event.pointerId,
          centre: draft.position,
          startSize: draft.size,
          movedPx: 0,
        };
        svgElement!.setPointerCapture(event.pointerId);
        event.stopPropagation();
        return;
      }
      if (role === "rotate") {
        if (!draft.position) return;
        // Record the angle from centre→pointer at drag-start so the
        // drag computes a DELTA, not an absolute angle, which would
        // jump as soon as the pointer enters the handle.
        const startAngle = Math.atan2(world[0] - draft.position[0], world[1] - draft.position[1]);
        dragRef.current = {
          kind: "rotate",
          pointerId: event.pointerId,
          centre: draft.position,
          startAngle,
          startRotation: draft.rotation,
          movedPx: 0,
        };
        svgElement!.setPointerCapture(event.pointerId);
        event.stopPropagation();
        return;
      }
      if (role === "body") {
        dragRef.current = {
          kind: "body",
          pointerId: event.pointerId,
          originStart: world,
          startVertices: draft.vertices.map((v) => [v[0], v[1]] as Vec2),
          startPosition: draft.position ? [draft.position[0], draft.position[1]] : null,
          movedPx: 0,
        };
        svgElement!.setPointerCapture(event.pointerId);
        event.stopPropagation();
      }
    }

    function snapWorld(probe: Vec2): { snap: SnapResult | null; world: Vec2 } {
      if (altPressedRef.current) return { snap: null, world: probe };
      const svgEl = svgRef.current;
      if (!svgEl) return { snap: null, world: probe };
      // World-units equivalent of SNAP_PIXEL_RADIUS at the current zoom.
      const ctm = svgEl.getScreenCTM();
      if (!ctm) return { snap: null, world: probe };
      const a = svgEl.createSVGPoint();
      const b = svgEl.createSVGPoint();
      b.x = SNAP_PIXEL_RADIUS;
      const inverse = ctm.inverse();
      const aw = a.matrixTransform(inverse);
      const bw = b.matrixTransform(inverse);
      const worldRadius = Math.max(0.01, Math.hypot(bw.x - aw.x, bw.y - aw.y));
      const result = snapEngine.findNearest(probe[0], probe[1], worldRadius);
      if (!result) return { snap: null, world: probe };
      // Don't self-snap — vertices of the element being edited would
      // pin you in place. The SnapEngine tags every candidate with
      // `sourceId` matching the area/element id.
      if (result.sourceId === selection.id) return { snap: null, world: probe };
      return { snap: result, world: result.point };
    }

    function onPointerMove(event: PointerEvent): void {
      const drag = dragRef.current;
      if (drag.kind === "idle") return;
      if (event.pointerId !== drag.pointerId) return;
      const rawWorld = clientToWorld(event.clientX, event.clientY);
      if (!rawWorld) return;
      drag.movedPx = Math.max(drag.movedPx, Math.hypot(event.movementX, event.movementY) + drag.movedPx);

      if (drag.kind === "vertex") {
        // Snap the dragged vertex to nearby corners / edges. The
        // computed snap point IS the new vertex position, so the
        // user sees the vertex jump onto the target.
        const { snap, world } = snapWorld(rawWorld);
        snapRef.current = snap;
        applySnapCursor(svgElement!, snap);
        const next = drag.startVertices.map((v) => [v[0], v[1]] as Vec2);
        const original = drag.startVertices[drag.index];
        if (!original) return;
        next[drag.index] = world;
        draftRef.current = { ...draftRef.current, vertices: next };
        forceRerender((n) => n + 1);
        return;
      }
      if (drag.kind === "body") {
        // For a whole-body translate the snap target is the cursor
        // position itself — we infer the implied per-vertex offset
        // from how far the pointer has moved AT THE SNAPPED location
        // versus the original press point.
        const { snap, world } = snapWorld(rawWorld);
        snapRef.current = snap;
        applySnapCursor(svgElement!, snap);
        const dx = world[0] - drag.originStart[0];
        const dy = world[1] - drag.originStart[1];
        const next = drag.startVertices.map((v) => [v[0] + dx, v[1] + dy] as Vec2);
        const nextPosition: Vec2 | null = drag.startPosition
          ? [drag.startPosition[0] + dx, drag.startPosition[1] + dy]
          : null;
        draftRef.current = { ...draftRef.current, vertices: next, position: nextPosition };
        forceRerender((n) => n + 1);
        return;
      }
      if (drag.kind === "point-move") {
        const { snap, world } = snapWorld(rawWorld);
        snapRef.current = snap;
        applySnapCursor(svgElement!, snap);
        const next: Vec2 = world;
        draftRef.current = { ...draftRef.current, position: next };
        forceRerender((n) => n + 1);
        return;
      }
      if (drag.kind === "radius") {
        // Radius / size / rotate use the raw pointer position — they
        // resize / rotate around the element's own centre, so a snap
        // to some OTHER element's vertex would be meaningless.
        const next = Math.max(0.1, Math.hypot(rawWorld[0] - drag.centre[0], rawWorld[1] - drag.centre[1]));
        draftRef.current = { ...draftRef.current, radius: next };
        forceRerender((n) => n + 1);
        return;
      }
      if (drag.kind === "size") {
        // The handle sits at half-size from the centre on both axes, so
        // distance × √2 ≈ new size. Approximate as `2 × distance / √2`
        // which simplifies to `√2 × distance`.
        const dist = Math.hypot(rawWorld[0] - drag.centre[0], rawWorld[1] - drag.centre[1]);
        const next = Math.max(0.2, dist * Math.SQRT2);
        draftRef.current = { ...draftRef.current, size: next };
        forceRerender((n) => n + 1);
        return;
      }
      if (drag.kind === "rotate") {
        // Compute the current pointer angle, subtract the start angle
        // to get the delta the user dragged, then add it to the start
        // rotation. Atan2 args are (x, y) — swapped from the math
        // convention — because our rotation angle is measured
        // clockwise from north (= SVG +Y after the flip) the same way
        // the renderer's `rotate(deg)` expects.
        const angleNow = Math.atan2(rawWorld[0] - drag.centre[0], rawWorld[1] - drag.centre[1]);
        const deltaDeg = ((angleNow - drag.startAngle) * 180) / Math.PI;
        let nextRotation = drag.startRotation + deltaDeg;
        // Snap to 15° increments unless Shift is held — same convention
        // as most drafting tools (free rotation with Shift, snapped
        // without). We can't read shift state here without a refs hack
        // so we always snap; users can fine-tune via the number input
        // in the side panel.
        nextRotation = Math.round(nextRotation / ROTATION_SNAP_DEG) * ROTATION_SNAP_DEG;
        // Wrap into [-180, 180] for readability in the panel display.
        while (nextRotation > 180) nextRotation -= 360;
        while (nextRotation < -180) nextRotation += 360;
        draftRef.current = { ...draftRef.current, rotation: nextRotation };
        forceRerender((n) => n + 1);
      }
    }

    function onPointerUp(event: PointerEvent): void {
      const drag = dragRef.current;
      if (drag.kind === "idle") return;
      if (event.pointerId !== drag.pointerId) return;
      try {
        svgElement!.releasePointerCapture(event.pointerId);
      } catch {
        // pointer capture may already be lost (cross-window drag); ignore.
      }
      // Only commit when something actually moved — a quick click on a
      // vertex without movement is a no-op.
      if (drag.movedPx > DRAG_THRESHOLD_PX) {
        commitDraft();
      }
      // Clear the snap marker + cursor class so a subsequent hover
      // doesn't keep showing the snap state from the just-ended drag.
      snapRef.current = null;
      clearSnapCursor(svgElement!);
      dragRef.current = { kind: "idle" };
    }

    svgElement.addEventListener("pointerdown", onPointerDown);
    svgElement.addEventListener("pointermove", onPointerMove);
    svgElement.addEventListener("pointerup", onPointerUp);
    svgElement.addEventListener("pointercancel", onPointerUp);
    return () => {
      svgElement.removeEventListener("pointerdown", onPointerDown);
      svgElement.removeEventListener("pointermove", onPointerMove);
      svgElement.removeEventListener("pointerup", onPointerUp);
      svgElement.removeEventListener("pointercancel", onPointerUp);
      clearSnapCursor(svgElement);
    };
  }, [target, svgRef, clientToWorld, commitDraft, selection, doc.storey.expressId, updateUserAreaPolygon, updateSiteElementVertices, snapEngine]);

  // Help banner. Painted as a React node (not inside the SVG) so the
  // text sits in screen space at a fixed corner regardless of pan/zoom.
  // Reuses the existing `.drawing-hint` styling so it feels of-a-piece
  // with the drawing tools' gesture hint.
  if (!target) return null;
  const hintBody =
    target.kind === "point"
      ? t.editOverlay.pointHint
      : target.kind === "polyline"
        ? t.editOverlay.polylineHint
        : t.editOverlay.polygonHint;
  return (
    <div className="drawing-hint drawing-hint--edit" role="status" aria-live="polite">
      <span className="drawing-hint__title">{t.editOverlay.title}</span>
      <span className="drawing-hint__body">{hintBody}</span>
    </div>
  );
}

/**
 * Live-preview the in-progress drag on the actual rendered element.
 *
 * `draftRef` is updated on every pointermove; the EditOverlay's handles
 * paint with it directly. But the visible body of the selected
 * user-area / site element is painted by the upstream svgBuilder and
 * is bound to the (still-pre-drag) store value, so without this hook
 * the user would see the handles drift while the polygon underneath
 * stays put — confusing, and what the user reported.
 *
 * We locate the matching element by its data-* attribute and patch
 * the geometry-bearing attributes (`d` for paths, `transform` /
 * `cx,cy` for circles + `<use>`) to the draft values. On pointerup
 * the store update fires, the upstream SVG markup is rebuilt, and the
 * full re-paint overrides whatever we wrote here. So the preview is
 * cosmetic — never persists across commits.
 */
function reflectDraftOnVisibleElement(
  svgElement: SVGSVGElement,
  selection: SelectionTarget,
  target: ResolvedTarget,
  draft: { vertices: Vec2[]; position: Vec2 | null; size: number; radius: number; rotation: number },
): void {
  const idAttr =
    selection.kind === "userArea" ? "data-user-area-id" : "data-site-element-id";
  // CSS attribute-selector escape — same convention as SvgCanvas.
  const escaped = selection.id.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  // querySelectorAll, not querySelector — a driving route renders as
  // three layered paths (edge stripes, asphalt, centreline) all
  // sharing the same `data-site-element-id`. Updating only the first
  // would leave the other two layers parked at the pre-drag geometry,
  // and the user would see the road tearing apart as they dragged.
  const nodes = svgElement.querySelectorAll<SVGElement>(`[${idAttr}="${escaped}"]`);
  if (nodes.length === 0) return;

  if (target.kind === "polygon" || target.kind === "polyline") {
    const d = verticesToPathD(draft.vertices, target.kind === "polygon");
    nodes.forEach((node) => {
      if (node.tagName.toLowerCase() === "path") node.setAttribute("d", d);
    });
    return;
  }

  if (target.kind === "point" && draft.position) {
    // <use> elements carry a transform built by svgBuilder:
    //   translate(x y) scale(1 -1) rotate(deg)
    // Replace it with the draft's position + rotation. Also rewrite
    // width / height / x / y so the size handle has a visible effect.
    const half = draft.size / 2;
    const transform = `translate(${draft.position[0]} ${draft.position[1]}) scale(1 -1) rotate(${draft.rotation})`;
    // Text labels render as `<text>` (with the same transform shape
    // emitted by svgBuilder) and need font-size kept in sync with the
    // draft size so the resize handle has visible feedback.
    const textTransform = `translate(${draft.position[0]} ${draft.position[1]}) scale(1 -1) rotate(${draft.rotation})`;
    const textFontSize = Math.max(0.05, draft.size).toString();
    nodes.forEach((node) => {
      const tag = node.tagName.toLowerCase();
      if (tag === "use") {
        node.setAttribute("transform", transform);
        node.setAttribute("x", String(-half));
        node.setAttribute("y", String(-half));
        node.setAttribute("width", String(draft.size));
        node.setAttribute("height", String(draft.size));
      } else if (tag === "text") {
        node.setAttribute("transform", textTransform);
        node.setAttribute("font-size", textFontSize);
      }
    });
    // Crane radius ring (when present) sits in the same svgBuilder
    // group with `data-site-element-radius="true"` + the same id.
    const radiusNode = svgElement.querySelector<SVGElement>(
      `[${idAttr}="${escaped}"][data-site-element-radius="true"]`,
    );
    if (radiusNode) {
      radiusNode.setAttribute("cx", String(draft.position[0]));
      radiusNode.setAttribute("cy", String(draft.position[1]));
      radiusNode.setAttribute("r", String(draft.radius));
    }
  }
}

function resolveTarget(doc: StoreyDocument, selection: SelectionTarget): ResolvedTarget | null {
  if (selection.kind === "ifc") return null;
  if (selection.kind === "userArea") {
    const area: UserArea | undefined = doc.userAreas.find((candidate) => candidate.id === selection.id);
    if (!area) return null;
    return {
      kind: "polygon",
      vertices: area.polygon.map((v) => [v[0], v[1]] as Vec2),
      pointPosition: null,
      pointRotation: 0,
      pointRadius: 0,
      pointSize: 0,
      pointSecondaryHandle: "none",
    };
  }
  const element: SiteElement | undefined = (doc.siteElements ?? []).find((candidate) => candidate.id === selection.id);
  if (!element) return null;
  if (element.geometry.kind === "polygon") {
    return {
      kind: "polygon",
      vertices: element.geometry.vertices.map((v) => [v[0], v[1]] as Vec2),
      pointPosition: null,
      pointRotation: 0,
      pointRadius: 0,
      pointSize: 0,
      pointSecondaryHandle: "none",
    };
  }
  if (element.geometry.kind === "polyline") {
    return {
      kind: "polyline",
      vertices: element.geometry.vertices.map((v) => [v[0], v[1]] as Vec2),
      pointPosition: null,
      pointRotation: 0,
      pointRadius: 0,
      pointSize: 0,
      pointSecondaryHandle: "none",
    };
  }
  // Text labels reuse the point-edit affordances (drag to move, drag
  // size handle to scale, drag rotation handle to rotate); they just
  // never have a radius reach ring.
  if (element.geometry.kind === "text") {
    const tg = element.geometry;
    return {
      kind: "point",
      vertices: [],
      pointPosition: [tg.position[0], tg.position[1]],
      pointRotation: tg.rotationDeg,
      pointRadius: 0,
      pointSize: tg.sizeWorld,
      pointSecondaryHandle: "size",
    };
  }
  const pg = element.geometry;
  const isCrane = element.category === "crane";
  return {
    kind: "point",
    vertices: [],
    pointPosition: [pg.position[0], pg.position[1]],
    pointRotation: pg.rotationDeg,
    // Crane only: seed an existing radius or the default so the dashed
    // reach ring is immediately grabbable on a freshly placed marker.
    pointRadius: isCrane ? pg.radiusWorld ?? CRANE_DEFAULT_RADIUS : 0,
    pointSize: pg.sizeWorld ?? DEFAULT_POINT_SIZE,
    pointSecondaryHandle: isCrane ? "radius" : "size",
  };
}

function verticesToPathD(vertices: ReadonlyArray<Vec2>, closed: boolean): string {
  if (vertices.length === 0) return "";
  const head = vertices[0]!;
  const segments = [`M ${head[0]} ${head[1]}`];
  for (let i = 1; i < vertices.length; i++) {
    const point = vertices[i]!;
    segments.push(`L ${point[0]} ${point[1]}`);
  }
  if (closed) segments.push("Z");
  return segments.join(" ");
}

/**
 * Escape a string so it's safe to drop inside a CSS attribute selector
 * (e.g. `[data-foo="..."]`). Backslash + double-quote get backslash-
 * escaped per the CSS spec. Mirrors the helper in SvgCanvas so the two
 * files stay independent.
 */
function cssEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/**
 * Convert a screen-pixel distance to world-units at the current viewport
 * zoom. Reads the SVG's CTM and inverts it; falls back to 1 world unit if
 * the SVG isn't measurable yet (first paint).
 */
function pixelsToWorld(svgElement: SVGSVGElement, pixels: number): number {
  const ctm = svgElement.getScreenCTM();
  if (!ctm) return 1;
  const inverse = ctm.inverse();
  const a = svgElement.createSVGPoint();
  const b = svgElement.createSVGPoint();
  b.x = pixels;
  const aw = a.matrixTransform(inverse);
  const bw = b.matrixTransform(inverse);
  return Math.max(0.01, Math.hypot(bw.x - aw.x, bw.y - aw.y));
}
