# trimble-sitePlan2D

A Trimble Connect extension that turns IFC building models into per-storey
2D floorplans — one SVG and one JSON per `IfcBuildingStorey` — while
preserving the original IFC world coordinates. Site supervisors and engineers
use it to plan work and takt zones on top of the building, and to feed clean,
georeferenced data into downstream tools (Power BI, GIS, custom dashboards).

Bundled with **Vite + React + TypeScript**, geometry parsing via
**[`web-ifc`](https://www.npmjs.com/package/web-ifc)** running in a Web
Worker, MIT-licensed, hosted on **GitHub Pages**.

## Features

- **IFC → SVG + JSON, per storey.** Each `IfcBuildingStorey` produces a
  `.svg` (plan drawing of the user-selected entity types) and a `.json`
  (machine-readable: every shape's `IfcGUID`, `Name`, `LongName`, corner
  coordinates, plus user-area metadata).
- **Original world coordinates preserved.** The SVG `viewBox` matches the
  storey's world bounding box; an inner `<g transform="scale(1,-1)…">` flips
  Y so when a downstream tool reads a path's `d` attribute, the coordinates
  equal IFC world XY. No origin reset, no scaling — Power BI / GIS get
  geographically meaningful values.
- **Tight sheet sizing.** The SVG `viewBox` hugs the geometry's bounding box
  (with a small, configurable margin). No empty whitespace, even when the
  building sits far from the IFC origin.
- **User picks entity types.** `IfcWall`, `IfcSlab`, `IfcDoor`, … — anything
  the IFC actually contains. Cut height above the storey (the architectural
  plan section level) is tunable; default `1.2 m`.
- **In-app SVG viewer.** Pan, zoom, layer toggles (per IFC type and per the
  user-areas layer), click-to-select with full IFC metadata, cursor world
  coordinates pinned in the corner.
- **Sketch named work / takt zones.** Polygon tool with optional snap to IFC
  corners/edges and to previously drawn user areas. Hold **Alt** to skip
  snap for one click. Names must be unique per project; the result is saved
  inside the SVG and JSON as a complement to the IFC-derived shapes.
- **Render options (per render).** Choose whether shapes carry an `Name` or
  `LongName` label drawn at the centroid, the label font size (in world
  units), and whether shapes are filled (none / per IFC type / single
  colour). All visuals live inside the SVG's `<style>` block as CSS custom
  properties, so a downstream consumer can re-skin every drawing by editing
  one block.
- **Localised UI.** Default English with a full Finnish translation. The
  locale is auto-detected from the active Trimble Connect user profile;
  there is no manual override surface. See
  [docs/localization.md](./docs/localization.md) for the detection order
  and how to add a new language.
- **Trimble Modus look-and-feel.** Brand colours, Open Sans, no inline
  styles. The extension sits seamlessly inside the Trimble Connect shell.
- **Save back to Trimble Connect.** Outputs are written to a dedicated
  `siteplan2d` folder in the active project (created if missing).
  Re-uploading the same filename uses Trimble Connect's built-in
  auto-versioning so older revisions stay accessible.
- **Open existing floorplans.** A sidebar lists every saved JSON in the
  `siteplan2d` folder; opening one re-hydrates the viewer and
  annotator so the user can edit existing work / takt zones (rename,
  change kind, delete) and re-save without going back to the IFC.
- **Background image (aerial photo).** Upload a raster image, drag it into
  place over the IFC content, scale it to the storey's world coordinates,
  set the opacity, then **lock** the calibration so zoom and pan no longer
  affect the alignment.
- **Site-planning tools.** A curated catalog of construction-site symbols
  (cranes, gates, fences, driving routes, site cabins, waste containers,
  elevators, entrances, electrical cabinets, demolition areas, first-aid
  stations, parking, loading areas, direction arrows) with the right
  geometry kind for each — polygons, polylines, or point markers — plus
  an SVG symbol library that ships inside every output file. Each
  category carries an emoji on the picker button so the toolbar reads at
  a glance.
- **Drag-edit on the canvas.** Double-click any user area or site
  element to drop into edit mode. Drag vertices to reshape, drag the
  body to translate, click an edge midpoint to insert a vertex.  Points
  get a centre-move handle plus secondary handles:
    - **Crane** → dashed reach-radius ring with an east-side drag handle.
    - **Every other point** → a south-east "size" handle that scales the
      symbol via `sizeWorld`.
    - **All points** also have a **rotation handle** with a dashed arm
      from centre — drag to rotate, snapped to 15° increments.
- **Copy / paste.** `Cmd/Ctrl+C` copies the selected user area or site
  element; `Cmd/Ctrl+V` pastes a new copy 1.5 m diagonal from the source,
  fresh id, name suffixed with `(N)`.
- **Undo / redo.** `Cmd/Ctrl+Z` undoes the latest edit (up to 20 steps);
  `Cmd/Ctrl+Shift+Z` (or `Cmd/Ctrl+Y`) redoes. Every document mutation
  — drawing a polygon, dragging a vertex, changing a fill colour,
  pasting, etc. — pushes a snapshot, so the gesture matches the
  text-editor mental model.
- **Snap engine.** Snap candidates include IFC corners and edges plus
  every user-drawn object on the current storey (areas, polygons,
  polylines, points). A kind-aware on-screen marker — a square for
  vertex snaps, a diamond for edge snaps — appears at the lock point so
  the user sees exactly where the cursor will land. `Alt` skips snap
  for one click.
- **PDF export.** Pick a paper size (A4 → A0, Letter, Tabloid) and
  orientation, choose a filename, and save the PDF back to the
  `siteplan2d` folder. The export rasterises via canvas at 200 DPI so
  every CSS feature the viewer paints (custom colours, label haloes,
  symbols, background image) prints exactly as on screen.

## Limitations and known constraints

- **IFC parsing is browser-side.** Design target is up to **~1 GB IFC**
  files. The pipeline imposes no code-level size cap — the source IFC
  is streamed straight into the web-ifc WASM worker as an `ArrayBuffer`.
  Practical ceiling is the browser tab's heap (≈ 4 GB on 64-bit
  Chromium; web-ifc's WASM is 32-bit so a single model can't exceed
  that). Parsing a 1 GB IFC typically takes 1–4 GB of peak RAM and
  several minutes; smaller models (≤ 200 MB) are interactive. If you
  hit "out of memory", close other tabs and retry.
