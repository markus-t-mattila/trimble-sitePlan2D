import type { StoreyDocument } from "../types";
import { useTranslations } from "../i18n";

interface LayerPanelProps {
  document: StoreyDocument;
  hiddenTypes: ReadonlySet<string>;
  hideUserAreas: boolean;
  hideSiteElements: boolean;
  hideLabels: boolean;
  hideBackground: boolean;
  hasBackground: boolean;
  onToggleType: (typeName: string) => void;
  onToggleUserAreas: () => void;
  onToggleSiteElements: () => void;
  onToggleLabels: () => void;
  onToggleBackground: () => void;
  drawArea: boolean;
  onToggleDrawArea: () => void;
  onFitToScreen: () => void;
}

/**
 * Floating panel in the viewer's top-left corner. Lets the user toggle the
 * visibility of every renderable layer (IFC types, user areas, site
 * elements, labels, background image), reset pan/zoom, and enter / leave
 * polygon-drawing mode for user areas. Site-element drawing tools live in
 * the sidebar's `SitePlanTools` panel.
 */
export function LayerPanel({
  document: doc,
  hiddenTypes,
  hideUserAreas,
  hideSiteElements,
  hideLabels,
  hideBackground,
  hasBackground,
  onToggleType,
  onToggleUserAreas,
  onToggleSiteElements,
  onToggleLabels,
  onToggleBackground,
  drawArea,
  onToggleDrawArea,
  onFitToScreen,
}: LayerPanelProps): JSX.Element {
  const t = useTranslations();
  const types = Array.from(new Set(doc.objects.map((object) => object.ifcType))).sort();
  return (
    <div className="floating-panel viewer__layers">
      <div className="floating-panel__title">
        <span>{t.viewer.layersTitle}</span>
        <div className="btn-row">
          <button type="button" className="btn btn--small" onClick={onFitToScreen}>
            {t.viewer.fitToScreen}
          </button>
          <button
            type="button"
            className={`btn btn--small${drawArea ? " btn--primary" : ""}`}
            onClick={onToggleDrawArea}
            aria-pressed={drawArea}
          >
            {drawArea ? t.viewer.stopDrawing : t.viewer.drawAreaToggle}
          </button>
        </div>
      </div>
      <ul className="list">
        {types.map((typeName) => (
          <li key={typeName}>
            <label className="checkbox-row">
              <input type="checkbox" checked={!hiddenTypes.has(typeName)} onChange={() => onToggleType(typeName)} />
              <span>{typeName}</span>
            </label>
          </li>
        ))}
        <li>
          <label className="checkbox-row">
            <input type="checkbox" checked={!hideUserAreas} onChange={onToggleUserAreas} />
            <span>{t.viewer.userAreasLayer}</span>
          </label>
        </li>
        <li>
          <label className="checkbox-row">
            <input type="checkbox" checked={!hideSiteElements} onChange={onToggleSiteElements} />
            <span>{t.siteElements.title}</span>
          </label>
        </li>
        <li>
          <label className="checkbox-row">
            <input type="checkbox" checked={!hideLabels} onChange={onToggleLabels} />
            <span>{t.renderOptions.labelSource}</span>
          </label>
        </li>
        {hasBackground ? (
          <li>
            <label className="checkbox-row">
              <input type="checkbox" checked={!hideBackground} onChange={onToggleBackground} />
              <span>{t.background.title}</span>
            </label>
          </li>
        ) : null}
      </ul>
    </div>
  );
}
