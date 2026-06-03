import { useState } from "react";
import type { LabelPosition, SiteElement, StoreyDocument, UserArea } from "../types";
import { useTranslations } from "../i18n";
import { useFloorplanStore } from "../state/floorplanStore";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { findCatalogEntry } from "../annotator/siteElementCatalog";
import { LabelStyleControls } from "../annotator/LabelStyleControls";
import type { SelectionTarget } from "./SvgCanvas";
import { toHexColor } from "./colorUtils";

interface SelectionPanelProps {
  document: StoreyDocument;
  selection: SelectionTarget | null;
  onClearSelection: () => void;
}

/**
 * Floating panel that adapts to whatever the user last clicked on the
 * canvas. Three modes, dispatched by selection kind:
 *
 *   - `ifc` — read-only IFC metadata + per-object fill toggle/colour.
 *   - `userArea` — rename, change kind, toggle label, font size, stroke
 *     width, delete.
 *   - `siteElement` — rename, toggle label, font size, stroke width
 *     (line / polygon), fill colour, size (point markers), rotation,
 *     delete.
 *
 * The panel always sits in the lower-right corner of the viewer; nothing
 * is rendered when the canvas selection is empty.
 */
export function SelectionPanel({ document: doc, selection, onClearSelection }: SelectionPanelProps): JSX.Element | null {
  if (!selection) return null;
  if (selection.kind === "ifc") {
    const object = doc.objects.find((candidate) => candidate.ifcGuid === selection.id);
    if (!object) return null;
    return <IfcObjectPanel object={object} onClose={onClearSelection} />;
  }
  if (selection.kind === "userArea") {
    const area = doc.userAreas.find((candidate) => candidate.id === selection.id);
    if (!area) return null;
    return (
      <UserAreaPanel
        area={area}
        storeyExpressId={doc.storey.expressId}
        onAfterDelete={onClearSelection}
        onClose={onClearSelection}
      />
    );
  }
  const element = (doc.siteElements ?? []).find((candidate) => candidate.id === selection.id);
  if (!element) return null;
  return (
    <SiteElementPanel
      element={element}
      storeyExpressId={doc.storey.expressId}
      onAfterDelete={onClearSelection}
      onClose={onClearSelection}
    />
  );
}

/**
 * Common header for every selection sub-panel — title on the left, X
 * close on the right. The X writes through to whatever `onClose` is —
 * for the canvas selection panel that's `onClearSelection`, which
 * routes to `setSelection(null)` on the store.
 */
