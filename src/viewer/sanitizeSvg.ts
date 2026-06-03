/*
Last-line-of-defence sanitiser for the SVG string before it lands in
`container.innerHTML`. The renderer's inputs are zod-validated and the
emitter is careful, but `innerHTML` is the place where any future
regression in those upstream layers becomes script execution. Stripping
`<script>` and event-handler attributes here means a colour-string
typo or an unescaped interpolation can never turn into XSS.

What we strip:
  - any `<script>` element (entire subtree)
  - any attribute whose name starts with `on` (case-insensitive) on any
    element — these are SVG/HTML event handlers
  - `href` / `xlink:href` values that begin with `javascript:` or `data:`
    (except `data:image/...`), to block SVG-href smuggling

We do NOT strip inline `style` attributes because the renderer uses
them legitimately (per-element colour overrides, the layered road
recipe, …). CSS-injection via `style` is bounded by the colour-token
allowlist enforced at the zod schema layer.
*/

const DOM_PARSER = typeof window !== "undefined" ? new DOMParser() : null;
const XML_SERIALIZER =
  typeof window !== "undefined" ? new XMLSerializer() : null;

const SAFE_HREF_DATA_URL = /^data:image\/(?:png|jpe?g|webp|gif);base64,/i;

export function sanitizeSvgMarkup(markup: string): string {
  if (!DOM_PARSER || !XML_SERIALIZER) {
    // Node / jsdom test contexts that don't set up DOMParser get the
    // raw markup back. The Vitest jsdom environment DOES provide it,
    // so this branch only runs in pure-Node unit tests where the SVG
    // never reaches a browser anyway.
    return markup;
  }
  const doc = DOM_PARSER.parseFromString(markup, "image/svg+xml");
  const root = doc.documentElement;
  if (!root || root.nodeName === "parsererror") return "";
  scrubElement(root);
  return XML_SERIALIZER.serializeToString(root);
}

function scrubElement(element: Element): void {
  // First handle the element itself: drop script subtrees outright.
  if (element.tagName.toLowerCase() === "script") {
    element.remove();
    return;
  }
  // Strip all on* event-handler attributes and bad href schemes.
  const attrs = Array.from(element.attributes);
  for (const attr of attrs) {
    const name = attr.name.toLowerCase();
    if (name.startsWith("on")) {
      element.removeAttribute(attr.name);
      continue;
    }
    if (name === "href" || name === "xlink:href") {
      const value = attr.value.trim().toLowerCase();
      if (value.startsWith("javascript:")) {
        element.removeAttribute(attr.name);
        continue;
      }
      // Plain `data:` URLs other than known raster types are rejected
      // (`data:image/svg+xml` can carry script-bearing payloads when
      // used as an SVG `<image>` href in some configurations).
      if (value.startsWith("data:") && !SAFE_HREF_DATA_URL.test(attr.value.trim())) {
        element.removeAttribute(attr.name);
        continue;
      }
    }
  }
  // Recurse. Snapshot the live children list so removals don't shift
  // the iteration cursor.
  const children = Array.from(element.children);
  for (const child of children) {
    scrubElement(child);
  }
}
