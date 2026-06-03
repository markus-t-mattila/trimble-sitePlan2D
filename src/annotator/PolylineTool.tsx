import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { newId } from "../utils/id";
import type { SiteElement, SiteElementCategory, StoreyDocument, Vec2 } from "../types";
import { useTranslations } from "../i18n";
import { useFloorplanStore } from "../state/floorplanStore";
import { SnapEngine, type SnapResult } from "./SnapEngine";
import { useWorldPointer } from "./useWorldPointer";
import { findCatalogEntry } from "./siteElementCatalog";
import { toHexColor } from "../viewer/colorUtils";
import { applySnapCursor, clearSnapCursor, paintSnapMarker } from "./snapMarker";
import { LabelStyleControls } from "./LabelStyleControls";
import type { LabelPosition } from "../types";
import { isTypingInFormField } from "../utils/keyboardFocus";

interface PolylineToolProps {
  document: StoreyDocument;
  svgRef: RefObject<SVGSVGElement | null>;
  category: SiteElementCategory;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const SNAP_PIXEL_RADIUS = 12;

/**
 * Drawing tool for polyline site elements (driving routes, fences). Each
 * click adds a vertex; double-click or Enter finishes the line and opens
 * the naming prompt.
 */
export function PolylineTool({ document: doc, svgRef, category }: PolylineToolProps): JSX.Element | null {
  const t = useTranslations();
  const upsertSiteElement = useFloorplanStore((state) => state.upsertSiteElement);
  const setActiveTool = useFloorplanStore((state) => state.setActiveTool);
  const renderOptions = useFloorplanStore((state) => state.renderOptions);
  const [vertices, setVertices] = useState<Vec2[]>([]);
  const [cursor, setCursor] = useState<Vec2 | null>(null);
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [name, setName] = useState("");
  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const altRef = useRef(false);
  // Same label controls as the polygon/point dialogs — toggle and
  // optional font size. Defaults match the user's chosen global value
  // so a fresh element reads consistently with everything else on the
  // canvas.
  const [labelVisible, setLabelVisible] = useState<boolean>(true);
  const [labelFontSize, setLabelFontSize] = useState<number>(0);
  const [labelColor, setLabelColor] = useState<string>("#000000");
  const [labelPosition, setLabelPosition] = useState<LabelPosition>("center");

  // Default width comes from the catalog entry — driving routes prompt
  // the user with 3.5 m (a typical Finnish urban lane), fences default
  // to 0 (no swept body, just a display line). The user can edit the
  // value freely in the dialog; zero or empty means "no width — keep
  // the polyline as a thin centreline".
  const catalogEntry = useMemo(() => findCatalogEntry(category), [category]);
  const [widthWorld, setWidthWorld] = useState<number>(catalogEntry?.defaultWidthWorld ?? 0);
  // Whether the category supports a width prompt at all. We show the
  // input for every polyline so the user can opt in even on fences; the
  // catalog default just seeds the initial value.
  const showWidthField = true;
  // Per-element colour overrides. Seeded from the catalog default so
  // the picker shows the colour the line WILL render in; if the user
  // doesn't touch them we persist nothing (commit skips identity
  // overrides) so future palette tweaks still apply.
  const [strokeColor, setStrokeColor] = useState<string>(() => toHexColor(catalogEntry?.strokeColor ?? "#0063a3"));
  const [fillColor, setFillColor] = useState<string>(() =>
    toHexColor(catalogEntry?.fillColor === "transparent" ? "#0063a3" : catalogEntry?.fillColor ?? "#0063a3"),
  );
  // Seed the label font-size from the global render option only after
  // the global value is known (renderOptions is read above).
  useEffect(() => {
    if (labelFontSize === 0) setLabelFontSize(renderOptions.fontSizeWorld);
  }, [labelFontSize, renderOptions.fontSizeWorld]);

  const yFlipOffset = doc.boundingBox.yMin + doc.boundingBox.yMax;
  const clientToWorld = useWorldPointer(svgRef, yFlipOffset);
  const snapEngine = useMemo(() => SnapEngine.fromStorey(doc), [doc]);

  const finishLine = useCallback(() => {
    if (vertices.length < 2) return;
    setShowNamePrompt(true);
  }, [vertices.length]);

  // Keyboard: Alt disables snap, Escape cancels, Enter finishes.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      altRef.current = event.altKey;
      // Suppress Enter/Escape while the user is typing into the name
      // dialog — those keys belong to the input, not to the tool.
      if (isTypingInFormField(event)) return;
      if (event.key === "Escape") {
        setVertices([]);
        setShowNamePrompt(false);
      } else if (event.key === "Enter" && vertices.length >= 2) {
        finishLine();
      }
    }
    function onKeyUp(event: KeyboardEvent): void {
      altRef.current = event.altKey;
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
    };
  }, [vertices.length, finishLine]);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const container = svgElement.parentElement;
    if (!container) return;

    function pixelRadiusInWorld(): number {
      if (!svgElement) return 0.5;
      const ctm = svgElement.getScreenCTM();
      if (!ctm) return 0.5;
      const inverse = ctm.inverse();
      const a = svgElement.createSVGPoint();
      const b = svgElement.createSVGPoint();
      b.x = SNAP_PIXEL_RADIUS;
      const aw = a.matrixTransform(inverse);
      const bw = b.matrixTransform(inverse);
      return Math.hypot(bw.x - aw.x, bw.y - aw.y);
    }

    function snapFor(world: Vec2): SnapResult | null {
      if (altRef.current) return null;
      return snapEngine.findNearest(world[0], world[1], pixelRadiusInWorld());
    }

    function onMove(event: PointerEvent): void {
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      const next = snapFor(world);
      // Swap the canvas cursor itself to a snap-state glyph so the
      // user sees at a glance whether the next click locks onto a
      // real target (X = vertex / endpoint, square = somewhere on
      // a line). Reverts to crosshair when the snap lapses.
      applySnapCursor(container, next);
      setSnap(next);
      setCursor(next ? next.point : world);
    }
    function onClick(event: MouseEvent): void {
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      const next = snapFor(world);
      const point = next ? next.point : world;
      setVertices((current) => [...current, point]);
      // Prime the cursor so the rubber-band segment from the last vertex to
      // the cursor is visible the instant the click lands — without this, the
      // user clicks once, sees a single dot, and has to move the mouse before
      // anything updates, which reads as "the tool isn't working".
      setCursor(point);
    }
    function onDoubleClick(): void {
      if (vertices.length >= 2) finishLine();
    }

    // Captured for the cleanup function — when the tool unmounts we
    // peel off the snap-state classes so the cursor isn't stuck on
    // X / square the next time the user pans.
    const containerForCleanup = container;
    container.addEventListener("pointermove", onMove);
    container.addEventListener("click", onClick);
    container.addEventListener("dblclick", onDoubleClick);
    return () => {
      container.removeEventListener("pointermove", onMove);
      container.removeEventListener("click", onClick);
      container.removeEventListener("dblclick", onDoubleClick);
      clearSnapCursor(containerForCleanup);
    };
  }, [clientToWorld, snapEngine, svgRef, vertices.length, finishLine]);

  // Overlay rendering.
  //
  // The driving route gets a LIVE road preview — every cursor move
  // re-paints the layered look (white shoulders + asphalt body +
  // dashed centreline) between the placed waypoints AND between the
  // last waypoint and the current cursor. That's the "road tools
  // that pros use" feel — the user sees the actual road forming
  // under the cursor before they commit each click. Other polylines
  // keep the thin single-stroke preview (a fence doesn't need a
  // multi-layer rendering during drawing).
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    let group = svgElement.querySelector<SVGGElement>(".draft-polyline-overlay");
    if (!group) {
      group = svgElement.ownerDocument.createElementNS(SVG_NS, "g");
      group.classList.add("draft-polyline-overlay");
      group.setAttribute("transform", `translate(0 ${yFlipOffset}) scale(1 -1)`);
      svgElement.appendChild(group);
    }
    group.innerHTML = "";

    if (vertices.length > 0) {
      const points = [...vertices, cursor].filter((value): value is Vec2 => value !== null);
      if (points.length >= 2) {
        const d = points.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" ");
        const isRoad = category === "driving-route" && widthWorld > 0;
        if (isRoad) {
          // Same three-layer recipe as the final renderer in
          // svgBuilder.renderSiteElements — the user sees while
          // drawing exactly what they'll get when the click lands.
          const stripe = Math.min(0.15, widthWorld * 0.06);
          const asphaltWidth = Math.max(0.01, widthWorld - stripe * 2);
          const dash = widthWorld * 0.25;
          const gap = widthWorld * 0.18;
          const asphaltColor = catalogEntry?.strokeColor ?? "#4a4a4a";

          const edges = svgElement.ownerDocument.createElementNS(SVG_NS, "path");
          edges.setAttribute("d", d);
          edges.setAttribute("fill", "none");
          edges.setAttribute("stroke", "#ffffff");
          edges.setAttribute("stroke-width", String(widthWorld));
          edges.setAttribute("stroke-linecap", "butt");
          edges.setAttribute("stroke-linejoin", "miter");
          edges.setAttribute("opacity", "0.95");
          group.appendChild(edges);

          const asphalt = svgElement.ownerDocument.createElementNS(SVG_NS, "path");
          asphalt.setAttribute("d", d);
          asphalt.setAttribute("fill", "none");
          asphalt.setAttribute("stroke", asphaltColor);
          asphalt.setAttribute("stroke-width", String(asphaltWidth));
          asphalt.setAttribute("stroke-linecap", "butt");
          asphalt.setAttribute("stroke-linejoin", "miter");
          asphalt.setAttribute("opacity", "0.85");
          group.appendChild(asphalt);

          const center = svgElement.ownerDocument.createElementNS(SVG_NS, "path");
          center.setAttribute("d", d);
          center.setAttribute("fill", "none");
          center.setAttribute("stroke", "#ffffff");
          center.setAttribute("stroke-width", String(stripe));
          center.setAttribute("stroke-linecap", "butt");
          center.setAttribute("stroke-dasharray", `${dash} ${gap}`);
          group.appendChild(center);
        } else {
          // Non-road polyline (fence, etc.): thin centreline rubber-band.
          const path = svgElement.ownerDocument.createElementNS(SVG_NS, "path");
          path.classList.add("draft-polyline");
          path.setAttribute("d", d);
          group.appendChild(path);
        }
      }

      // Vertex dots on top of the road, so the user can still see
      // where each commit landed. Bigger for road mode so they're
      // visible against the asphalt body.
      const dotRadius = category === "driving-route" && widthWorld > 0
        ? Math.max(0.12, widthWorld * 0.08)
        : 0.08;
      for (const vertex of vertices) {
        const circle = svgElement.ownerDocument.createElementNS(SVG_NS, "circle");
        circle.classList.add("draft-polyline__vertex");
        circle.setAttribute("cx", String(vertex[0]));
        circle.setAttribute("cy", String(vertex[1]));
        circle.setAttribute("r", String(dotRadius));
        group.appendChild(circle);
      }
    }

    if (snap) {
      group.appendChild(paintSnapMarker(svgElement, snap));
    }
    return () => {
      group?.remove();
    };
  }, [vertices, cursor, snap, yFlipOffset, svgRef, category, widthWorld, catalogEntry]);

  function commit(): void {
    const trimmed = name.trim();
    if (!trimmed) return;
    const defaultStrokeHex = toHexColor(catalogEntry?.strokeColor ?? "#0063a3");
    const element: SiteElement = {
      id: newId(),
      name: trimmed,
      category,
      geometry:
        widthWorld > 0
          ? { kind: "polyline", vertices, widthWorld }
          : { kind: "polyline", vertices },
      createdAt: new Date().toISOString(),
      // Stroke is the dominant signal for polylines (the carriageway
      // colour). Skip the override when it's identity-equal to the
      // catalog default so future palette tweaks still apply.
      ...(strokeColor.toLowerCase() !== defaultStrokeHex ? { strokeColor } : {}),
      // Fill is only meaningful when a route width is set (otherwise the
      // line has no body to tint). Persist whatever the user picked when
      // there's a swept carriageway, ignore it otherwise.
      ...(widthWorld > 0 ? { fillColor } : {}),
      ...(labelVisible ? {} : { labelVisible: false }),
      ...(labelVisible && labelFontSize > 0 && labelFontSize !== renderOptions.fontSizeWorld
        ? { labelFontSizeWorld: labelFontSize }
        : {}),
      ...(labelColor.toLowerCase() !== "#000000" ? { labelColor } : {}),
      ...(labelPosition !== "center" ? { labelPosition } : {}),
    };
    upsertSiteElement(doc.storey.expressId, element);
    setVertices([]);
    setShowNamePrompt(false);
    setName("");
    setActiveTool(null);
  }

  if (!showNamePrompt) return null;
  return (
    <div className="dialog" role="dialog" aria-modal="true">
      <div className="dialog__panel">
        <h3 className="dialog__title">{t.siteElements.namePromptTitle}</h3>
        <div className="field">
          <label className="field__label" htmlFor="polyline-name">
            {t.areas.nameLabel}
          </label>
          <input
            id="polyline-name"
            autoFocus
            type="text"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        {showWidthField ? (
          <div className="field">
            <label className="field__label" htmlFor="polyline-width">
              {t.siteElements.routeWidth}
            </label>
            <input
              id="polyline-width"
              type="number"
              className="input input--inline"
              step={0.1}
              min={0}
              max={50}
              value={widthWorld}
              onChange={(event) => {
                const raw = Number(event.currentTarget.value);
                setWidthWorld(Number.isFinite(raw) && raw >= 0 ? raw : 0);
              }}
            />
            <span className="field__hint">{t.siteElements.routeWidthHint}</span>
          </div>
        ) : null}
        <div className="field field--row">
          <label className="field__label" htmlFor="polyline-stroke">
            {t.siteElements.strokeColor}
          </label>
          <input
            id="polyline-stroke"
            type="color"
            className="swatch-row__color"
            value={strokeColor}
            onChange={(event) => setStrokeColor(event.currentTarget.value)}
          />
          {widthWorld > 0 ? (
            <>
              <label className="field__label" htmlFor="polyline-fill">
                {t.selection.fillColor}
              </label>
              <input
                id="polyline-fill"
                type="color"
                className="swatch-row__color"
                value={fillColor}
                onChange={(event) => setFillColor(event.currentTarget.value)}
              />
            </>
          ) : null}
        </div>
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={labelVisible}
            onChange={(event) => setLabelVisible(event.currentTarget.checked)}
          />
          <span>{t.areas.showLabel}</span>
        </label>
        {labelVisible ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor="polyline-font">
                {t.areas.labelFontSize}
              </label>
              <input
                id="polyline-font"
                type="number"
                className="input input--inline"
                step={0.1}
                min={0}
                max={50}
                value={labelFontSize || renderOptions.fontSizeWorld}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next) && next >= 0) setLabelFontSize(next);
                }}
              />
            </div>
            <LabelStyleControls
              idPrefix="polyline-draft-label"
              color={labelColor}
              position={labelPosition}
              onColorChange={setLabelColor}
              onPositionChange={setLabelPosition}
            />
          </>
        ) : null}
        <div className="btn-row btn-row--end">
          <button type="button" className="btn" onClick={() => setShowNamePrompt(false)}>
            {t.areas.cancel}
          </button>
          <button type="button" className="btn btn--primary" onClick={commit} disabled={name.trim().length === 0}>
            {t.areas.save}
          </button>
        </div>
      </div>
    </div>
  );
}