function PanelHeader({ title, onClose }: { title: string; onClose: () => void }): JSX.Element {
  return (
    <div className="floating-panel__header">
      <span className="floating-panel__title">{title}</span>
      <button
        type="button"
        className="floating-panel__close"
        aria-label="Close"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}

interface IfcObjectPanelProps {
  object: StoreyDocument["objects"][number];
  onClose: () => void;
}

function IfcObjectPanel({ object, onClose }: IfcObjectPanelProps): JSX.Element {
  const t = useTranslations();
  const renderOptions = useFloorplanStore((state) => state.renderOptions);
  const setObjectStyle = useFloorplanStore((state) => state.setObjectStyle);
  const currentStyle = renderOptions.objectStyles[object.ifcGuid] ?? {};
  const fillVisible = currentStyle.fillVisible !== false && Boolean(currentStyle.fillColor);
  const fillColor = toHexColor(currentStyle.fillColor ?? "#0063a3");

  function update(partial: { fillColor?: string; fillVisible?: boolean }): void {
    const next = { ...currentStyle, ...partial };
    setObjectStyle(object.ifcGuid, next);
  }

  return (
    <div className="floating-panel viewer__selection">
      <PanelHeader title={t.selection.title} onClose={onClose} />
      <dl className="kv-list">
        <dt>{t.selection.type}</dt>
        <dd>{object.ifcType}</dd>
        <dt>{t.selection.name}</dt>
        <dd>{object.name || t.selection.unnamed}</dd>
        {object.longName ? (
          <>
            <dt>{t.selection.longName}</dt>
            <dd>{object.longName}</dd>
          </>
        ) : null}
        <dt>{t.selection.guid}</dt>
        <dd>
          <code>{object.ifcGuid}</code>
        </dd>
      </dl>
      <div className="selection-style">
        <label className="checkbox-row">
          <input
            type="checkbox"
            checked={fillVisible}
            onChange={(event) => {
              if (event.currentTarget.checked) update({ fillVisible: true, fillColor });
              else update({ fillVisible: false });
            }}
          />
          <span>{t.selection.showFill}</span>
        </label>
        {fillVisible ? (
          <div className="field field--row">
            <label className="field__label" htmlFor="selection-fill-color">
              {t.selection.fillColor}
            </label>
            <input
              id="selection-fill-color"
              type="color"
              className="swatch-row__color"
              value={fillColor}
              onChange={(event) => update({ fillColor: event.currentTarget.value, fillVisible: true })}
            />
          </div>
        ) : null}
        {Object.keys(currentStyle).length > 0 ? (
          <button type="button" className="btn btn--small" onClick={() => setObjectStyle(object.ifcGuid, null)}>
            {t.selection.resetStyle}
          </button>
        ) : null}
      </div>
    </div>
  );
}

interface UserAreaPanelProps {
  area: UserArea;
  storeyExpressId: number;
  onAfterDelete: () => void;
  onClose: () => void;
}

function UserAreaPanel({ area, storeyExpressId, onAfterDelete, onClose }: UserAreaPanelProps): JSX.Element {
  const t = useTranslations();
  const renderOptions = useFloorplanStore((state) => state.renderOptions);
  const renameUserArea = useFloorplanStore((state) => state.renameUserArea);
  const changeKind = useFloorplanStore((state) => state.changeUserAreaKind);
  const updateUserAreaStyle = useFloorplanStore((state) => state.updateUserAreaStyle);
  const deleteUserArea = useFloorplanStore((state) => state.deleteUserArea);
  const [pendingDeletion, setPendingDeletion] = useState(false);
  const [name, setName] = useState(area.name);
  const [renameError, setRenameError] = useState<string | null>(null);

  return (
    <div className="floating-panel viewer__selection">
      <PanelHeader title={t.areas.title} onClose={onClose} />
      <div className="field">
        <label className="field__label" htmlFor="sel-area-name">
          {t.areas.nameLabel}
        </label>
        <input
          id="sel-area-name"
          type="text"
          className={`input${renameError ? " input--invalid" : ""}`}
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (!trimmed || trimmed === area.name) {
              setName(area.name);
              setRenameError(null);
              return;
            }
            const ok = renameUserArea(storeyExpressId, area.id, trimmed);
            if (!ok) {
              setRenameError(t.areas.duplicateName);
              setName(area.name);
            } else {
              setRenameError(null);
            }
          }}
        />
        {renameError ? <span className="dialog__error">{renameError}</span> : null}
      </div>
      <div className="field">
        <label className="field__label" htmlFor="sel-area-kind">
          {t.areas.kindLabel}
        </label>
        <select
          id="sel-area-kind"
          className="select"
          value={area.kind}
          onChange={(event) => changeKind(storeyExpressId, area.id, event.currentTarget.value as UserArea["kind"])}
        >
          <option value="work">{t.areas.kindWork}</option>
          <option value="takt">{t.areas.kindTakt}</option>
          <option value="other">{t.areas.kindOther}</option>
        </select>
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={area.labelVisible !== false}
          onChange={(event) => updateUserAreaStyle(storeyExpressId, area.id, { labelVisible: event.currentTarget.checked })}
        />
        <span>{t.areas.showLabel}</span>
      </label>
      {area.labelVisible !== false ? (
        <div className="field">
          <label className="field__label" htmlFor="sel-area-font">
            {t.areas.labelFontSize}
          </label>
          <input
            id="sel-area-font"
            type="number"
            className="input input--inline"
            step={0.1}
            min={0}
            max={50}
            value={area.labelFontSizeWorld ?? renderOptions.fontSizeWorld}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next) && next >= 0)
                updateUserAreaStyle(storeyExpressId, area.id, { labelFontSizeWorld: next });
            }}
          />
          <LabelStyleControls
            idPrefix="sel-area-label"
            color={area.labelColor}
            position={area.labelPosition}
            onColorChange={(color) =>
              updateUserAreaStyle(storeyExpressId, area.id, { labelColor: color })
            }
            onPositionChange={(position: LabelPosition) =>
              updateUserAreaStyle(storeyExpressId, area.id, { labelPosition: position })
            }
          />
        </div>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor="sel-area-stroke">
          {t.areas.strokeWidth}
        </label>
        <input
          id="sel-area-stroke"
          type="number"
          className="input input--inline"
          step={0.01}
          min={0.01}
          max={5}
          value={area.strokeWidthWorld ?? renderOptions.strokeWidthWorld}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next) && next > 0)
              updateUserAreaStyle(storeyExpressId, area.id, { strokeWidthWorld: next });
          }}
        />
      </div>
      <button type="button" className="btn btn--small btn--danger" onClick={() => setPendingDeletion(true)}>
        {t.selection.deleteAction}
      </button>
      {pendingDeletion ? (
        <ConfirmDialog
          title={t.areas.deleteConfirm}
          message={area.name}
          destructive
          onConfirm={() => {
            deleteUserArea(storeyExpressId, area.id);
            setPendingDeletion(false);
            onAfterDelete();
          }}
          onCancel={() => setPendingDeletion(false)}
        />
      ) : null}
    </div>
  );
}

