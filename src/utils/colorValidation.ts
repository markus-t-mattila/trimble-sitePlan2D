/*
Colour-string validator used by every schema field that ends up in an
SVG `style="..."` attribute, a CSS rule inside `<style>...</style>`, or
a presentation attribute like `stroke="..."`. The renderer (svgBuilder)
interpolates these strings verbatim, and the rendered SVG is then
written to `container.innerHTML`. Any attacker-controlled JSON that
sneaks unescaped CSS through this pipeline gains arbitrary script
execution. So this validator is the load-bearing defence: anything that
isn't a recognised colour token is rejected at the zod parse boundary
and never reaches the renderer.

Accepted shapes:
  - `#rgb`, `#rgba`, `#rrggbb`, `#rrggbbaa`
  - `rgb(r,g,b)` / `rgba(r,g,b,a)` with integer or percentage channels
  - the literal `transparent` and `currentColor`
  - a short allowlist of named CSS colours that are referenced from the
    catalog defaults (we don't allow the full 140-name CSS list because
    we don't need it and each extra name is more attack surface).

We deliberately do NOT accept `color-mix(...)`, `var(...)`, `url(...)`,
custom CSS functions, or anything containing `;` `}` `"` `'` `<` `>`
`(` `)` outside the bracketed numeric form above.
*/

const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;
// rgb()/rgba() with up to three commas and a single optional alpha. The
// numeric body uses a conservative regex: digits, optional decimal,
// optional `%`, whitespace around commas. Anything funkier is rejected.
const RGB_COLOR =
  /^rgba?\(\s*\d{1,3}%?\s*,\s*\d{1,3}%?\s*,\s*\d{1,3}%?(?:\s*,\s*(?:\d+(?:\.\d+)?|\.\d+))?\s*\)$/;
const NAMED_COLOR_ALLOWLIST = new Set([
  "transparent",
  "currentcolor",
  "black",
  "white",
  "red",
  "green",
  "blue",
  "yellow",
  "orange",
  "purple",
  "gray",
  "grey",
]);

export function isValidColor(value: string): boolean {
  if (typeof value !== "string") return false;
  if (value.length === 0 || value.length > 64) return false;
  if (HEX_COLOR.test(value)) return true;
  if (RGB_COLOR.test(value)) return true;
  return NAMED_COLOR_ALLOWLIST.has(value.toLowerCase());
}

/*
Background image href validator. Anywhere the user can supply an image
reference (background photo, future texture overrides…), we accept only
`data:` URLs with a known raster MIME type. SVG-as-data-URL is rejected
because SVGs can carry `<script>` and event handlers; PDFs are
rejected because they can carry JavaScript actions. The base64 body
itself is opaque to us — the browser decodes it, and image decoders
treat the bytes as pixels.
*/
const DATA_IMAGE_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,[A-Za-z0-9+/=]+$/;

export function isValidBackgroundImageHref(value: string): boolean {
  if (typeof value !== "string") return false;
  // 50 MB-ish ceiling on the base64 string itself; data URLs much
  // larger than that are not worth round-tripping anyway and a hard
  // cap blocks the "billion-laughs by repetition" class of DoS.
  if (value.length === 0 || value.length > 70_000_000) return false;
  return DATA_IMAGE_URL.test(value);
}
