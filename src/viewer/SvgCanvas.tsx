import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { buildStoreySvg } from "../generator/svgBuilder";
import type { SelectionTarget, StoreyDocument, Vec2 } from "../types";
import { computeRenderingBbox, withMargin } from "../utils/bbox";
import { LayerPanel } from "./LayerPanel";
import { SelectionPanel } from "./SelectionPanel";
import { CoordinateOverlay } from "./CoordinateOverlay";
import { DrawingHintBanner } from "./DrawingHintBanner";
import { PolygonTool } from "../annotator/PolygonTool";
import { PolylineTool } from "../annotator/PolylineTool";
import { PointTool } from "../annotator/PointTool";
import { TextTool } from "../annotator/TextTool";
import { BackgroundCalibrateTool } from "../annotator/BackgroundCalibrateTool";
import { EditOverlay } from "../annotator/EditOverlay";
import { findCatalogEntry } from "../annotator/siteElementCatalog";
import { useFloorplanStore, type ToolMode } from "../state/floorplanStore";
import { sanitizeSvgMarkup } from "./sanitizeSvg";

const ZOOM_MIN = 0.05;
const ZOOM_MAX = 200;
const DRAG_THRESHOLD_PIXELS = 2;
const SELECTION_HIGHLIGHT_STROKE_WIDTH = 0.15;
const VIEWBOX_MARGIN_FRACTION = 0.05;

// SelectionTarget moved to `types/index.ts` so the floorplan store and
// any non-canvas component (e.g. the Placed-elements sidebar list) can
// import it without pulling in the whole canvas tree.
export type { SelectionTarget } from "../types";

/**
 * Escape a string so it's safe to embed inside a CSS attribute selector
 * (e.g. `[data-x="..."]`). Backslashes and double-quotes get backslash-
 * escaped per CSS syntax.
 */
