import { useEffect, useState, type RefObject } from "react";
import { newId } from "../utils/id";
import type { SiteElement, StoreyDocument, Vec2 } from "../types";
import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";
import { useWorldPointer } from "./useWorldPointer";

interface TextToolProps {
  document: StoreyDocument;
  svgRef: RefObject<SVGSVGElement | null>;
}

/**
 * Free-text annotation tool.
 *
 * The user single-clicks anywhere on the canvas to place the text
 * anchor, then a small dialog asks for the actual text content + the
 * font size + a colour. After commit, the element behaves like any
 * other site element: it sits in the same store list, shows up in
 * "Placed elements", and the EditOverlay lets the user drag it,
 * scale it, and rotate it with the rotation handle (same gestures
 * as a point marker).
 *
 * Kept structurally similar to PointTool so the muscle memory of
 * "click to place, dialog for details, commit" carries over.
 */
export function TextTool({ document: doc, svgRef }: TextToolProps): JSX.Element | null {
  const t = useTranslations();
  const upsertSiteElement = useFloorplanStore((state) => state.upsertSiteElement);
  const setActiveTool = useFloorplanStore((state) => state.setActiveTool);
  const renderOptions = useFloorplanStore((state) => state.renderOptions);
  const [pendingPosition, setPendingPosition] = useState<Vec2 | null>(null);
  const [text, setText] = useState("");
  const [color, setColor] = useState("#000000");
  // Default size: 1.2 m so the text reads at typical floor-plan zoom
  // levels. Smaller than a point marker (1.5 m) because text-only
  // labels usually want to sit unobtrusively on top of geometry.
  const [size, setSize] = useState(1.2);

  const yFlipOffset = doc.boundingBox.yMin + doc.boundingBox.yMax;
  const clientToWorld = useWorldPointer(svgRef, yFlipOffset);

  useEffect(() => {
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const container = svgElement.parentElement;
    if (!container) return;
    function onClick(event: MouseEvent): void {
      if (pendingPosition) return;
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      setPendingPosition(world);
    }
    container.addEventListener("click", onClick);
    return () => container.removeEventListener("click", onClick);
  }, [clientToWorld, pendingPosition, svgRef]);

  // Esc cancels the placement.
  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      setPendingPosition(null);
      setText("");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function commit(): void {
    if (!pendingPosition) return;
    const trimmed = text.trim();
    if (!trimmed) return;
    const element: SiteElement = {
      id: newId(),
      name: trimmed,
      category: "text-label",
      geometry: {
        kind: "text",
        position: pendingPosition,
        rotationDeg: 0,
        sizeWorld: size,
      },
      createdAt: new Date().toISOString(),
      // The text colour is THE primary attribute for a text element —
      // store it as the label colour. Stroke / fill on a <text> are
      // both consumed by `labelColor` via svgBuilder.
      labelColor: color,
      labelVisible: true,
      labelFontSizeWorld: size,
    };
    upsertSiteElement(doc.storey.expressId, element);
    setPendingPosition(null);
    setText("");
    setActiveTool(null);
  }

  function cancel(): void {
    setPendingPosition(null);
    setText("");
    setActiveTool(null);
  }

  if (!pendingPosition) return null;
  return (
    <div className="dialog" role="dialog" aria-modal="true">
      <div className="dialog__panel">
        <h3 className="dialog__title">{t.siteElements.textLabel}</h3>
        <div className="field">
          <label className="field__label" htmlFor="text-content">
            {t.siteElements.textContent}
          </label>
          <input
            id="text-content"
            autoFocus
            type="text"
            className="input"
            value={text}
            onChange={(event) => setText(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && text.trim().length > 0) commit();
            }}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="text-size">
            {t.siteElements.size}
          </label>
          <input
            id="text-size"
            type="number"
            className="input input--inline"
            step={0.1}
            min={0.1}
            max={50}
            value={size || renderOptions.fontSizeWorld}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next) && next > 0) setSize(next);
            }}
          />
        </div>
        <div className="field field--row">
          <label className="field__label" htmlFor="text-color">
            {t.siteElements.labelColor}
          </label>
          <input
            id="text-color"
            type="color"
            className="swatch-row__color"
            value={color}
            onChange={(event) => setColor(event.currentTarget.value)}
          />
        </div>
        <div className="btn-row btn-row--end">
          <button type="button" className="btn" onClick={cancel}>
            {t.areas.cancel}
          </button>
          <button type="button" className="btn btn--primary" onClick={commit} disabled={text.trim().length === 0}>
            {t.areas.save}
          </button>
        </div>
      </div>
    </div>
  );
}