- **Read-only IFC.** The extension never writes back to the source IFC.
  Output is always SVG + JSON next to the IFC.
- **Tested in Chromium-based browsers.** Playwright covers Chromium;
  Firefox and Safari are not validated. The IFC worker + WASM stack
  works in all three, but UI gestures are tuned for Chromium event
  ordering.
- **Single-storey edit at a time.** The viewer renders the storey
  currently selected in the storey list. Cross-storey 3D views are out
  of scope (the deliverable is 2D plan drawings).

## Quick start

Prerequisites: **Node 22 LTS** (the project pins `engines.node` to `>=22.12.0`), and `openssl` on `PATH` (for generating the local self-signed cert).

```sh
npm install
npm run dev
```

The HTTPS dev server starts on `https://localhost:5173` with a freshly
generated self-signed certificate and proxies the Vite dev server. Accept
the cert in your browser, then in Trimble Connect add the extension using:

```
https://localhost:5173/manifest.json
```

The dev server rewrites the manifest on the fly so its URLs point at the
local server while the on-disk `manifest.json` keeps the production URLs.

## Build and deploy

```sh
npm run build       # tsc -b && vite build -> /dist
npm run preview     # serve /dist on https://localhost:4173
npm run lint        # ESLint
npm run typecheck   # tsc -b --noEmit
npm test            # Vitest unit tests
npm run test:e2e    # Playwright e2e (requires `npm run test:e2e:install`)
```

CI runs lint + typecheck + test + build on every push and PR (`.github/workflows/ci.yml`).
A push to `main` triggers `.github/workflows/deploy.yml`, which builds and
publishes `/dist` (plus `manifest.json` at the root) to GitHub Pages.

## Install in Trimble Connect

Once GitHub Pages is live for the repo, the user-facing manifest URL is:

```
https://markus-t-mattila.github.io/trimble-sitePlan2D/manifest.json
```

In Trimble Connect → Extensions, add a custom extension and paste that
URL. The extension appears in the sidebar as **sitePlan2D**.

## Libraries used

Bundled at runtime:

