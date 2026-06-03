import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";

/**
 * Lets the user pick which IFC product types should be rendered when the
 * generator runs. Only types that have at least one instance in the loaded
 * IFC appear in the list — there's no clutter from types the file doesn't
 * use.
 *
 * The cut height (plan-view section elevation above the storey floor) is
 * tuned in the same panel; 1.2 m is the architectural plan-view default.
 */
export function EntityTypePicker(): JSX.Element | null {
  const t = useTranslations();
  const availableTypes = useFloorplanStore((s) => s.availableTypes);
  const selectedTypes = useFloorplanStore((s) => s.selectedTypes);
  const cutHeightAboveStorey = useFloorplanStore((s) => s.cutHeightAboveStoreyMeters);
  const setSelectedTypes = useFloorplanStore((s) => s.setSelectedTypes);
  const setCutHeight = useFloorplanStore((s) => s.setCutHeightAboveStorey);

  if (availableTypes.length === 0) return null;
  const selectedSet = new Set(selectedTypes);
  return (
    <section className="section" aria-labelledby="entity-picker-title">
      <h2 id="entity-picker-title" className="section__title">
        {t.entityPicker.title}
      </h2>
      <div className="btn-row">
        <button type="button" className="btn btn--small" onClick={() => setSelectedTypes([...availableTypes])}>
          {t.entityPicker.selectAll}
        </button>
        <button type="button" className="btn btn--small" onClick={() => setSelectedTypes([])}>
          {t.entityPicker.clearAll}
        </button>
      </div>
      <ul className="list">
        {availableTypes.map((typeName) => (
          <li key={typeName}>
            <label className="checkbox-row">
              <input
                type="checkbox"
                checked={selectedSet.has(typeName)}
                onChange={(event) => {
                  if (event.currentTarget.checked) {
                    setSelectedTypes([...selectedTypes, typeName]);
                  } else {
                    setSelectedTypes(selectedTypes.filter((type) => type !== typeName));
                  }
                }}
              />
              <span>{typeName}</span>
            </label>
          </li>
        ))}
      </ul>
      <div className="field">
        <label className="field__label" htmlFor="cut-height-input">
          {t.entityPicker.cutHeightLabel}
        </label>
        <input
          id="cut-height-input"
          type="number"
          className="input input--inline"
          step={0.1}
          min={0}
          value={cutHeightAboveStorey}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next)) setCutHeight(next);
          }}
        />
        <span className="field__hint">{t.entityPicker.cutHeightHint}</span>
      </div>
    </section>
  );
}
