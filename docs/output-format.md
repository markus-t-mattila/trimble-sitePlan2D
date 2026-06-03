# Output format

trimble-sitePlan2D produces **one SVG plus one JSON per IFC storey**,
written either to the active Trimble Connect project's `siteplan2d`
folder (auto-created on first use) or to a single local zip. This document
is the canonical reference for both formats.

## Filenames

```
{ifc-base-name}-{storey-name-or-storey-<expressId>}.{svg|json}
```

- `ifc-base-name` is the source IFC's file name without the `.ifc`
  extension, run through a `[a-z0-9_-]` slugifier.
- `storey-name-or-storey-<expressId>` is the slugified `IfcBuildingStorey`
  name when one exists, or the literal `storey-<expressId>` (using the
  IFC's STEP express id) when it does not. The slug is lowercase and
  capped at 80 characters.

Examples:

```
my-building-l01.svg     my-building-l01.json
my-building-roof.svg    my-building-roof.json
my-building-storey-42.svg   (IFC had no name for that storey)
```

Re-saving with the same filename relies on **Trimble Connect's built-in
auto-versioning**: the existing file gets a new version rather than a
sibling. The extension's "Saved floorplans" panel always opens the latest
version, so editing a previously saved JSON and saving it back creates a
new version of the same file.

## JSON

Every JSON file is validated against the schema in
`src/generator/schema.ts` before being written. Top-level shape:

```jsonc
{
  "schemaVersion": "1.0.0",
  "generatedAt": "2026-06-03T12:34:56.789Z",
  "generator": { "name": "trimble-sitePlan2D", "version": "0.1.0" },
  "source": {
    "fileId":     "abc123",      // Trimble Connect file id of the source IFC
    "versionId":  "xyz987",
    "fileName":   "MyBuilding.ifc",
    "ifcSchema":  "IFC4",        // or null when web-ifc couldn't detect
    "projectId":  "p1",
    "projectName":"My Project"
  },
  "storey": {
    "expressId":  42,            // STEP express id
    "ifcGuid":    "2u5Y3vEXn6vugkqIIugxR_",
    "name":       "L01",
    "longName":   null,
    "elevation":  0.0,
    "unit":       "m"            // mirrors `units` below; convenience
  },
  "units":              "m",     // "m" | "mm" | "cm" | "ft" | "in" | "unknown"
  "boundingBox":        { "xMin": ..., "yMin": ..., "xMax": ..., "yMax": ... },
  "cutHeightAboveStorey": 1.2,   // metres above storey floor at which the section was taken
  "objects": [
    {
      "ifcGuid":  "0aB...",
      "ifcType":  "IfcWall",
      "name":     "Wall-007",
      "longName": "Exterior load-bearing wall",
      "polygons": [
        // Each polygon = outer ring first, holes (if any) after.
        [
          [[x, y], [x, y], [x, y], ...]
        ]
      ]
    }
  ],
  "userAreas": [
    {
      "id":        "a1aa1aa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",  // UUID v4
      "name":      "Takt-A-Floor1-Zone1",                  // unique per project
      "kind":      "takt",                                  // "work" | "takt" | "other"
      "polygon":   [[x, y], [x, y], ...],
      "createdAt": "2026-06-03T12:35:01.000Z",
      // Optional per-area overrides — omitted when at default.
      "strokeWidthWorld":    0.06,
      "strokeColor":         "#0063a3",                     // colour-token allowlist
      "fillColor":           "rgba(0,99,163,0.18)",
      "labelVisible":        true,
      "labelFontSizeWorld":  0.25,
      "labelColor":          "#000000",
      "labelPosition":       "center"                       // "center" | "above" | "below" | "left" | "right"
    }
  ],
  "siteElements": [                              // optional; site-plan overlay
    {
      "id":        "00000000-0000-4000-8000-000000000001",
      "name":      "Tower crane #1",
      "category":  "crane",                       // see Translations.siteElements for the full list
      "geometry": {                               // discriminated union
        "kind":       "point",                    // "point" | "polyline" | "polygon" | "text"
        "position":   [x, y],
        "rotationDeg": 0,
        "sizeWorld":   1.5,                       // point only; default is catalog-driven
        "radiusWorld": 25                         // point only; crane reach ring etc.
      },
      "createdAt": "2026-06-03T12:35:01.000Z",
      // Optional per-element overrides — omitted when at default.
      "strokeWidthWorld":    0.05,
      "strokeColor":         "#003f69",
      "fillColor":           "#0063a3",
      "labelVisible":        true,
      "labelFontSizeWorld":  0.25,
      "labelColor":          "#000000",
      "labelPosition":       "center",
      "iconVisible":         true,                // polygon-area only
      "iconScale":           1.0                  // polygon-area only; centroid-icon multiplier
    },
    {
      "id":        "00000000-0000-4000-8000-000000000002",
      "name":      "Driving route A",
      "category":  "driving-route",
      "geometry": {
        "kind":       "polyline",
        "vertices":   [[x1, y1], [x2, y2], ...],
        "widthWorld": 3.5                          // polyline only; gives the road its 3-layer render
      },
      "createdAt": "2026-06-03T12:35:01.000Z"
    },
    {
      "id":        "00000000-0000-4000-8000-000000000003",
      "name":      "Site reception",
      "category":  "text-label",
      "geometry": {
        "kind":       "text",
        "position":   [x, y],
        "rotationDeg": 0,
        "sizeWorld":  0.5                          // text only; required, sets font-size in world units
      },
      "createdAt": "2026-06-03T12:35:01.000Z"
    }
  ],
  "backgroundImage": {                            // optional; calibrated raster
    // ONLY data:image/(png|jpe?g|webp|gif);base64,... is accepted — the
    // schema rejects every other URL form. SVG-as-data-URL is refused
    // because an attacker-controlled SVG could carry `<script>`.
    "href":         "data:image/png;base64,…",
    "origin":       [x, y],                       // top-left in world units
    "widthWorld":   30,
    "heightWorld":  20,
    "rotationDeg":  0,
    "opacity":      0.65,
    "pixelWidth":   1024,
    "pixelHeight":  768,
    "locked":       false
  },
  "renderOptions": {                              // optional; may be omitted
    "labelSource":         "name",                // "none" | "name" | "longName"
    "userAreaLabelSource": "name",                // "none" | "name"
    "fontSizeWorld":       0.25,
    "fillStyle":           "none",                // "none" | "perType" | "single" | "byName"
    "singleFillColor":     "rgba(0,99,163,0.12)",
    "strokeWidthWorld":    0.05,                  // base stroke width applied to every IFC type
    "projectionAxis":      "z",                   // "x" | "y" | "z"; default "z"
    "typeStyles": {
      "IfcWall": { "strokeColor": "#1c1c1c", "fillColor": "rgba(28,28,28,0.10)" }
    },
    "objectStyles": {
      "0aB...": { "fillColor": "#ff0", "fillVisible": true }   // per-IfcGUID override
    }
  }
}
```

> **Colour fields** anywhere in this document accept only
> `#rgb` / `#rrggbb` / `#rrggbbaa`, `rgb(...)` / `rgba(...)`, the
> literal `transparent` / `currentColor`, or a basic colour name
> allowlist. This is enforced by the zod schema; round-tripping any
> other CSS value is rejected on load. Same for `backgroundImage.href`
> (data-URL allowlist only).


**Coordinates are in world units (the IFC's own length unit).** No origin
reset, no normalisation. Power BI / GIS / custom analytics can use the
values directly.

## SVG

The SVG mirrors the JSON 1:1: every `objects[]` entry is one or more
`<path>` elements, every `userAreas[]` entry is one `<path>` in the
`.user-areas` group. The viewer in the extension reads back the same SVG —
the JSON is the source of truth.

### Element contract

- Root `<svg>` has `viewBox="xMin yMin width height"` matching the world
  bounding box (with a 5% margin by default). It also exposes:
  - `data-unit` — the IFC unit string.
  - `data-storey-guid` — the storey's `IfcGloballyUniqueId`.
  - `data-source-file-id` — the Trimble Connect file id of the source IFC.
  - `data-generator` — `trimble-sitePlan2D-1.0`.
- `<defs><style>...</style></defs>` carries the entire visual contract (see
  below).
- `<metadata>` carries a CDATA-wrapped JSON copy of the high-level fields
  (handy for any pipeline that processes SVGs without loading the JSON).
- Inside `<g class="floorplan" transform="translate(0 yFlip) scale(1 -1)">` (z-order back-to-front):
  - `<g class="background-image">` (optional) carries the calibrated raster background `<image>` element with `data-background="true"`.
  - `<g class="ifc-content">` holds one inner `<g class="ifc-group ifc-<type>-group" data-ifc-type="…">` per IFC type, each carrying the type's `<path>` elements.
  - `<g class="user-areas">` holds user-drawn polygons as `<path>` elements with classes `user-area user-area--<kind>`.
  - `<g class="site-elements">` holds the construction-site overlay: polygons (`.site-element-polygon`), polylines (`.site-element-polyline`), and point symbols (`<use href="#symbol-…" class="site-element-point">`).
  - `<g class="labels …">` groups hold optional `<text>` labels for IFC objects, user areas, and site elements.

### Path attributes

Every `<path>` carries **only** geometry + identity attributes — no inline
`style`, `fill`, or `stroke` attributes. Re-styling is a stylesheet edit, not
an attribute hunt. For IFC paths:

| Attribute              | Meaning                                  |
|------------------------|------------------------------------------|
| `d`                    | Concatenated rings: `M x y L x y … Z`    |
| `class`                | `ifc-object ifc-<lowercase-type>`        |
| `data-ifc-guid`        | `IfcGloballyUniqueId` (22-char encoded)  |
| `data-ifc-type`        | e.g. `IfcWall`                           |
| `data-ifc-name`        | `IfcRoot.Name`                           |
| `data-ifc-long-name`   | `IfcRoot.LongName` (omitted when null)   |

User-area paths:

| Attribute                    | Meaning                                  |
|------------------------------|------------------------------------------|
| `d`                          | Single closed ring                       |
| `class`                      | `user-area user-area--{work|takt|other}` |
| `data-user-area-id`          | UUID v4                                  |
| `data-user-area-name`        | Display name (unique per project)        |
| `data-user-area-kind`        | `work` / `takt` / `other`                |
| `data-user-area-created-at`  | ISO-8601 timestamp                       |

Label text elements (`.ifc-label`, `.user-area-label`) carry
`transform="translate(cx cy) scale(1 -1)"` so the glyphs read upright even
inside the Y-flipped parent group.

### CSS custom properties (the re-skin contract)

Every visual decision is encoded as a CSS custom property in the embedded
stylesheet. A downstream consumer can re-skin the entire SVG by editing the
`<style>` block — no need to touch individual paths.

```css
:root {
  --floorplan-stroke: #1c1c1c;
  --floorplan-stroke-width: 0.05;
  --floorplan-fill: none;                  /* fillStyle="none"   */
                                            /* fillStyle="single" -> the picked colour */
  --floorplan-label-font-family: "Open Sans", "Segoe UI", Roboto, sans-serif;
  --floorplan-label-font-size: 0.25;       /* in world units */
  --floorplan-label-fill: #252a2e;
  --floorplan-label-halo: rgba(255,255,255,0.85);
  --floorplan-user-area-stroke: #e49325;
  --floorplan-user-area-stroke-width: 0.08;
  --floorplan-user-area-fill: rgba(228,147,37,0.18);
  --floorplan-user-area-label-fill: #6a3b0a;
  --floorplan-user-area-work-stroke: #0063a3;
  --floorplan-user-area-takt-stroke: #e49325;
  --floorplan-user-area-other-stroke: #6a6e79;
  /* One pair per IFC type actually present in the storey: */
  --floorplan-ifcwall-stroke: #1c1c1c;
  --floorplan-ifcwall-fill:   /* derived from fillStyle */;
  --floorplan-ifcslab-stroke: #6a6e79;
  --floorplan-ifcslab-fill:   …;
  /* … */
}
```

The class rules then read the variables:

```css
.ifc-object   { fill: var(--floorplan-fill); stroke: var(--floorplan-stroke); … }
.ifc-ifcwall  { stroke: var(--floorplan-ifcwall-stroke); fill: var(--floorplan-ifcwall-fill); }
.user-area    { stroke: var(--floorplan-user-area-stroke); fill: var(--floorplan-user-area-fill); … }
.ifc-label, .user-area-label { font-size: var(--floorplan-label-font-size); … }
```

This makes the SVG **inspectable + editable**: open it in any editor, change
the variable values, save — the drawing updates everywhere.

### Coordinate readback

If you extract a `<path>`'s `d` attribute and parse the `M`/`L` segments,
the coordinates you get are **IFC world XY**. No transforms to invert.

```js
// Example: read every IfcWall centroid out of a generated SVG.
for (const path of svg.querySelectorAll('.ifc-ifcwall')) {
  const d = path.getAttribute('d');   // "M 12.3 4.5 L 12.4 4.5 L ... Z"
  // parse d, compute centroid — coordinates are in IFC world XY.
}
```

## Power BI / GIS hint

Each polygon in the JSON is an ordered list of `[x, y]` world points; the
`units` field (e.g. `"m"`, `"mm"`) tells consumers what one unit means.
Pair the `objects[]` array with the `userAreas[]` array on the same storey
to render a building floor plan with overlaid construction zones.