| Library | Used for |
| --- | --- |
| [`react`](https://react.dev/) + [`react-dom`](https://react.dev/) | UI runtime + reconciler |
| [`zustand`](https://github.com/pmndrs/zustand) | App-wide state store (selection, edit mode, dirty flag, documents) |
| [`web-ifc`](https://github.com/ThatOpen/engine_web-ifc) | IFC parsing + geometry extraction, served from a Web Worker |
| [`comlink`](https://github.com/GoogleChromeLabs/comlink) | Typed RPC between the main thread and the IFC worker |
| [`polygon-clipping`](https://github.com/mfogel/polygon-clipping) | Footprint boolean ops (per-triangle union, hole handling) |
| [`rbush`](https://github.com/mourner/rbush) | R-tree spatial index for the snap engine (vertices + edges) |
| [`zod`](https://zod.dev/) | Per-storey JSON schema validation (input + round-trip) |
| [`jspdf`](https://github.com/parallax/jsPDF) | PDF document assembly (canvas raster embedded via `addImage`) |
| [`jszip`](https://stuk.github.io/jszip/) | Local zip fallback for offline export (helper kept available for scripted use; no UI surface today) |
| Trimble Connect [Workspace API](https://components.connect.trimble.com/trimble-connect-workspace-api/) | Auth, project context, registering the sidebar menu entry |
| Trimble Connect [Core API v2.0/2.1](https://app.connect.trimble.com/tc/docs/) | Folder traversal, file download / upload (three-phase `initiate → PUT → commit`) |

Build, test, and developer tooling:

| Tool | Used for |
| --- | --- |
| [`vite`](https://vitejs.dev/) + [`@vitejs/plugin-react`](https://github.com/vitejs/vite-plugin-react) | Bundling, dev server, HMR |
| [`vite-plugin-wasm`](https://github.com/Menci/vite-plugin-wasm) + [`vite-plugin-top-level-await`](https://github.com/Menci/vite-plugin-top-level-await) | Streaming the `web-ifc.wasm` binary alongside the worker |
| [`typescript`](https://www.typescriptlang.org/) (strict + `exactOptionalPropertyTypes`) | Source language |
| [`vitest`](https://vitest.dev/) + jsdom | Unit / integration test runner |
| [`@playwright/test`](https://playwright.dev/) | End-to-end test runner (Chromium) |
| [`eslint`](https://eslint.org/) + [`@typescript-eslint`](https://typescript-eslint.io/) + React plugins | Lint |
| [`prettier`](https://prettier.io/) | Formatting |
| [`tsx`](https://github.com/privatenumber/tsx) | TypeScript dev-server runtime (manifest rewrite + Vite proxy) |

All runtime dependencies are bundled. The only external network
references at runtime are: (1) the Trimble Connect Workspace API
component script (`components.connect.trimble.com`), which the host
ecosystem requires; (2) Open Sans served from Google Fonts
(`fonts.googleapis.com` + `fonts.gstatic.com`) for the Trimble Modus
typeface. The Content-Security-Policy meta in `index.html` constrains
script execution to these two origins plus `self`. UUIDs are issued
with the native `crypto.randomUUID()` — no `uuid` npm dependency.

### Why these choices

- **Vite + React** — Vite's HMR + ES-module dev server keeps iteration
  fast on the SVG-heavy editor; React handles the diff between the
  current selection / draft / committed document trees without manual
  reconciliation.
- **Zustand over Redux** — the store is a single discriminated union
  (selection × tool × document × undo). Redux's middleware ecosystem
  buys little here; Zustand keeps the file count small and the
  per-action shape easy to read.
- **Zod over Yup / io-ts** — the on-disk JSON is the source of truth and
  needs strict round-trip validation, including refinement helpers
  (colour-token allowlist, data-URL allowlist). Zod's `refine` keeps
  the validators close to the schema.
- **web-ifc, not web-ifc-three / `@thatopen/components`** — we only
  need triangle meshes; we don't render in 3D. The headless web-ifc
  build avoids the Three.js dependency tree entirely.
- **Comlink over raw `postMessage`** — the worker exposes about a dozen
  RPC methods (open, list types, compute storey, …). Comlink's typed
  proxy keeps the boundary readable without hand-rolling request
  tagging.
- **polygon-clipping over martinez** — `polygon-clipping` (Vatti) is
  faster and more numerically robust on degenerate rings, which IFC
  geometry produces routinely.
- **rbush** — the de-facto JS R-tree, Mapbox-maintained. The snap engine
  builds the index once per storey and queries thousands of times.
- **jsPDF + canvas raster** — see
  [docs/architecture.md](./docs/architecture.md#pdf-export) for the
  rationale (svg2pdf-js was tried first, dropped because it couldn't
  handle modern CSS color-mix and tripped on dynamically computed
  paths).

## Repository hygiene

The default branch should be `main`. Recommended settings on the GitHub
repo (one-time, owner only):

- **Settings → Pages →** *Build and deployment* source = "GitHub Actions"
  (the deploy workflow takes it from there).
- **Settings → Branches →** protect `main`:
  - require a pull request before merging,
  - require status checks (`ci` workflow) to pass,
  - require linear history.

These prevent third parties from pushing directly to `main` while
keeping the source code publicly readable.

## Project layout

```
trimble-sitePlan2D/
├─ index.html                       # Vite entry; CSP meta + loads src/main.tsx + Workspace API
├─ manifest.json                    # Trimble Connect extension manifest
├─ vite.config.ts                   # Vite + plugin-react + WASM + base path
├─ tsconfig.*.json                  # strict + exactOptionalPropertyTypes
├─ eslint.config.js                 # ESLint flat config
├─ vitest.config.ts                 # test runner config + jsdom env
├─ playwright.config.ts             # e2e config
├─ public/
│  ├─ wasm/                         # web-ifc.wasm (copied by `npm install`)
│  └─ assets/                       # icon.svg referenced by manifest.json
├─ scripts/                         # build-time helpers (copy-wasm.mjs)
├─ src/
│  ├─ trimble/                      # Workspace API, Core API client, access-token cache
│  ├─ ifc/                          # web-ifc singleton, worker, storey resolver, footprint pipeline
│  ├─ generator/                    # zod schema, JSON builder, SVG builder
│  ├─ viewer/                       # SVG canvas, layer panel, selection panel, coordinate overlay
│  ├─ annotator/                    # SnapEngine, polygon / polyline / point / text tools, EditOverlay
│  ├─ persistence/                  # uploadToTrimble + loadFromTrimble + downloadZip helper
│  ├─ pdf/                          # exportPdf (canvas raster + jsPDF)
│  ├─ ui/                           # App shell (file browser, storey list, type picker, toolbar, panels)
│  ├─ i18n/                         # en + fi translations, locale detector, React provider
│  ├─ styles/                       # tokens.css, components.css, global.css
│  ├─ state/                        # zustand store (selection / tool / documents / undo)
│  ├─ utils/                        # bbox, centroid, matrix, escape, colour validation, keyboard focus, id
│  ├─ types/                        # shared types
│  └─ version.ts                    # generator version constant
├─ dev-server/                      # HTTPS dev server with manifest rewrite + Vite proxy
├─ tests/
│  ├─ unit/                         # Vitest unit tests (per-module)
│  ├─ e2e/                          # Playwright e2e (Chromium)
│  └─ fixtures/                     # Small open-licensed IFCs (downloaded on demand, not committed)
├─ docs/
│  ├─ architecture.md
│  ├─ output-format.md
│  ├─ localization.md
│  └─ development.md
└─ .github/workflows/               # CI + GH Pages deploy
```

## Documentation

- [docs/user-guide.md](./docs/user-guide.md) — end-user walkthrough: open
  an IFC, draw work / takt zones and site-plan symbols, save back to
  Trimble Connect, export a PDF.
- [docs/architecture.md](./docs/architecture.md) — runtime data flow, worker
  boundaries, web-ifc singleton, viewer/annotator integration.
- [docs/output-format.md](./docs/output-format.md) — exact contract of the
  SVG and JSON files this extension produces. Read this before consuming the
  outputs in Power BI or any other downstream tool.
- [docs/localization.md](./docs/localization.md) — how the active locale is
  detected and how to add a new language.
- [docs/development.md](./docs/development.md) — how the dev server, build,
  and tests fit together; common gotchas (self-signed cert, browser cache).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Security

See [SECURITY.md](./SECURITY.md) for the access-token handling, signed-URL
validation, and pagination origin guards. Report security issues privately.

## License

[MIT](./LICENSE).
