import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";

/**
 * Selectable list of `IfcBuildingStorey` entries discovered in the open IFC.
 * Storeys are sorted by elevation (lowest first), matching the order a
 * construction supervisor expects when scanning a building bottom-up.
 *
 * Single-select ARIA listbox semantics keep keyboard / screen-reader
 * interaction consistent with the file browser.
 */
export function StoreyList(): JSX.Element | null {
  const t = useTranslations();
  const storeys = useFloorplanStore((s) => s.storeys);
  const selectedStoreyExpressId = useFloorplanStore((s) => s.selectedStoreyExpressId);
  const setSelectedStorey = useFloorplanStore((s) => s.setSelectedStorey);

  if (storeys.length === 0) return null;
  return (
    <section className="section" aria-labelledby="storey-list-title">
      <h2 id="storey-list-title" className="section__title">
        {t.storeyList.title}
      </h2>
      <ul className="list" role="listbox" aria-labelledby="storey-list-title">
        {storeys.map((storey) => (
          <li key={storey.expressId} role="presentation">
            <button
              type="button"
              role="option"
              className="list-item"
              aria-selected={selectedStoreyExpressId === storey.expressId}
              onClick={() => setSelectedStorey(storey.expressId)}
            >
              <span className="list-item__primary">{storey.name || `Storey ${storey.expressId}`}</span>
              <span className="list-item__secondary">
                {t.storeyList.elevation}: {storey.elevation.toFixed(3)}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