interface SiteElementPanelProps {
  element: SiteElement;
  storeyExpressId: number;
  onAfterDelete: () => void;
  onClose: () => void;
}

function SiteElementPanel({ element, storeyExpressId, onAfterDelete, onClose }: SiteElementPanelProps): JSX.Element {
  const t = useTranslations();
  const renderOptions = useFloorplanStore((state) => state.renderOptions);
  const renameSiteElement = useFloorplanStore((state) => state.renameSiteElement);
  const updateSiteElement = useFloorplanStore((state) => state.updateSiteElement);
  const updateSiteElementGeometry = useFloorplanStore((state) => state.updateSiteElementGeometry);
  const deleteSiteElement = useFloorplanStore((state) => state.deleteSiteElement);
  const [pendingDeletion, setPendingDeletion] = useState(false);
  const [name, setName] = useState(element.name);

  const entry = findCatalogEntry(element.category);
  const categoryLabel = entry ? t.siteElements[entry.labelKey] : element.category;
  const fillColor = toHexColor(element.fillColor ?? entry?.fillColor ?? "#0063a3");
  const strokeColor = toHexColor(element.strokeColor ?? entry?.strokeColor ?? "#0063a3");
  const isPoint = element.geometry.kind === "point";
  const isPolyline = element.geometry.kind === "polyline";
  const isPolygon = element.geometry.kind === "polygon";
  const hasStroke = !isPoint;

  return (
    <div className="floating-panel viewer__selection">
      <PanelHeader title={categoryLabel} onClose={onClose} />
      <div className="field">
        <label className="field__label" htmlFor="sel-site-name">
          {t.areas.nameLabel}
        </label>
        <input
          id="sel-site-name"
          type="text"
          className="input"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (!trimmed || trimmed === element.name) {
              setName(element.name);
              return;
            }
            renameSiteElement(storeyExpressId, element.id, trimmed);
          }}
        />
      </div>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={element.labelVisible !== false}
          onChange={(event) => updateSiteElement(storeyExpressId, element.id, { labelVisible: event.currentTarget.checked })}
        />
        <span>{t.areas.showLabel}</span>
      </label>
      {element.labelVisible !== false ? (
        <div className="field">
          <label className="field__label" htmlFor="sel-site-font">
            {t.areas.labelFontSize}
          </label>
          <input
            id="sel-site-font"
            type="number"
            className="input input--inline"
            step={0.1}
            min={0}
            max={50}
            value={element.labelFontSizeWorld ?? renderOptions.fontSizeWorld}
            onChange={(event) => {
              const next = Number(event.currentTarget.value);
              if (Number.isFinite(next) && next >= 0)
                updateSiteElement(storeyExpressId, element.id, { labelFontSizeWorld: next });
            }}
          />
          <LabelStyleControls
            idPrefix="sel-site-label"
            color={element.labelColor}
            position={element.labelPosition}
            onColorChange={(color) =>
              updateSiteElement(storeyExpressId, element.id, { labelColor: color })
            }
            onPositionChange={(position: LabelPosition) =>
              updateSiteElement(storeyExpressId, element.id, { labelPosition: position })
            }
          />
        </div>
      ) : null}
      {hasStroke ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="sel-site-stroke">
              {t.areas.strokeWidth}
            </label>
            <input
              id="sel-site-stroke"
              type="number"
              className="input input--inline"
              step={0.01}
              min={0.01}
              max={5}
              value={element.strokeWidthWorld ?? renderOptions.strokeWidthWorld * 2}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (Number.isFinite(next) && next > 0)
                  updateSiteElement(storeyExpressId, element.id, { strokeWidthWorld: next });
              }}
            />
          </div>
          <div className="field field--row">
            <label className="field__label" htmlFor="sel-site-stroke-color">
              {t.siteElements.strokeColor}
            </label>
            <input
              id="sel-site-stroke-color"
              type="color"
              className="swatch-row__color"
              value={strokeColor}
              onChange={(event) =>
                updateSiteElement(storeyExpressId, element.id, { strokeColor: event.currentTarget.value })
              }
            />
          </div>
        </>
      ) : null}
      {isPolyline ? (
        <div className="field">
          <label className="field__label" htmlFor="sel-site-width">
            {t.siteElements.routeWidth}
          </label>
          <input
            id="sel-site-width"
            type="number"
            className="input input--inline"
            step={0.1}
            min={0}
            max={50}
            value={element.geometry.kind === "polyline" ? element.geometry.widthWorld ?? 0 : 0}
            onChange={(event) => {
              const raw = Number(event.currentTarget.value);
              const next = Number.isFinite(raw) && raw > 0 ? raw : 0;
              updateSiteElementGeometry(storeyExpressId, element.id, { widthWorld: next });
            }}
          />
        </div>
      ) : null}
      {element.geometry.kind === "polygon" || element.geometry.kind === "point" ? (
        <div className="field field--row">
          <label className="field__label" htmlFor="sel-site-fill">
            {t.selection.fillColor}
          </label>
          <input
            id="sel-site-fill"
            type="color"
            className="swatch-row__color"
            value={fillColor}
            onChange={(event) => updateSiteElement(storeyExpressId, element.id, { fillColor: event.currentTarget.value })}
          />
        </div>
      ) : null}
      {isPolygon ? (
        <>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={element.iconVisible !== false}
              onChange={(event) =>
                updateSiteElement(storeyExpressId, element.id, { iconVisible: event.currentTarget.checked })
              }
            />
            <span>{t.siteElements.showIcon}</span>
          </label>
          {element.iconVisible !== false ? (
            <div className="field">
              <label className="field__label" htmlFor="sel-site-icon-scale">
                {t.siteElements.iconScale}
              </label>
              <input
                id="sel-site-icon-scale"
                type="number"
                className="input input--inline"
                step={0.1}
                min={0.1}
                max={5}
                value={element.iconScale ?? 1}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next) && next > 0)
                    updateSiteElement(storeyExpressId, element.id, { iconScale: next });
                }}
              />
            </div>
          ) : null}
        </>
      ) : null}
      {element.geometry.kind === "point" ? (
        <PointGeometryControls
          storeyExpressId={storeyExpressId}
          elementId={element.id}
          rotationDeg={element.geometry.rotationDeg}
          sizeWorld={element.geometry.sizeWorld ?? 1.5}
          radiusWorld={element.geometry.radiusWorld ?? 0}
          onUpdate={(partial) => updateSiteElementGeometry(storeyExpressId, element.id, partial)}
        />
      ) : null}
      <button type="button" className="btn btn--small btn--danger" onClick={() => setPendingDeletion(true)}>
        {t.selection.deleteAction}
      </button>
      {pendingDeletion ? (
        <ConfirmDialog
          title={t.areas.deleteConfirm}
          message={element.name}
          destructive
          onConfirm={() => {
            deleteSiteElement(storeyExpressId, element.id);
            setPendingDeletion(false);
            onAfterDelete();
          }}
          onCancel={() => setPendingDeletion(false)}
        />
      ) : null}
    </div>
  );
}

