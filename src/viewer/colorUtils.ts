/**
 * Coerce any CSS colour string into a 7-char `#rrggbb` form that
 * `<input type="color">` accepts. Browsers reject `rgba()`, named
 * colours, and 4/8-digit hex on that input, so we normalise here.
 *
 * Behaviour:
 *   - `#rrggbb` → lowercased pass-through.
 *   - `#rgb`     → expanded to `#rrggbb`.
 *   - anything else (rgba(), named, etc.) → falls back to the Modus
 *     brand blue so the picker has *something* sensible to show.
 *
 * Used by the side-panel colour fields and by the in-tool naming
 * dialogs so a freshly placed element starts with the colour it'll
 * actually render in.
 */
export function toHexColor(value: string): string {
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(value)) {
    const r = value[1] ?? "0";
    const g = value[2] ?? "0";
    const b = value[3] ?? "0";
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return "#0063a3";
}
