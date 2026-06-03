import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";
import type { RenderOptions } from "../types";

// Text size budget — applies to every label-font-size input in the app.
// The user asked for "zero upwards in 0.1 steps", so we drop the 0.05
// minimum that excluded small labels and let the floor be 0 (meaning
// "no label" effectively, since 0-world-unit text renders nothing).
const FONT_SIZE_MIN = 0;
const FONT_SIZE_MAX = 10;
const FONT_SIZE_STEP = 0.1;
const STROKE_WIDTH_MIN = 0.01;
const STROKE_WIDTH_MAX = 1;
const STROKE_WIDTH_STEP = 0.01;

/**
 * Sidebar panel that configures how the generated SVGs look:
 *   - Whether to draw IFC `Name` or `LongName` as text inside each shape.
 *   - Whether IFC shapes should be filled (per type or a single colour).
 *   - The label font size in world units (so labels scale with the model).
 *
 * Changing any option re-styles every already-rendered storey document in
 * the store — the SVG viewer therefore updates instantly without having to
 * re-run the IFC engine.
 */
export function RenderOptionsPanel(): JSX.Element {
  const t = useTranslations();
  const options = useFloorplanStore((s) => s.renderOptions);
  const setRenderOptions = useFloorplanStore((s) => s.setRenderOptions);
  const update = <K extends keyof RenderOptions>(key: K, value: RenderOptions[K]): void => {
    setRenderOptions({ [key]: value } as Partial<RenderOptions>);
  };
  return (
    <section className="section render-options" aria-labelledby="render-options-title">
      <h2 id="render-options-title" className="section__title">
        {t.renderOptions.title}
      </h2>
      <div className="field">
        <label className="field__label" htmlFor="render-label-source">
          {t.renderOptions.labelSource}
        </label>
        <select
          id="render-label-source"
          className="select"
          value={options.labelSource}
          onChange={(event) => update("labelSource", event.currentTarget.value as RenderOptions["labelSource"])}
        >
          <option value="none">{t.renderOptions.labelNone}</option>
          <option value="name">{t.renderOptions.labelName}</option>
          <option value="longName">{t.renderOptions.labelLongName}</option>
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor="render-fill-style">
          {t.renderOptions.fillStyle}
        </label>
        <select
          id="render-fill-style"
          className="select"
          value={options.fillStyle}
          onChange={(event) => update("fillStyle", event.currentTarget.value as RenderOptions["fillStyle"])}
        >
          <option value="none">{t.renderOptions.fillNone}</option>
          <option value="perType">{t.renderOptions.fillPerType}</option>
          <option value="single">{t.renderOptions.fillSingle}</option>
          <option value="byName">{t.renderOptions.fillByName}</option>
        </select>
      </div>
      {options.fillStyle === "single" ? (
        <div className="field field--row">
          <label className="field__label" htmlFor="render-single-fill">
            {t.renderOptions.singleFillColor}
          </label>
          <input
            id="render-single-fill"
            type="color"
            className="swatch-row__color"
            value={toHexColor(options.singleFillColor)}
            onChange={(event) => update("singleFillColor", event.currentTarget.value)}
          />
        </div>
      ) : null}
      <div className="field">
        <label className="field__label" htmlFor="render-font-size">
          {t.renderOptions.fontSize}
        </label>
        <input
          id="render-font-size"
          type="number"
          className="input input--inline"
          step={FONT_SIZE_STEP}
          min={FONT_SIZE_MIN}
          max={FONT_SIZE_MAX}
          value={options.fontSizeWorld}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            // FONT_SIZE_MIN is 0; we only reject NaN / negative values,
            // letting the user dial down to 0 if they want labels gone.
            if (Number.isFinite(next) && next >= FONT_SIZE_MIN) update("fontSizeWorld", next);
          }}
        />
      </div>
      <div className="field">
        <label className="field__label" htmlFor="render-stroke-width">
          {t.renderOptions.strokeWidth}
        </label>
        <input
          id="render-stroke-width"
          type="number"
          className="input input--inline"
          step={STROKE_WIDTH_STEP}
          min={STROKE_WIDTH_MIN}
          max={STROKE_WIDTH_MAX}
          value={options.strokeWidthWorld}
          onChange={(event) => {
            const next = Number(event.currentTarget.value);
            if (Number.isFinite(next) && next >= STROKE_WIDTH_MIN) update("strokeWidthWorld", next);
          }}
        />
      </div>
    </section>
  );
}

/**
 * The `<input type="color">` element only accepts six-digit hex values. The
 * store may hold rgba()/hex8/named colours (e.g. the default semi-transparent
 * brand blue) — strip alpha and short-form notations to a #rrggbb value so
 * the picker has a sane fallback.
 */
function toHexColor(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const r = value[1] ?? "0";
    const g = value[2] ?? "0";
    const b = value[3] ?? "0";
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return "#0063a3";
}
