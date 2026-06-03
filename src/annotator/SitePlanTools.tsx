import { useFloorplanStore } from "../state/floorplanStore";
import { SITE_ELEMENT_CATALOG, type SiteElementCatalogEntry } from "./siteElementCatalog";
import { useTranslations } from "../i18n";
import type { Translations } from "../i18n/types";
import type { SiteElementCategory, SiteElementGeometryKind } from "../types";

/**
 * Sidebar tool picker for the construction site-plan elements (cranes,
 * fences, gates, …). Categories are grouped by geometry kind so the
 * supervisor sees the gesture at a glance: lines are drawn with multiple
 * clicks + double-click; areas are closed polygons; markers are placed
 * with a single click.
 *
 * Each pill carries the category's symbol (for point markers) and a
 * coloured left edge that matches what the element will look like on the
 * canvas — so the picker reads visually, not textually.
 */
export function SitePlanTools(): JSX.Element {
  const t = useTranslations();
  const activeTool = useFloorplanStore((state) => state.activeTool);
  const setActiveTool = useFloorplanStore((state) => state.setActiveTool);

  function toggle(category: SiteElementCategory): void {
    if (activeTool?.kind === "site" && activeTool.category === category) {
      setActiveTool(null);
    } else {
      setActiveTool({ kind: "site", category });
    }
  }

  const polylineEntries = SITE_ELEMENT_CATALOG.filter((entry) => entry.geometryKind === "polyline");
  const polygonEntries = SITE_ELEMENT_CATALOG.filter((entry) => entry.geometryKind === "polygon");
  const pointEntries = SITE_ELEMENT_CATALOG.filter((entry) => entry.geometryKind === "point");
  const textEntries = SITE_ELEMENT_CATALOG.filter((entry) => entry.geometryKind === "text");

  const activeCategory: SiteElementCategory | null =
    activeTool && activeTool.kind === "site" ? activeTool.category : null;

  return (
    <section className="section" aria-labelledby="site-plan-tools-title">
      <h2 id="site-plan-tools-title" className="section__title">
        {t.siteElements.title}
      </h2>
      <ToolGroup
        title={geometryGroupTitle("polyline", t)}
        entries={polylineEntries}
        activeCategory={activeCategory}
        onToggle={toggle}
        t={t}
      />
      <ToolGroup
        title={geometryGroupTitle("polygon", t)}
        entries={polygonEntries}
        activeCategory={activeCategory}
        onToggle={toggle}
        t={t}
      />
      <ToolGroup
        title={geometryGroupTitle("point", t)}
        entries={pointEntries}
        activeCategory={activeCategory}
        onToggle={toggle}
        t={t}
      />
      {textEntries.length > 0 ? (
        <ToolGroup
          title={geometryGroupTitle("text", t)}
          entries={textEntries}
          activeCategory={activeCategory}
          onToggle={toggle}
          t={t}
        />
      ) : null}
      <p className="field__hint">{t.siteElements.drawHint}</p>
    </section>
  );
}

function geometryGroupTitle(kind: SiteElementGeometryKind, t: Translations): string {
  switch (kind) {
    case "polyline":
      return t.siteElements.groupLines;
    case "polygon":
      return t.siteElements.groupAreas;
    case "point":
      return t.siteElements.groupMarkers;
    case "text":
      return t.siteElements.groupText;
    default:
      return "";
  }
}

interface ToolGroupProps {
  title: string;
  entries: ReadonlyArray<SiteElementCatalogEntry>;
  activeCategory: SiteElementCategory | null;
  onToggle: (category: SiteElementCategory) => void;
  t: Translations;
}

function ToolGroup({ title, entries, activeCategory, onToggle, t }: ToolGroupProps): JSX.Element {
  return (
    <div className="site-tools__group">
      <h3 className="site-tools__group-title">{title}</h3>
      <div className="btn-row">
        {entries.map((entry) => {
          const isActive = activeCategory === entry.category;
          return (
            <button
              key={entry.category}
              type="button"
              className={`site-tool-button${isActive ? " site-tool-button--active" : ""}`}
              aria-pressed={isActive}
              onClick={() => onToggle(entry.category)}
            >
              {/* Custom-designed SVG icon — see siteElementCatalog.ts.
                 Inherits its colour from the button's `--site-tool-color`
                 inline variable below, so each tool reads in its
                 category's brand colour without per-icon assets. */}
              <span
                className="site-tool-button__icon"
                aria-hidden="true"
                style={{ ["--site-tool-color" as string]: entry.strokeColor } as React.CSSProperties}
                dangerouslySetInnerHTML={{ __html: entry.iconSvg }}
              />
              <span className="site-tool-button__label">{t.siteElements[entry.labelKey]}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