interface PointGeometryControlsProps {
  storeyExpressId: number;
  elementId: string;
  rotationDeg: number;
  sizeWorld: number;
  radiusWorld: number;
  onUpdate: (partial: { sizeWorld?: number; rotationDeg?: number; radiusWorld?: number }) => void;
}

function PointGeometryControls({ sizeWorld, rotationDeg, radiusWorld, onUpdate }: PointGeometryControlsProps): JSX.Element {
  const t = useTranslations();
  return (
    <>
      <div className="field">
        <label className="field__label" htmlFor="sel-site-size">
          {t.siteElements.size}
        </label>
        <input
          id="sel-site-size"
          type="number"
          className="input input--inline"
          step={0.1}
          min={0.2}
          max={50}
          value={sizeWorld}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next) && next > 0) onUpdate({ sizeWorld: next });
          }}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="sel-site-rotation">
          {t.siteElements.rotation}
        </label>
        <input
          id="sel-site-rotation"
          type="number"
          className="input input--inline"
          step={5}
          value={rotationDeg}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) onUpdate({ rotationDeg: next });
          }}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="sel-site-radius">
          {t.siteElements.radius}
        </label>
        <input
          id="sel-site-radius"
          type="number"
          className="input input--inline"
          step={0.5}
          min={0}
          max={200}
          value={radiusWorld}
          onChange={(event) => {
            const raw = Number(event.currentTarget.value);
            const next = Number.isFinite(raw) && raw >= 0 ? raw : 0;
            onUpdate({ radiusWorld: next });
          }}
        />
      </div>
    </>
  );
}

