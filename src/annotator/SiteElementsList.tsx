import { useState } from "react";
import type { LabelPosition, SiteElement, StoreyDocument } from "../types";
import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";
import type { Translations } from "../i18n/types";
import { findCatalogEntry } from "./siteElementCatalog";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { toHexColor } from "../viewer/colorUtils";
import { LabelStyleControls } from "./LabelStyleControls";

interface SiteElementsListProps {
  document: StoreyDocument;
}

/**
 * Sidebar list of every site-plan element placed on the current storey.
 * Edit opens a localised rename dialog; Delete opens a styled confirm
 * dialog. Both use the same primitives as the rest of the UI so the
 * extension stays cohesive inside Trimble Connect.
 */
export function SiteElementsList({ document: doc }: SiteElementsListProps): JSX.Element | null {
  const t = useTranslations();
  const elements = doc.siteElements ?? [];
  const deleteSiteElement = useFloorplanStore((state) => state.deleteSiteElement);
  const updateSiteElement = useFloorplanStore((state) => state.updateSiteElement);
  const selection = useFloorplanStore((state) => state.selection);
  const setSelection = useFloorplanStore((state) => state.setSelection);
  const setEditing = useFloorplanStore((state) => state.setEditing);
  // Keep only the editing target's ID in local state; resolve the fresh
  // element from doc on every render. The previous implementation stored
  // the whole `SiteElement` object, so the dialog kept a stale snapshot
  // — number inputs wrote back to the store but the `value` prop never
  // updated, and the user saw the field "ignore" their typing.
  const [editingId, setEditingId] = useState<string | null>(null);
  const editing = editingId ? elements.find((candidate) => candidate.id === editingId) ?? null : null;
  const [pendingDeletion, setPendingDeletion] = useState<SiteElement | null>(null);

  if (elements.length === 0) return null;
  return (
    <section className="section" aria-labelledby="site-elements-list-title">
      <h2 id="site-elements-list-title" className="section__title">
        {t.siteElements.elementsList}
      </h2>
      <ul className="list">
        {elements.map((element) => {
          const isSelected =
            selection?.kind === "siteElement" && selection.id === element.id;
          return (
            <li key={element.id}>
              <div className={`area-card${isSelected ? " area-card--selected" : ""}`}>
                <div className="area-card__header">
                  {/* The clickable target — picks the element as the
                    current selection so the canvas highlight + side
                    panel + every list view land on the same target.
                    The swatch + Edit + Delete buttons are NESTED but
                    stop propagation so they don't double-trigger
                    selection when used. */}
                  <button
                    type="button"
                    className="area-card__name area-card__select"
                    aria-pressed={isSelected}
                    onClick={() => setSelection({ kind: "siteElement", id: element.id })}
                  >
                    <SiteCategorySwatch
                      element={element}
                      onChangeStroke={(color) =>
                        updateSiteElement(doc.storey.expressId, element.id, { strokeColor: color })
                      }
                      onChangeFill={(color) =>
                        updateSiteElement(doc.storey.expressId, element.id, { fillColor: color })
                      }
                    />
                    {element.name}
                  </button>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => {
                        // Select-and-edit in one click: the dialog
                        // is the editor, the canvas should mirror the
                        // selection too so the live preview updates.
                        setSelection({ kind: "siteElement", id: element.id });
                        setEditingId(element.id);
                        setEditing(true);
                      }}
                    >
                      {t.editArea.editButton}
                    </button>
                    <button
                      type="button"
                      className="btn btn--ghost btn--icon"
                      aria-label={`${t.areas.deleteConfirm}: ${element.name}`}
                      onClick={() => setPendingDeletion(element)}
                    >
                      ×
                    </button>
                  </div>
                </div>
                <span className="area-card__kind">{categoryLabel(element, t)}</span>
              </div>
            </li>
          );
        })}
      </ul>
      {editing ? (
        <EditSiteElementDialog
          element={editing}
          storeyExpressId={doc.storey.expressId}
          onClose={() => setEditingId(null)}
        />
      ) : null}
      {pendingDeletion ? (
        <ConfirmDialog
          title={t.areas.deleteConfirm}
          message={pendingDeletion.name}
          destructive
          onConfirm={() => {
            deleteSiteElement(doc.storey.expressId, pendingDeletion.id);
            setPendingDeletion(null);
          }}
          onCancel={() => setPendingDeletion(null)}
        />
      ) : null}
    </section>
  );
}

