import { useEffect, useMemo, useState, type RefObject } from "react";
import { newId } from "../utils/id";
import type { LabelPosition, SiteElement, SiteElementCategory, StoreyDocument, Vec2 } from "../types";
import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";
import { useWorldPointer } from "./useWorldPointer";
import { findCatalogEntry } from "./siteElementCatalog";
import { toHexColor } from "../viewer/colorUtils";
import { LabelStyleControls } from "./LabelStyleControls";

interface PointToolProps {
  document: StoreyDocument;
  svgRef: RefObject<SVGSVGElement | null>;
  category: SiteElementCategory;
}

/**
 * Single-click placement tool for point site elements (cranes, gates,
 * cabinets, …). After the user clicks a position, a small modal asks for
 * the element's label.
 */
export function PointTool({ document: doc, svgRef, category }: PointToolProps): JSX.Element | null {
  const t = useTranslations();
  const upsertSiteElement = useFloorplanStore((state) => state.upsertSiteElement);
  const setActiveTool = useFloorplanStore((state) => state.setActiveTool);
  const renderOptions = useFloorplanStore((state) => state.renderOptions);
  const [pendingPoint, setPendingPoint] = useState<Vec2 | null>(null);
  const [name, setName] = useState("");
  const [rotationDeg, setRotationDeg] = useState(0);
  const catalogEntry = useMemo(() => findCatalogEntry(category), [category]);
  // Colour picker state — seeded from the catalog default so a brand-new
  // crane already shows the brand-blue, and the user can override per
  // element either here in the naming dialog or later via the panel.
  const [fillColor, setFillColor] = useState<string>(() => toHexColor(catalogEntry?.fillColor ?? "#0063a3"));
  const [strokeColor, setStrokeColor] = useState<string>(() => toHexColor(catalogEntry?.strokeColor ?? "#0063a3"));
  // Per-element label opt-in + font-size. Default ON with the global
  // font size; the user can opt out, or pick a custom size at creation
  // time so the label is right from the first render.
  const [labelVisible, setLabelVisible] = useState<boolean>(true);
  const [labelFontSize, setLabelFontSize] = useState<number>(renderOptions.fontSizeWorld);
  const [labelColor, setLabelColor] = useState<string>("#000000");
  const [labelPosition, setLabelPosition] = useState<LabelPosition>("center");

  const yFlipOffset = doc.boundingBox.yMin + doc.boundingBox.yMax;
  const clientToWorld = useWorldPointer(svgRef, yFlipOffset);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const container = svgElement.parentElement;
    if (!container) return;
    function onClick(event: MouseEvent): void {
      if (pendingPoint) return;
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      setPendingPoint(world);
    }
    container.addEventListener("click", onClick);
    return () => {
      container.removeEventListener("click", onClick);
    };
  }, [clientToWorld, pendingPoint, svgRef]);

  function commit(): void {
    if (!pendingPoint) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const defaultFillHex = toHexColor(catalogEntry?.fillColor ?? "#0063a3");
    const defaultStrokeHex = toHexColor(catalogEntry?.strokeColor ?? "#0063a3");
    const element: SiteElement = {
      id: newId(),
      name: trimmed,
      category,
      geometry: { kind: "point", position: pendingPoint, rotationDeg },
      createdAt: new Date().toISOString(),
      // Only persist colour overrides when they differ from the catalog
      // default — otherwise we'd inflate the JSON with identity values
      // and break the "category default" rendering for future palette
      // changes.
      ...(fillColor.toLowerCase() !== defaultFillHex ? { fillColor } : {}),
      ...(strokeColor.toLowerCase() !== defaultStrokeHex ? { strokeColor } : {}),
      // labelVisible:false suppresses the label; we only persist the
      // value when it's NOT the default (true) so the schema stays
      // minimal. Same for the font size when it equals the global.
      ...(labelVisible ? {} : { labelVisible: false }),
      ...(labelVisible && labelFontSize > 0 && labelFontSize !== renderOptions.fontSizeWorld
        ? { labelFontSizeWorld: labelFontSize }
        : {}),
      ...(labelColor.toLowerCase() !== "#000000" ? { labelColor } : {}),
      ...(labelPosition !== "center" ? { labelPosition } : {}),
    };
    upsertSiteElement(doc.storey.expressId, element);
    setPendingPoint(null);
    setName("");
    setRotationDeg(0);
    setActiveTool(null);
  }

  function cancel(): void {
    setPendingPoint(null);
    setName("");
    setActiveTool(null);
  }

  if (!pendingPoint) return null;
  return (
    <div className="dialog" role="dialog" aria-modal="true">
      <div className="dialog__panel">
        <h3 className="dialog__title">{t.siteElements.namePromptTitle}</h3>
        <div className="field">
          <label className="field__label" htmlFor="point-name">
            {t.areas.nameLabel}
          </label>
          <input
            id="point-name"
            autoFocus
            type="text"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="point-rotation">
            {t.siteElements.rotation}
          </label>
          <input
            id="point-rotation"
            type="number"
            className="input input--inline"
            step={5}
            value={rotationDeg}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next)) setRotationDeg(next);
            }}
          />
        </div>
        <div className="field field--row">
          <label className="field__label" htmlFor="point-fill">
            {t.selection.fillColor}
          </label>
          <input
            id="point-fill"
            type="color"
            className="swatch-row__color"
            value={fillColor}
            onChange={(event) => setFillColor(event.currentTarget.value)}
          />
          <label className="field__label" htmlFor="point-stroke">
            {t.siteElements.strokeColor}
          </label>
          <input
            id="point-stroke"
            type="color"
            className="swatch-row__color"
            value={strokeColor}
            onChange={(event) => setStrokeColor(event.currentTarget.value)}
          />
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
          <div className="field">
            <label className="field__label" htmlFor="point-font">
              {t.areas.labelFontSize}
            </label>
            <input
              id="point-font"
              type="number"
              className="input input--inline"
              step={0.1}
              min={0}
              max={50}
              value={labelFontSize}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (Number.isFinite(next) && next >= 0) setLabelFontSize(next);
              }}
            />
            <LabelStyleControls
              idPrefix="point-draft-label"
              color={labelColor}
              position={labelPosition}
              onColorChange={setLabelColor}
              onPositionChange={setLabelPosition}
            />
          </div>
        ) : null}
        <div className="btn-row btn-row--end">
          <button type="button" className="btn" onClick={cancel}>
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
