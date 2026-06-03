import { useTranslations } from "../i18n";
import { toHexColor } from "../viewer/colorUtils";
import type { LabelPosition } from "../types";

interface LabelStyleControlsProps {
  /** Current label colour or `null`/`undefined` when no override yet
   *  (renderer will fall back to black). */
  color: string | null | undefined;
  /** Current label position or `undefined` when no override yet
   *  (renderer defaults to "center"). */
  position: LabelPosition | undefined;
  /** Disable both inputs (e.g. when "Show label" is off — the values
   *  still persist but editing them is pointless when the label
   *  itself won't render). */
  disabled?: boolean;
  onColorChange: (color: string) => void;
  onPositionChange: (position: LabelPosition) => void;
  /** Optional id prefix so multiple instances on the same screen
   *  (e.g. one in the dialog, one in the selection panel) get
   *  unique input ids for `<label for>` linking. */
  idPrefix?: string;
}

/**
 * Shared "label appearance" form fragment used by every create dialog
 * (PolygonTool, PolylineTool, PointTool), every edit dialog
 * (EditAreaDialog, EditSiteElementDialog), and both selection-panel
 * sub-panels (UserAreaPanel, SiteElementPanel). Centralised so the
 * label-text colour + position controls show up identically wherever
 * the user expects to be able to set them.
 *
 * Colour defaults to black (matches the renderer's fallback). Position
 * defaults to "center" (also the renderer's fallback).
 */
export function LabelStyleControls({
  color,
  position,
  disabled,
  onColorChange,
  onPositionChange,
  idPrefix = "label-style",
}: LabelStyleControlsProps): JSX.Element {
  const t = useTranslations();
  const colorId = `${idPrefix}-color`;
  const positionId = `${idPrefix}-position`;
  const effectiveColor = toHexColor(color ?? "#000000");
  const effectivePosition: LabelPosition = position ?? "center";
  return (
    <>
      <div className="field field--row">
        <label className="field__label" htmlFor={colorId}>
          {t.siteElements.labelColor}
        </label>
        <input
          id={colorId}
          type="color"
          className="swatch-row__color"
          disabled={disabled}
          value={effectiveColor}
          onChange={(event) => onColorChange(event.currentTarget.value)}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor={positionId}>
          {t.siteElements.labelPosition}
        </label>
        <select
          id={positionId}
          className="select"
          disabled={disabled}
          value={effectivePosition}
          onChange={(event) => onPositionChange(event.currentTarget.value as LabelPosition)}
        >
          <option value="center">{t.siteElements.labelPositionCenter}</option>
          <option value="above">{t.siteElements.labelPositionAbove}</option>
          <option value="below">{t.siteElements.labelPositionBelow}</option>
          <option value="left">{t.siteElements.labelPositionLeft}</option>
          <option value="right">{t.siteElements.labelPositionRight}</option>
        </select>
      </div>
    </>
  );
}