function categoryLabel(element: SiteElement, t: Translations): string {
  const entry = findCatalogEntry(element.category);
  if (!entry) return element.category;
  return t.siteElements[entry.labelKey];
}

interface EditSiteElementDialogProps {
  element: SiteElement;
  storeyExpressId: number;
  onClose: () => void;
}

/**
 * Full editor for a placed site element. Replaces the earlier rename-only
 * dialog so the Edit button now exposes every property the user could
 * set at creation time — name, colours, label visibility + size, plus
 * geometry-specific knobs (rotation/size/radius for points, width for
 * polylines, stroke width for polygon/polyline).
 *
 * The dialog edits a local copy and dispatches each change through the
 * store immediately so the canvas previews the new values live; closing
 * just discards the dialog (changes are already persisted). Cancel is
 * therefore not a real undo — we keep the button only as a "I'm done,
 * close the modal" shortcut.
 */
function EditSiteElementDialog({ element, storeyExpressId, onClose }: EditSiteElementDialogProps): JSX.Element {
  const t = useTranslations();
  const entry = findCatalogEntry(element.category);
  const renderOptions = useFloorplanStore((state) => state.renderOptions);
  const renameSiteElement = useFloorplanStore((state) => state.renameSiteElement);
  const updateSiteElement = useFloorplanStore((state) => state.updateSiteElement);
  const updateSiteElementGeometry = useFloorplanStore((state) => state.updateSiteElementGeometry);

  const isPoint = element.geometry.kind === "point";
  const isPolyline = element.geometry.kind === "polyline";
  const isPolygon = element.geometry.kind === "polygon";
  const hasStroke = !isPoint;

  const [name, setName] = useState(element.name);
  const fillColor = toHexColor(element.fillColor ?? entry?.fillColor ?? "#0063a3");
  const strokeColor = toHexColor(element.strokeColor ?? entry?.strokeColor ?? "#0063a3");

  function commitName(): void {
    const trimmed = name.trim();
    if (!trimmed || trimmed === element.name) {
      setName(element.name);
      return;
    }
    renameSiteElement(storeyExpressId, element.id, trimmed);
  }

  return (
    <div className="dialog" role="dialog" aria-modal="true">
      <div className="dialog__panel">
        <h3 className="dialog__title">{t.editArea.title}</h3>
        <div className="field">
          <label className="field__label" htmlFor="edit-site-name">
            {t.areas.nameLabel}
          </label>
          <input
            id="edit-site-name"
            autoFocus
            type="text"
            className="input"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onBlur={commitName}
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
            <label className="field__label" htmlFor="edit-site-font">
              {t.areas.labelFontSize}
            </label>
            <input
              id="edit-site-font"
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
              idPrefix="edit-site-label"
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
          <div className="field">
            <label className="field__label" htmlFor="edit-site-stroke-width">
              {t.areas.strokeWidth}
            </label>
            <input
              id="edit-site-stroke-width"
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
        ) : null}
        {isPolyline ? (
          <div className="field">
            <label className="field__label" htmlFor="edit-site-width">
              {t.siteElements.routeWidth}
            </label>
            <input
              id="edit-site-width"
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
            <span className="field__hint">{t.siteElements.routeWidthHint}</span>
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
                <label className="field__label" htmlFor="edit-site-icon-scale">
                  {t.siteElements.iconScale}
                </label>
                <input
                  id="edit-site-icon-scale"
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
        {isPoint ? (
          <>
            <div className="field">
              <label className="field__label" htmlFor="edit-site-size">
                {t.siteElements.size}
              </label>
              <input
                id="edit-site-size"
                type="number"
                className="input input--inline"
                step={0.1}
                min={0.2}
                max={50}
                value={element.geometry.kind === "point" ? element.geometry.sizeWorld ?? 1.5 : 1.5}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next) && next > 0)
                    updateSiteElementGeometry(storeyExpressId, element.id, { sizeWorld: next });
                }}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="edit-site-rotation">
                {t.siteElements.rotation}
              </label>
              <input
                id="edit-site-rotation"
                type="number"
                className="input input--inline"
                step={5}
                value={element.geometry.kind === "point" ? element.geometry.rotationDeg : 0}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next))
                    updateSiteElementGeometry(storeyExpressId, element.id, { rotationDeg: next });
                }}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="edit-site-radius">
                {t.siteElements.radius}
              </label>
              <input
                id="edit-site-radius"
                type="number"
                className="input input--inline"
                step={0.5}
                min={0}
                max={200}
                value={element.geometry.kind === "point" ? element.geometry.radiusWorld ?? 0 : 0}
                onChange={(event) => {
                  const raw = Number(event.currentTarget.value);
                  const next = Number.isFinite(raw) && raw >= 0 ? raw : 0;
                  updateSiteElementGeometry(storeyExpressId, element.id, { radiusWorld: next });
                }}
              />
            </div>
          </>
        ) : null}
        <div className="field field--row">
          {hasStroke ? (
            <>
              <label className="field__label" htmlFor="edit-site-stroke">
                {t.siteElements.strokeColor}
              </label>
              <input
                id="edit-site-stroke"
                type="color"
                className="swatch-row__color"
                value={strokeColor}
                onChange={(event) =>
                  updateSiteElement(storeyExpressId, element.id, { strokeColor: event.currentTarget.value })
                }
              />
            </>
          ) : null}
          {element.geometry.kind === "polygon" || isPoint || (isPolyline && element.geometry.kind === "polyline" && (element.geometry.widthWorld ?? 0) > 0) ? (
            <>
              <label className="field__label" htmlFor="edit-site-fill">
                {t.selection.fillColor}
              </label>
              <input
                id="edit-site-fill"
                type="color"
                className="swatch-row__color"
                value={fillColor}
                onChange={(event) =>
                  updateSiteElement(storeyExpressId, element.id, { fillColor: event.currentTarget.value })
                }
              />
            </>
          ) : null}
        </div>
        <div className="btn-row btn-row--end">
          <button type="button" className="btn btn--primary" onClick={() => { commitName(); onClose(); }}>
            {t.areas.save}
          </button>
        </div>
      </div>
    </div>
  );
}

