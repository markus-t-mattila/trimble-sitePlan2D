import { useState } from "react";
import type { LabelPosition, StoreyDocument, UserArea } from "../types";
import { useTranslations } from "../i18n";
import { useFloorplanStore } from "../state/floorplanStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { toHexColor } from "../viewer/colorUtils";
import { LabelStyleControls } from "./LabelStyleControls";

interface AreaListProps {
  document: StoreyDocument;
}

const KIND_LABEL_KEYS = {
  work: "kindWork",
  takt: "kindTakt",
  other: "kindOther",
} as const;

/**
 * Sidebar list of every user-drawn area on the currently selected storey.
 * Each entry exposes Edit + Delete actions; Edit opens a modal that lets
 * the user rename the area and change its kind; Delete shows a styled
 * confirmation dialog (no native `window.confirm`).
 */
/** Default fill / stroke for the swatch when the user hasn't picked
 *  a per-area colour. Pulled from the same kind-based palette the CSS
 *  uses so the swatch matches what the canvas paints. */
const KIND_DEFAULTS: Readonly<Record<UserArea["kind"], { stroke: string; fill: string }>> = {
  work: { stroke: "#0063a3", fill: "rgba(0,99,163,0.18)" },
  takt: { stroke: "#e49325", fill: "rgba(228,147,37,0.18)" },
  other: { stroke: "#6a6e79", fill: "rgba(106,110,121,0.18)" },
};