function cssAttrEscape(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

interface SvgCanvasProps {
  document: StoreyDocument;
}

interface ViewportTransform {
  x: number;
  y: number;
  scale: number;
}

/**
 * Pan + zoom + selection host for one storey SVG.
 *
 * The SVG markup itself is produced by `buildStoreySvg(doc)`. We render it
 * once into a container `div` and then manipulate visibility / selection /
 * viewBox via direct DOM ops; re-running React's diff on potentially
 * thousands of `<path>` elements would be too slow for large IFCs.
 *
 * Tool integration: the canvas reads `activeTool` from the floorplan store
 * and mounts the matching drawing tool. While any tool is active, pan/zoom
 * is suspended so the tool's pointer handlers don't fight the canvas.
 */
export function SvgCanvas({ document: doc }: SvgCanvasProps): JSX.Element {
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [hideUserAreas, setHideUserAreas] = useState(false);
  const [hideSiteElements, setHideSiteElements] = useState(false);
  const [hideLabels, setHideLabels] = useState(false);
  const [hideBackground, setHideBackground] = useState(false);
  // Selection and edit mode live in the store now so sidebar lists can
  // drive them (clicking a row in Placed elements selects on the
  // canvas, clicking Edit drops into the drag editor). The canvas still
  // owns the click/dblclick gestures but writes through the store.
  const selection = useFloorplanStore((state) => state.selection);
  const editing = useFloorplanStore((state) => state.editing);
  const setSelectionInStore = useFloorplanStore((state) => state.setSelection);
  const setEditingInStore = useFloorplanStore((state) => state.setEditing);
  const setSelection = useCallback(
    (target: SelectionTarget | null) => setSelectionInStore(target),
    [setSelectionInStore],
  );
  const setEditing = useCallback((on: boolean) => setEditingInStore(on), [setEditingInStore]);
  const [cursorWorld, setCursorWorld] = useState<{ x: number; y: number } | null>(null);
  const activeTool = useFloorplanStore((state) => state.activeTool);
  const setActiveTool = useFloorplanStore((state) => state.setActiveTool);
  const copySelection = useFloorplanStore((state) => state.copySelection);
  const pasteClipboard = useFloorplanStore((state) => state.pasteClipboard);
  const undo = useFloorplanStore((state) => state.undo);
  const redo = useFloorplanStore((state) => state.redo);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  // Track the previously-selected DOM node so we can clear its highlight in
  // O(1) instead of scanning every `.ifc-object` path on each selection
  // change — critical for 10k+ element IFC models.
  const previouslySelectedRef = useRef<SVGElement | null>(null);

  const svgMarkup = useMemo(() => buildStoreySvg(doc, { marginFraction: VIEWBOX_MARGIN_FRACTION }), [doc]);
  // Fit-to-screen target. The IFC's own bbox would clip user-added
  // annotations sitting outside the building footprint, so we union it
  // with every piece of user content first.
  const viewBoxBase = useMemo(
    () => withMargin(computeRenderingBbox(doc), VIEWBOX_MARGIN_FRACTION),
    [doc],
  );

  const [transform, setTransform] = useState<ViewportTransform>({ x: 0, y: 0, scale: 1 });
  useEffect(() => setTransform({ x: 0, y: 0, scale: 1 }), [doc.storey.expressId]);
  // Reset edit mode when the storey changes — the new storey's
  // geometry has nothing to do with whatever was being dragged. We
  // intentionally DO NOT auto-reset on selection changes any more;
  // double-click selects + enters edit mode in a single gesture, and
  // resetting on selection change would race the setSelection / setEditing
  // pair and snap us back to non-editing state immediately.
  useEffect(() => setEditing(false), [doc.storey.expressId, setEditing]);
  // IFC objects are read-only — edit mode is meaningful only for the
  // user's own areas and site-plan elements.
  const editingTarget = editing && selection && selection.kind !== "ifc" ? selection : null;

  // Cmd/Ctrl+C / Cmd/Ctrl+V copy + paste the selected user-area or
  // site-element. We only intercept when the focus is on the canvas
  // itself, NOT when the user is typing in a text input — otherwise
  // Cmd+C inside a name input field would steal the OS clipboard copy.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        const editable = target.isContentEditable;
        if (editable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      }
      const meta = event.metaKey || event.ctrlKey;
      if (!meta) return;
      const key = event.key.toLowerCase();
      if (key === "c") {
        copySelection();
        event.preventDefault();
        return;
      }
      if (key === "v") {
        // Offset the paste so it doesn't sit exactly on top of the source.
        // Use the cursor position when available so the paste lands where
        // the user is pointing; fall back to a 1.5 m diagonal nudge.
        pasteClipboard(undefined);
        event.preventDefault();
        return;
      }
      // Undo / redo: Cmd|Ctrl+Z = undo, Cmd|Ctrl+Shift+Z = redo, and
      // Cmd|Ctrl+Y for the Windows muscle-memory crowd.
      if (key === "z" && event.shiftKey) {
        redo();
        event.preventDefault();
        return;
      }
      if (key === "z") {
        undo();
        event.preventDefault();
        return;
      }
      if (key === "y") {
        redo();
        event.preventDefault();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [copySelection, pasteClipboard, undo, redo]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    // Defence-in-depth: the upstream renderer + zod schema already
    // reject malicious inputs, but `innerHTML` is the kind of sink
    // where any future regression turns into script execution. Strip
    // <script> and on*=... attributes once more before mounting.
    container.innerHTML = sanitizeSvgMarkup(svgMarkup);
    const svgElement = container.querySelector("svg");
    if (svgElement instanceof SVGSVGElement) {
      svgElement.setAttribute("preserveAspectRatio", "xMidYMid meet");
      svgElement.classList.add("svg-canvas");
      svgRef.current = svgElement;
    }
  }, [svgMarkup]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    svgElement.querySelectorAll<SVGPathElement>(".ifc-object").forEach((node) => {
      const ifcType = node.getAttribute("data-ifc-type") ?? "";
      node.style.display = hiddenTypes.has(ifcType) ? "none" : "";
    });
    const userGroup = svgElement.querySelector<SVGGElement>(".user-areas");
    if (userGroup) userGroup.style.display = hideUserAreas ? "none" : "";
    const siteGroup = svgElement.querySelector<SVGGElement>(".site-elements");
    if (siteGroup) siteGroup.style.display = hideSiteElements ? "none" : "";
    const labelGroups = svgElement.querySelectorAll<SVGGElement>(".labels");
    labelGroups.forEach((group) => {
      group.style.display = hideLabels ? "none" : "";
    });
    const backgroundGroup = svgElement.querySelector<SVGGElement>(".background-image");
    if (backgroundGroup) backgroundGroup.style.display = hideBackground ? "none" : "";
  }, [hiddenTypes, hideUserAreas, hideSiteElements, hideLabels, hideBackground, svgMarkup]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    // Clear styling on the previously-selected node only — avoids a full
    // O(n) walk of every `.ifc-object` path on each selection change. We
    // always clear BOTH the inline IFC strokes AND the `sel-highlight`
    // class so transitions like ifc -> userArea / userArea -> siteElement
    // un-highlight the prior node regardless of which kind it was.
    // svgMarkup is in the deps because storey switches / doc edits rebuild
    // the SVG from scratch, leaving the ref pointing at a detached node.
    const previous = previouslySelectedRef.current;
    if (previous) {
      previous.style.strokeWidth = "";
      previous.style.stroke = "";
      previous.classList.remove("sel-highlight");
    }
    let nextNode: SVGElement | null = null;
    if (selection?.kind === "ifc") {
      nextNode = svgElement.querySelector<SVGPathElement>(`[data-ifc-guid="${cssAttrEscape(selection.id)}"]`);
      if (nextNode) {
        nextNode.style.strokeWidth = String(SELECTION_HIGHLIGHT_STROKE_WIDTH);
        nextNode.style.stroke = "var(--color-selection)";
      }
    } else if (selection?.kind === "userArea") {
      nextNode = svgElement.querySelector<SVGPathElement>(`.user-area[data-user-area-id="${cssAttrEscape(selection.id)}"]`);
      nextNode?.classList.add("sel-highlight");
    } else if (selection?.kind === "siteElement") {
      nextNode = svgElement.querySelector<SVGElement>(`[data-site-element-id="${cssAttrEscape(selection.id)}"]`);
      nextNode?.classList.add("sel-highlight");
    }
    previouslySelectedRef.current = nextNode;
  }, [selection, svgMarkup]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const baseWidth = viewBoxBase.xMax - viewBoxBase.xMin || 1;
    const baseHeight = viewBoxBase.yMax - viewBoxBase.yMin || 1;
    const scaledWidth = baseWidth / transform.scale;
    const scaledHeight = baseHeight / transform.scale;
    const minX = viewBoxBase.xMin + transform.x - (scaledWidth - baseWidth) / 2;
    const minY = viewBoxBase.yMin + transform.y - (scaledHeight - baseHeight) / 2;
    svgElement.setAttribute("viewBox", `${minX} ${minY} ${scaledWidth} ${scaledHeight}`);
  }, [transform, viewBoxBase]);

  const fitToScreen = useCallback(() => setTransform({ x: 0, y: 0, scale: 1 }), []);
  const toggleType = useCallback((typeName: string) => {
    setHiddenTypes((previous) => {
      const next = new Set(previous);
      if (next.has(typeName)) next.delete(typeName);
      else next.add(typeName);
      return next;
    });
  }, []);

  const clientToWorld = useCallback(
    (clientX: number, clientY: number): Vec2 | null => {
      const svgElement = svgRef.current;
      if (!svgElement) return null;
      const ctm = svgElement.getScreenCTM();
      if (!ctm) return null;
      const inverse = ctm.inverse();
      const point = svgElement.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const transformed = point.matrixTransform(inverse);
      const yFlipOffset = doc.boundingBox.yMin + doc.boundingBox.yMax;
      return [transformed.x, yFlipOffset - transformed.y];
    },
    [doc.boundingBox.yMax, doc.boundingBox.yMin],
  );

  // Pan/zoom + click selection. Suspended while any drawing tool is active
  // OR while we're in edit mode so the EditOverlay's pointer handlers can
  // own the gesture without the pan handler stealing pointermove.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const isDrawing = activeTool !== null;
    const isEditing = editingTarget !== null;
    let dragging = false;
    let lastX = 0;
    let lastY = 0;
    let suppressClick = false;

    function onPointerDown(event: PointerEvent): void {
      if (isDrawing || isEditing) return;
      dragging = true;
      suppressClick = false;
      lastX = event.clientX;
      lastY = event.clientY;
      // DO NOT capture the pointer here. `setPointerCapture` would
      // redirect the click event's target to the container — and the
      // click handler below reads `event.target.closest(...)` to
      // figure out what the user clicked, so capture-on-down breaks
      // selection silently for every drawn element. We capture only
      // AFTER real drag movement is detected (in pointermove below)
      // so panning still tracks the cursor when it leaves the canvas.
    }

    function onPointerMove(event: PointerEvent): void {
      const world = clientToWorld(event.clientX, event.clientY);
      if (world) setCursorWorld({ x: world[0], y: world[1] });
      if (!dragging) return;
      const dx = event.clientX - lastX;
      const dy = event.clientY - lastY;
      if (Math.abs(dx) + Math.abs(dy) > DRAG_THRESHOLD_PIXELS) {
        suppressClick = true;
        // We've confirmed this is a pan, not a click. Capture the
        // pointer now so the pan keeps going if the cursor leaves
        // the canvas — without sacrificing click selection.
        if (container && !container.hasPointerCapture(event.pointerId)) {
          try {
            container.setPointerCapture(event.pointerId);
          } catch {
            // Some browsers throw if the pointer is no longer active
            // (e.g. trackpad inertia after a fling). Safe to ignore.
          }
        }
      }
      lastX = event.clientX;
      lastY = event.clientY;
      const svgElement = svgRef.current;
      if (!svgElement) return;
      const containerRect = svgElement.getBoundingClientRect();
      const width = (viewBoxBase.xMax - viewBoxBase.xMin) / transform.scale;
      const height = (viewBoxBase.yMax - viewBoxBase.yMin) / transform.scale;
      const scaleX = width / containerRect.width;
      const scaleY = height / containerRect.height;
      setTransform((current) => ({ ...current, x: current.x - dx * scaleX, y: current.y - dy * scaleY }));
    }

    function onPointerUp(event: PointerEvent): void {
      dragging = false;
      if (container?.hasPointerCapture(event.pointerId)) {
        container.releasePointerCapture(event.pointerId);
      }
    }

    function onPointerLeave(): void {
      setCursorWorld(null);
    }

    function onClick(event: MouseEvent): void {
      if (isDrawing || suppressClick) return;
      // While editing, clicking on edit-overlay handles is consumed by
      // the overlay — those events never reach this handler. A click on
      // empty canvas is the "exit edit mode" gesture.
      if (isEditing) {
        const eventTarget = event.target;
        if (eventTarget instanceof Element && eventTarget.getAttribute("data-edit-role")) return;
        setEditing(false);
        return;
      }
      const target = event.target;
      // Any single click changes selection — and exiting edit mode if
      // we were in it. Edit mode is re-entered through double-click, so
      // the user always has a clean "click around to inspect, dblclick
      // to start editing" flow.
      setEditing(false);
      if (!(target instanceof Element)) {
        setSelection(null);
        return;
      }
      // Try IFC, user-area, and site-element selection in turn. Each
      // candidate matches by climbing the DOM until we hit the SVG so
      // text labels (which sit in a sibling group) also activate the
      // shape they belong to.
      const ifcPath = target.closest<SVGPathElement>(".ifc-object");
      if (ifcPath) {
        const guid = ifcPath.getAttribute("data-ifc-guid");
        if (guid) {
          setSelection({ kind: "ifc", id: guid });
          return;
        }
      }
      const userAreaNode = target.closest<SVGElement>("[data-user-area-id]");
      if (userAreaNode) {
        const id = userAreaNode.getAttribute("data-user-area-id");
        if (id) {
          setSelection({ kind: "userArea", id });
          return;
        }
      }
      const siteNode = target.closest<SVGElement>("[data-site-element-id]");
      if (siteNode) {
        const id = siteNode.getAttribute("data-site-element-id");
        if (id) {
          setSelection({ kind: "siteElement", id });
          return;
        }
      }
      setSelection(null);
    }

    function onWheel(event: WheelEvent): void {
      // Wheel still works in edit mode so the user can zoom in to fine-
      // tune a vertex placement without leaving the gesture.
      event.preventDefault();
      const factor = event.deltaY > 0 ? 1 / 1.15 : 1.15;
      setTransform((current) => ({ ...current, scale: clamp(current.scale * factor, ZOOM_MIN, ZOOM_MAX) }));
    }

    function onDoubleClick(event: MouseEvent): void {
      // Double-click is the "select + edit" gesture — one motion takes
      // you from cold to dragging vertices. IFC objects are read-only so
      // they're skipped (selecting them still works via single click).
      if (isDrawing) return;
      const eventTarget = event.target;
      if (!(eventTarget instanceof Element)) return;
      const userAreaNode = eventTarget.closest<SVGElement>(`[data-user-area-id]`);
      const siteNode = eventTarget.closest<SVGElement>(`[data-site-element-id]`);
      const userAreaId = userAreaNode?.getAttribute("data-user-area-id");
      const siteId = siteNode?.getAttribute("data-site-element-id");
      if (userAreaId) {
        setSelection({ kind: "userArea", id: userAreaId });
        setEditing(true);
        return;
      }
      if (siteId) {
        setSelection({ kind: "siteElement", id: siteId });
        setEditing(true);
      }
    }

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    container.addEventListener("pointerleave", onPointerLeave);
    container.addEventListener("click", onClick);
    container.addEventListener("dblclick", onDoubleClick);
    container.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
      container.removeEventListener("pointerleave", onPointerLeave);
      container.removeEventListener("click", onClick);
      container.removeEventListener("dblclick", onDoubleClick);
      container.removeEventListener("wheel", onWheel);
    };
  }, [activeTool, transform.scale, viewBoxBase, clientToWorld, selection, editingTarget, setSelection, setEditing]);

  const activeToolElement = renderActiveTool(activeTool, doc, svgRef);

  return (
    <div className="viewer">
      <div
        ref={containerRef}
        className={`viewer__canvas${activeTool ? " viewer__canvas--drawing" : ""}`}
        aria-label="Floorplan SVG canvas"
        role="img"
      />
      {activeToolElement}
      {editingTarget ? (
        <EditOverlay
          document={doc}
          selection={editingTarget}
          svgRef={svgRef}
          onExit={() => setEditing(false)}
        />
      ) : null}
      <LayerPanel
        document={doc}
        hiddenTypes={hiddenTypes}
        hideUserAreas={hideUserAreas}
        hideSiteElements={hideSiteElements}
        hideLabels={hideLabels}
        hideBackground={hideBackground}
        hasBackground={Boolean(doc.backgroundImage)}
        onToggleType={toggleType}
        onToggleUserAreas={() => setHideUserAreas((value) => !value)}
        onToggleSiteElements={() => setHideSiteElements((value) => !value)}
        onToggleLabels={() => setHideLabels((value) => !value)}
        onToggleBackground={() => setHideBackground((value) => !value)}
        drawArea={activeTool?.kind === "area"}
        onToggleDrawArea={() => setActiveTool(activeTool?.kind === "area" ? null : { kind: "area" })}
        onFitToScreen={fitToScreen}
      />
      <SelectionPanel document={doc} selection={selection} onClearSelection={() => setSelection(null)} />
      <CoordinateOverlay
        position={cursorWorld}
        unit={doc.units}
        projectionAxis={doc.renderOptions?.projectionAxis ?? "z"}
      />
      <DrawingHintBanner />
    </div>
  );
}

function renderActiveTool(
  activeTool: ToolMode | null,
  doc: StoreyDocument,
  svgRef: React.RefObject<SVGSVGElement | null>,
): JSX.Element | null {
  if (!activeTool) return null;
  if (activeTool.kind === "area") {
    return <PolygonTool mode="area" document={doc} svgRef={svgRef} />;
  }
  if (activeTool.kind === "background-calibrate") {
    return <BackgroundCalibrateTool document={doc} svgRef={svgRef} />;
  }
  if (activeTool.kind === "site") {
    const entry = findCatalogEntry(activeTool.category);
    if (!entry) return null;
    if (entry.geometryKind === "polygon") {
      return <PolygonTool mode={{ kind: "site-polygon", category: activeTool.category }} document={doc} svgRef={svgRef} />;
    }
    if (entry.geometryKind === "polyline") {
      return <PolylineTool document={doc} svgRef={svgRef} category={activeTool.category} />;
    }
    if (entry.geometryKind === "text") {
      return <TextTool document={doc} svgRef={svgRef} />;
    }
    return <PointTool document={doc} svgRef={svgRef} category={activeTool.category} />;
  }
  return null;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) return min;
  if (value > max) return max;
  return value;
}
