import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { newId } from "../utils/id";
import type { LabelPosition, SiteElement, SiteElementCategory, StoreyDocument, UserArea, Vec2 } from "../types";
import { SnapEngine, type SnapResult } from "./SnapEngine";
import { AreaNameRegistry } from "./areaStore";
import { useTranslations } from "../i18n";
import { useFloorplanStore } from "../state/floorplanStore";
import { useWorldPointer } from "./useWorldPointer";
import { findCatalogEntry } from "./siteElementCatalog";
import { toHexColor } from "../viewer/colorUtils";
import { applySnapCursor, clearSnapCursor, paintSnapMarker } from "./snapMarker";
import { LabelStyleControls } from "./LabelStyleControls";
import { isTypingInFormField } from "../utils/keyboardFocus";

const SNAP_PIXEL_RADIUS = 12;
const DRAFT_VERTEX_RADIUS_WORLD = 0.08;
const SVG_NS = "http://www.w3.org/2000/svg";

export type PolygonToolMode = "area" | { kind: "site-polygon"; category: SiteElementCategory };

interface PolygonToolProps {
  mode: PolygonToolMode;
  document: StoreyDocument;
  svgRef: RefObject<SVGSVGElement | null>;
}

interface PendingPolygon {
  vertices: Vec2[];
  cursor: Vec2 | null;
  snap: SnapResult | null;
}

/**
 * Click-to-add polygon drawing tool, shared by:
 *   - the user-area workflow (work / takt / other zones) and
 *   - the site-element workflow when the active category is polygon-shaped
 *     (site cabin, demolition area, loading area, parking).
 *
 * The tool always lives inside the active SVG canvas (which gives it the
 * world coordinate system via `getScreenCTM`) and registers its pointer
 * handlers on the canvas's parent container so they survive even when the
 * cursor strays off the existing geometry.
 */