interface SiteCategorySwatchProps {
  element: SiteElement;
  onChangeStroke: (color: string) => void;
  onChangeFill: (color: string) => void;
}

/**
 * Clickable inline swatch. The visible colour is the element's effective
 * stroke (falls back to the catalog default when the user hasn't
 * overridden it), and the two hidden `<input type="color">` siblings
 * let the user retint stroke or fill straight from the list — no need
 * to open the side panel.
 *
 * We render the emoji on top of the swatch so the row still scans
 * visually for what the element IS, while the surrounding background
 * communicates the current paint colour.
 */
function SiteCategorySwatch({ element, onChangeStroke, onChangeFill }: SiteCategorySwatchProps): JSX.Element {
  const entry = findCatalogEntry(element.category);
  if (!entry) return <span />;
  const effectiveStroke = element.strokeColor ?? entry.strokeColor;
  const effectiveFill = element.fillColor ?? entry.fillColor;
  return (
    <span
      className="site-category-swatch"
      style={
        {
          ["--swatch-stroke" as string]: effectiveStroke,
          ["--swatch-fill" as string]: effectiveFill,
        } as React.CSSProperties
      }
      title={entry.category}
    >
      {/* Same custom icon as the tool-picker for visual consistency
         between sidebar and list. */}
      <span
        className="site-category-swatch__icon"
        aria-hidden="true"
        dangerouslySetInnerHTML={{ __html: entry.iconSvg }}
      />
      {/* Two pickers stacked over halves of the swatch — left half =
         fill, right half = stroke. We keep them keyboard-accessible
         (no `aria-hidden`) so screen readers + keyboard users can
         still set colours. */}
      <input
        type="color"
        className="site-category-swatch__picker site-category-swatch__picker--fill"
        aria-label={`${entry.category} fill colour`}
        value={toHexColor(effectiveFill)}
        onChange={(event) => onChangeFill(event.currentTarget.value)}
      />
      <input
        type="color"
        className="site-category-swatch__picker site-category-swatch__picker--stroke"
        aria-label={`${entry.category} line colour`}
        value={toHexColor(effectiveStroke)}
        onChange={(event) => onChangeStroke(event.currentTarget.value)}
      />
    </span>
  );
}