export function AreaList({ document: doc }: AreaListProps): JSX.Element | null {
  const t = useTranslations();
  const deleteUserArea = useFloorplanStore((state) => state.deleteUserArea);
  const updateUserAreaStyle = useFloorplanStore((state) => state.updateUserAreaStyle);
  const selection = useFloorplanStore((state) => state.selection);
  const setSelection = useFloorplanStore((state) => state.setSelection);
  const setEditingFlag = useFloorplanStore((state) => state.setEditing);
  const [editing, setEditing] = useState<UserArea | null>(null);
  const [pendingDeletion, setPendingDeletion] = useState<UserArea | null>(null);

  if (doc.userAreas.length === 0) return null;
  return (
    <section className="section" aria-labelledby="area-list-title">
      <h2 id="area-list-title" className="section__title">
        {t.areas.title}
      </h2>
      <ul className="list">
        {doc.userAreas.map((area) => {
          const kindKey = KIND_LABEL_KEYS[area.kind];
          const isSelected = selection?.kind === "userArea" && selection.id === area.id;
          return (
            <li key={area.id}>
              <div className={`area-card${isSelected ? " area-card--selected" : ""}`}>
                <div className="area-card__header">
                  <button
                    type="button"
                    className="area-card__name area-card__select"
                    aria-pressed={isSelected}
                    onClick={() => setSelection({ kind: "userArea", id: area.id })}
                  >
                    <UserAreaSwatch
                      area={area}
                      onChangeStroke={(color) => updateUserAreaStyle(doc.storey.expressId, area.id, { strokeColor: color })}
                      onChangeFill={(color) => updateUserAreaStyle(doc.storey.expressId, area.id, { fillColor: color })}
                    />
                    {area.name}
                  </button>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => {
                        // Same select-and-edit flow as Placed elements:
                        // canvas highlights, the dialog opens.
                        setSelection({ kind: "userArea", id: area.id });
                        setEditing(area);
                        setEditingFlag(true);
                      }}
                    >
                      {t.editArea.editButton}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon"
                      aria-label={`${t.areas.deleteConfirm}: ${area.name}`}
                      onClick={() => setPendingDeletion(area)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <span className="area-card__kind">{t.areas[kindKey]}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {editing ? (
        <EditAreaDialog
          area={editing}
          storeyExpressId={doc.storey.expressId}
          onClose={() => setEditing(null)}
        />
      ) : null}
      {pendingDeletion ? (
        <ConfirmDialog
          title={t.areas.deleteConfirm}
          message={pendingDeletion.name}
          destructive
          onConfirm={() => {
            deleteUserArea(doc.storey.expressId, pendingDeletion.id);
            setPendingDeletion(null);
          }}
          onCancel={() => setPendingDeletion(null)}
        />
      ) : null}
    </section>
  );
}

/**
 * Clickable colour swatch inline next to the area name — mirror of
 * SiteCategorySwatch in SiteElementsList. Left half = fill picker,
 * right half = stroke picker; both hidden behind the visible square
 * via `opacity: 0`. Stop propagation so opening the picker doesn't
 * double-fire the surrounding "select" button.
 */
function UserAreaSwatch({
  area,
  onChangeStroke,
  onChangeFill,
}: {
  area: UserArea;
  onChangeStroke: (color: string) => void;
  onChangeFill: (color: string) => void;
}): JSX.Element {
  const defaults = KIND_DEFAULTS[area.kind];
  const effectiveStroke = area.strokeColor ?? defaults.stroke;
  const effectiveFill = area.fillColor ?? defaults.fill;
  return (
    <span
      className="site-category-swatch"
      style={
        {
          ["--swatch-stroke" as string]: effectiveStroke,
          ["--swatch-fill" as string]: effectiveFill,
        } as React.CSSProperties
      }
      onClick={(event) => event.stopPropagation()}
    >
      <input
        type="color"
        className="site-category-swatch__picker site-category-swatch__picker--fill"
        aria-label={`${area.name} fill`}
        value={toHexColor(effectiveFill)}
        onChange={(event) => onChangeFill(event.currentTarget.value)}
      />
      <input
        type="color"
        className="site-category-swatch__picker site-category-swatch__picker--stroke"
        aria-label={`${area.name} stroke`}
        value={toHexColor(effectiveStroke)}
        onChange={(event) => onChangeStroke(event.currentTarget.value)}
      />
    </span>
  );
}

interface EditAreaDialogProps {
  area: UserArea;
  storeyExpressId: number;
  onClose: () => void;
}

function EditAreaDialog({ area, storeyExpressId, onClose }: EditAreaDialogProps): JSX.Element {
  const t = useTranslations();
  const renameUserArea = useFloorplanStore((state) => state.renameUserArea);
  const changeKind = useFloorplanStore((state) => state.changeUserAreaKind);
  const updateUserAreaStyle = useFloorplanStore((state) => state.updateUserAreaStyle);
  const renderOptions = useFloorplanStore((state) => state.renderOptions);

  const [name, setName] = useState(area.name);
  const [kind, setKind] = useState<UserArea["kind"]>(area.kind);
  const [labelVisible, setLabelVisible] = useState<boolean>(area.labelVisible ?? true);
  const [labelFontSize, setLabelFontSize] = useState<number>(
    area.labelFontSizeWorld ?? renderOptions.fontSizeWorld,
  );
  const [labelColor, setLabelColor] = useState<string>(area.labelColor ?? "#000000");
  const [labelPosition, setLabelPosition] = useState<LabelPosition>(
    area.labelPosition ?? "center",
  );
  const [strokeWidth, setStrokeWidth] = useState<number>(
    area.strokeWidthWorld ?? Math.max(renderOptions.strokeWidthWorld * 1.6, 0.08),
  );
  const [error, setError] = useState<string | null>(null);

  function attemptSave(): void {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t.areas.emptyName);
      return;
    }
    const renamed = renameUserArea(storeyExpressId, area.id, trimmed);
    if (!renamed) {
      setError(t.areas.duplicateName);
      return;
    }
    changeKind(storeyExpressId, area.id, kind);
    updateUserAreaStyle(storeyExpressId, area.id, {
      labelVisible,
      ...(labelVisible ? { labelFontSizeWorld: labelFontSize } : {}),
      strokeWidthWorld: strokeWidth,
      labelColor,
      labelPosition,
    });
    onClose();
  }

  return (
    <div className="dialog" role="dialog" aria-modal="true">
      <div className="dialog__panel">
        <h3 className="dialog__title">{t.editArea.title}</h3>
        <div className="field">
          <label className="field__label" htmlFor="edit-area-name">
            {t.areas.nameLabel}
          </label>
          <input
            id="edit-area-name"
            autoFocus
            type="text"
            className="input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError(null);
            }}
          />
        </div>
        <div className="field">
          <label className="field__label" htmlFor="edit-area-kind">
            {t.areas.kindLabel}
          </label>
          <select
            id="edit-area-kind"
            className="select"
            value={kind}
            onChange={(event) => setKind(event.target.value as UserArea["kind"])}
          >
            <option value="work">{t.areas.kindWork}</option>
            <option value="takt">{t.areas.kindTakt}</option>
            <option value="other">{t.areas.kindOther}</option>
          </select>
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
            <label className="field__label" htmlFor="edit-area-font">
              {t.areas.labelFontSize}
            </label>
            <input
              id="edit-area-font"
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
              idPrefix="edit-area-label"
              color={labelColor}
              position={labelPosition}
              onColorChange={setLabelColor}
              onPositionChange={setLabelPosition}
            />
          </div>
        ) : null}
        <div className="field">
          <label className="field__label" htmlFor="edit-area-stroke">
            {t.areas.strokeWidth}
          </label>
          <input
            id="edit-area-stroke"
            type="number"
            className="input input--inline"
            step={0.01}
            min={0.01}
            max={1}
            value={strokeWidth}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next) && next > 0) setStrokeWidth(next);
            }}
          />
        </div>
        {error ? <div className="dialog__error">{error}</div> : null}
        <div className="btn-row btn-row--end">
          <button type="button" className="btn" onClick={onClose}>
            {t.areas.cancel}
          </button>
          <button type="button" className="btn btn--primary" onClick={attemptSave} disabled={name.trim().length === 0}>
            {t.areas.save}
          </button>
        </div>
      </div>
    </div>
  );
}