export function PolygonTool({ mode, document: doc, svgRef }: PolygonToolProps): JSX.Element | null {
  const t = useTranslations();
  const upsertSiteElement = useFloorplanStore((state) => state.upsertSiteElement);
  const setStoreyDocument = useFloorplanStore((state) => state.setStoreyDocument);
  const setActiveTool = useFloorplanStore((state) => state.setActiveTool);
  const renderOptions = useFloorplanStore((state) => state.renderOptions);
  const [pending, setPending] = useState<PendingPolygon>({ vertices: [], cursor: null, snap: null });
  const [showNameDialog, setShowNameDialog] = useState(false);
  const [draftName, setDraftName] = useState("");
  const [draftKind, setDraftKind] = useState<UserArea["kind"]>("takt");
  const [draftLabelVisible, setDraftLabelVisible] = useState(true);
  const [draftLabelFontSize, setDraftLabelFontSize] = useState<number>(renderOptions.fontSizeWorld);
  const [draftIconVisible, setDraftIconVisible] = useState<boolean>(true);
  const [draftIconScale, setDraftIconScale] = useState<number>(1);
  const [draftLabelColor, setDraftLabelColor] = useState<string>("#000000");
  const [draftLabelPosition, setDraftLabelPosition] = useState<LabelPosition>("center");
  const [nameError, setNameError] = useState<string | null>(null);
  const altPressedRef = useRef(false);

  // Colour picker state. Polygons (both user areas + site polygons)
  // read primarily by FILL — the swatch tells the user what colour the
  // closed area will paint with. Stroke is a secondary picker.
  const siteCatalog = useMemo(
    () => (typeof mode === "string" ? null : findCatalogEntry(mode.category)),
    [mode],
  );
  const initialFill = typeof mode === "string"
    ? "#e49325" // user-area default = takt-orange-ish, matches the storeyway viewer paints
    : siteCatalog?.fillColor ?? "#0063a3";
  const initialStroke = typeof mode === "string"
    ? "#e49325"
    : siteCatalog?.strokeColor ?? "#0063a3";
  const [fillColor, setFillColor] = useState<string>(() => toHexColor(initialFill));
  const [strokeColor, setStrokeColor] = useState<string>(() => toHexColor(initialStroke));

  const yFlipOffset = doc.boundingBox.yMin + doc.boundingBox.yMax;
  const clientToWorld = useWorldPointer(svgRef, yFlipOffset);
  const snapEngine = useMemo(() => SnapEngine.fromStorey(doc), [doc]);
  // Names must be unique across the whole project, not just this storey, so
  // we subscribe to the entire `storeyDocuments` map and seed the registry
  // from every loaded document.
  const storeyDocuments = useFloorplanStore((state) => state.storeyDocuments);
  const nameRegistry = useMemo(() => {
    const registry = new AreaNameRegistry();
    const allAreas = Object.values(storeyDocuments).flatMap((document) => document.userAreas);
    registry.reset(allAreas);
    return registry;
  }, [storeyDocuments]);

  const finishPolygon = useCallback((): void => {
    if (pending.vertices.length < 3) return;
    setShowNameDialog(true);
  }, [pending.vertices.length]);

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      altPressedRef.current = event.altKey;
      // Don't steal Enter/Escape from a focused text input — the user
      // is naming the area, not finishing the polygon.
      if (isTypingInFormField(event)) return;
      if (event.key === "Escape") {
        setPending({ vertices: [], cursor: null, snap: null });
        setShowNameDialog(false);
      } else if (event.key === "Enter" && pending.vertices.length >= 3) {
        finishPolygon();
      }
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
  }, [pending.vertices.length, finishPolygon]);

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
      if (altPressedRef.current) return null;
      return snapEngine.findNearest(world[0], world[1], pixelRadiusInWorld());
    }

    function onMove(event: PointerEvent): void {
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      const snap = snapFor(world);
      const cursor: Vec2 = snap ? snap.point : world;
      // Switch the canvas cursor itself to the snap-state glyph (X for
      // vertex/endpoint, square for edge) so the user can tell at a
      // glance whether the next click will lock onto a real target.
      applySnapCursor(container, snap);
      setPending((current) => ({ ...current, cursor, snap }));
    }

    function onClick(event: MouseEvent): void {
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      const snap = snapFor(world);
      const point: Vec2 = snap ? snap.point : world;
      // `cursor: point` primes the rubber-band so the next segment is visible
      // before the user moves the mouse.
      setPending((current) => ({ ...current, vertices: [...current.vertices, point], cursor: point, snap }));
    }

    function onDoubleClick(): void {
      if (pending.vertices.length >= 3) finishPolygon();
    }

    // Container reference for cleanup: the snap-state classes must be
    // peeled off when the tool unmounts (Esc / committed shape) or the
    // cursor stays stuck on X / square the next time the user pans.
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
  }, [clientToWorld, snapEngine, svgRef, pending.vertices.length, finishPolygon]);

  function commitArea(): boolean {
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      setNameError(t.areas.emptyName);
      return false;
    }
    if (!nameRegistry.add(trimmed)) {
      setNameError(t.areas.duplicateName);
      return false;
    }
    const area: UserArea = {
      id: newId(),
      name: trimmed,
      kind: draftKind,
      polygon: pending.vertices.slice(),
      createdAt: new Date().toISOString(),
      labelVisible: draftLabelVisible,
      ...(draftLabelVisible && draftLabelFontSize > 0
        ? { labelFontSizeWorld: draftLabelFontSize }
        : {}),
      // Only persist non-default label overrides so future palette
      // changes still apply to areas the user didn't touch.
      ...(draftLabelColor.toLowerCase() !== "#000000" ? { labelColor: draftLabelColor } : {}),
      ...(draftLabelPosition !== "center" ? { labelPosition: draftLabelPosition } : {}),
    };
    setStoreyDocument(doc.storey.expressId, { ...doc, userAreas: [...doc.userAreas, area] });
    return true;
  }

  function commitSitePolygon(): boolean {
    if (typeof mode === "string") return false;
    const trimmed = draftName.trim();
    if (trimmed.length === 0) {
      setNameError(t.areas.emptyName);
      return false;
    }
    const defaultFillHex = toHexColor(siteCatalog?.fillColor ?? "#0063a3");
    const defaultStrokeHex = toHexColor(siteCatalog?.strokeColor ?? "#0063a3");
    const element: SiteElement = {
      id: newId(),
      name: trimmed,
      category: mode.category,
      geometry: { kind: "polygon", vertices: pending.vertices.slice() },
      createdAt: new Date().toISOString(),
      ...(fillColor.toLowerCase() !== defaultFillHex ? { fillColor } : {}),
      ...(strokeColor.toLowerCase() !== defaultStrokeHex ? { strokeColor } : {}),
      // Persist labelVisible only when the user turned it OFF — the
      // renderer defaults to "show" when the field is absent, so we
      // keep the JSON minimal.
      ...(draftLabelVisible ? {} : { labelVisible: false }),
      ...(draftLabelVisible && draftLabelFontSize > 0 && draftLabelFontSize !== renderOptions.fontSizeWorld
        ? { labelFontSizeWorld: draftLabelFontSize }
        : {}),
      ...(draftLabelColor.toLowerCase() !== "#000000" ? { labelColor: draftLabelColor } : {}),
      ...(draftLabelPosition !== "center" ? { labelPosition: draftLabelPosition } : {}),
      // Centroid icon: persist when overriding the default (visible @
      // scale 1.0). Hidden or scaled overrides go in; the renderer
      // treats absent values as "visible @ scale 1".
      ...(draftIconVisible ? {} : { iconVisible: false }),
      ...(draftIconVisible && Math.abs(draftIconScale - 1) > 0.001 ? { iconScale: draftIconScale } : {}),
    };
    upsertSiteElement(doc.storey.expressId, element);
    return true;
  }

  function commit(): void {
    const ok = mode === "area" ? commitArea() : commitSitePolygon();
    if (!ok) return;
    setPending({ vertices: [], cursor: null, snap: null });
    setShowNameDialog(false);
    setDraftName("");
    setNameError(null);
    setActiveTool(null);
  }

  return (
    <>
      {pending.vertices.length > 0 ? <DraftOverlay svgRef={svgRef} yFlipOffset={yFlipOffset} pending={pending} /> : null}
      {showNameDialog ? (
        <div className="dialog" role="dialog" aria-modal="true">
          <div className="dialog__panel">
            <h3 className="dialog__title">
              {mode === "area" ? t.areas.title : t.siteElements.namePromptTitle}
            </h3>
            <div className="field">
              <label className="field__label" htmlFor="area-name-input">
                {t.areas.nameLabel}
              </label>
              <input
                id="area-name-input"
                autoFocus
                type="text"
                className="input"
                value={draftName}
                onChange={(event) => {
                  setDraftName(event.target.value);
                  setNameError(null);
                }}
              />
            </div>
            {mode === "area" ? (
              <>
                <div className="field">
                  <label className="field__label" htmlFor="area-kind-select">
                    {t.areas.kindLabel}
                  </label>
                  <select
                    id="area-kind-select"
                    className="select"
                    value={draftKind}
                    onChange={(event) => setDraftKind(event.target.value as UserArea["kind"])}
                  >
                    <option value="work">{t.areas.kindWork}</option>
                    <option value="takt">{t.areas.kindTakt}</option>
                    <option value="other">{t.areas.kindOther}</option>
                  </select>
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={draftLabelVisible}
                    onChange={(event) => setDraftLabelVisible(event.currentTarget.checked)}
                  />
                  <span>{t.areas.showLabel}</span>
                </label>
                {draftLabelVisible ? (
                  <div className="field">
                    <label className="field__label" htmlFor="area-font-size">
                      {t.areas.labelFontSize}
                    </label>
                    <input
                      id="area-font-size"
                      type="number"
                      className="input input--inline"
                      step={0.1}
                      min={0}
                      max={50}
                      value={draftLabelFontSize}
                      onChange={(event) => {
                        const next = Number(event.currentTarget.value);
                        if (Number.isFinite(next) && next >= 0) setDraftLabelFontSize(next);
                      }}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            {draftLabelVisible ? (
              <LabelStyleControls
                idPrefix="polygon-draft-label"
                color={draftLabelColor}
                position={draftLabelPosition}
                onColorChange={setDraftLabelColor}
                onPositionChange={setDraftLabelPosition}
              />
            ) : null}
            {/* Colour pickers only on site-polygon mode; user-area
              colour is bound to the work/takt/other kind on purpose
              so reports stay legible. */}
            {typeof mode !== "string" ? (
              <>
                <div className="field field--row">
                  <label className="field__label" htmlFor="polygon-fill">
                    {t.selection.fillColor}
                  </label>
                  <input
                    id="polygon-fill"
                    type="color"
                    className="swatch-row__color"
                    value={fillColor}
                    onChange={(event) => setFillColor(event.currentTarget.value)}
                  />
                  <label className="field__label" htmlFor="polygon-stroke">
                    {t.siteElements.strokeColor}
                  </label>
                  <input
                    id="polygon-stroke"
                    type="color"
                    className="swatch-row__color"
                    value={strokeColor}
                    onChange={(event) => setStrokeColor(event.currentTarget.value)}
                  />
                </div>
                <label className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={draftIconVisible}
                    onChange={(event) => setDraftIconVisible(event.currentTarget.checked)}
                  />
                  <span>{t.siteElements.showIcon}</span>
                </label>
                {draftIconVisible ? (
                  <div className="field">
                    <label className="field__label" htmlFor="polygon-icon-scale">
                      {t.siteElements.iconScale}
                    </label>
                    <input
                      id="polygon-icon-scale"
                      type="number"
                      className="input input--inline"
                      step={0.1}
                      min={0.1}
                      max={5}
                      value={draftIconScale}
                      onChange={(event) => {
                        const next = Number(event.currentTarget.value);
                        if (Number.isFinite(next) && next > 0) setDraftIconScale(next);
                      }}
                    />
                  </div>
                ) : null}
              </>
            ) : null}
            {nameError ? <div className="dialog__error">{nameError}</div> : null}
            <div className="btn-row btn-row--end">
              <button type="button" className="btn" onClick={() => setShowNameDialog(false)}>
                {t.areas.cancel}
              </button>
              <button type="button" className="btn btn--primary" onClick={commit}>
                {t.areas.save}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}

interface DraftOverlayProps {
  svgRef: RefObject<SVGSVGElement | null>;
  yFlipOffset: number;
  pending: PendingPolygon;
}

function DraftOverlay({ svgRef, yFlipOffset, pending }: DraftOverlayProps): JSX.Element | null {
  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    let group = svgElement.querySelector<SVGGElement>(".draft-overlay");
    if (!group) {
      group = svgElement.ownerDocument.createElementNS(SVG_NS, "g");
      group.classList.add("draft-overlay");
      group.setAttribute("transform", `translate(0 ${yFlipOffset}) scale(1 -1)`);
      svgElement.appendChild(group);
    }
    group.innerHTML = "";
    if (pending.vertices.length > 0) {
      const points = [...pending.vertices, pending.cursor].filter((value): value is Vec2 => value !== null);
      const path = svgElement.ownerDocument.createElementNS(SVG_NS, "path");
      path.classList.add("draft-polygon");
      path.setAttribute("d", points.map((point, index) => `${index === 0 ? "M" : "L"} ${point[0]} ${point[1]}`).join(" "));
      group.appendChild(path);
      for (const vertex of pending.vertices) {
        const circle = svgElement.ownerDocument.createElementNS(SVG_NS, "circle");
        circle.classList.add("draft-polygon__vertex");
        circle.setAttribute("cx", String(vertex[0]));
        circle.setAttribute("cy", String(vertex[1]));
        circle.setAttribute("r", String(DRAFT_VERTEX_RADIUS_WORLD));
        group.appendChild(circle);
      }
    }
    if (pending.snap) {
      group.appendChild(paintSnapMarker(svgElement, pending.snap));
    }
    return () => {
      group?.remove();
    };
  }, [pending, svgRef, yFlipOffset]);
  return null;
}
