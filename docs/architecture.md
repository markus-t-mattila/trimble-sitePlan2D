# Architecture

This document describes the runtime architecture of trimble-sitePlan2D
in enough detail to maintain or extend it. For a per-module reference, read
the file-level JSDoc in `src/`.

## Module map

```
                                ┌─────────────────────────────────┐
                                │  Trimble Connect host (iframe)  │
                                └─────────────────┬───────────────┘
                                                  │ Workspace API
                                                  ▼
┌──────────────────────────────────────────────────────────────────────────┐
│  Main thread                                                             │
│  ┌────────────┐  ┌──────────────────────┐  ┌───────────────────────────┐ │
│  │ src/App    │→ │ src/trimble (auth +  │  │ src/i18n (LocaleProvider, │ │
│  │            │  │ Core API client)     │  │ detect, en/fi)            │ │
│  └────┬───────┘  └──────────┬───────────┘  └───────────────────────────┘ │
│       │ user picks IFC      │ download / list / upload                   │
│       ▼                     ▼                                            │
│  ┌────────────────────────────────────┐  ┌─────────────────────────────┐ │
│  │ src/ifc/ifc-worker-client          │← │ src/state (zustand store)   │ │
│  │ (Comlink proxy)                    │  └──────────┬──────────────────┘ │
│  └────┬───────────────────────────────┘             │                    │
│       │ openModel(buffer), computeStoreyObjects     │                    │
│       ▼                                             │                    │
│  ┌────────────────────────────────────┐             │                    │
│  │ src/generator                      │←────────────┘                    │
│  │ buildStoreyJson, buildStoreySvg    │                                  │
│  └────┬───────────────────────────────┘                                  │
│       │ StoreyDocument + SVG string                                      │
│       ▼                                                                  │
│  ┌────────────────────────────────────┐  ┌─────────────────────────────┐ │
│  │ src/viewer (SvgCanvas, panels,     │← │ src/annotator (SnapEngine,  │ │
│  │ coordinate overlay)                │  │ PolygonTool, AreaList)      │ │
│  └────┬───────────────────────────────┘  └─────────────────────────────┘ │
│       │ save action                                                      │
│       ▼                                                                  │
│  ┌────────────────────────────────────┐                                  │
│  │ src/persistence                    │→ Trimble Connect (Core API) or  │
│  │ uploadToTrimble / downloadZip      │   browser download              │
│  └────────────────────────────────────┘                                  │
└──────────────────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────────────────────┐
│  Web Worker (src/ifc/ifc-worker.ts)                                      │
│  ┌────────────────────────┐ ┌────────────────────────┐                   │
│  │ web-ifc singleton      │ │ storeyResolver +       │                   │
│  │ (one IfcAPI per worker)│ │ typeCatalog            │                   │
│  └────────┬───────────────┘ └────────┬───────────────┘                   │
│           │ OpenModel / GetGeometry  │                                   │
│           ▼                          ▼                                   │
│  ┌────────────────────────────────────────────────────────────────────┐  │
│  │ footprint pipeline (sectioner → polygonOps → fallback projector)    │ │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

## Workspace API + Core API

`src/trimble/workspaceClient.ts` wraps the `window.TrimbleConnectWorkspace`
global with a typed surface. It:

- Establishes a singleton `connect()` promise so concurrent callers share
  one underlying connection.
- Normalises the Workspace SDK's two callback shapes (`(name, args)` and
  `{ type, data }`) into one `{ eventName, eventArgs }` object.
- Reads the current project (`getCurrentProject`) and requests the
  `accesstoken` permission.

`src/trimble/coreApiClient.ts` covers everything reached over the HTTPS
Core API:

- Host fallback ordered by region (NA / EU / APAC / AU), short-circuited by
  the workspace-reported project location.
- `listProjectIfcFiles` does a legacy folder BFS first, falls back to the
  v2.1 by-path endpoint, validates every pagination link's origin against
  the originally-discovered Core API host (so bearer tokens can never leak
  via a tampered `next` URL).
- `downloadIfcArrayBuffer` uses the signed-URL flow (`GET .../downloadurl`
  → `GET signedUrl` with `credentials: "omit"`).
- `uploadFileArrayBuffer` is the three-phase signed upload
  (initiate / PUT bytes / commit) with a one-shot commit retry to survive
  client-side timeouts after server-side completion.
- `findOrCreateProjectFolder` is the helper that powers the
  "siteplan2d" folder pattern documented in
  [output-format.md](./output-format.md).

All access tokens stay in memory; nothing is written to storage.

## IFC engine + Web Worker

`web-ifc` ships a WASM module. We instantiate it **once per realm** through
the singleton in `src/ifc/singleton.ts`, and the application only ever
touches the singleton **inside the worker** (`src/ifc/ifc-worker.ts`). The
main thread interacts via a Comlink-wrapped proxy
(`src/ifc/ifc-worker-client.ts`). Keeping the parser off the main thread
keeps the UI smooth during long parses.

### Footprint pipeline (per IFC object)

1. `IfcAPI.GetFlatMesh` / `GetGeometry` returns the object's triangle mesh
   along with a 4×4 placement matrix.
2. The sectioner (`src/ifc/footprint/sectioner.ts`) intersects every
   transformed triangle with the storey's horizontal cut plane and emits
   the resulting line segments.
3. `chainSegmentsIntoRings` (`polygonOps.ts`) closes segments into rings via
   a tolerant adjacency walk.
4. When no triangle crossed the plane (e.g. a slab below the cut height),
   the projector (`projector.ts`) projects the whole mesh onto XY and
   unions the triangles with `polygon-clipping`.

The result is one or more polygons per object, in world coordinates, ready
for the generator.

## Generator (JSON + SVG)

`buildStoreyJson` produces a `StoreyDocument` that is validated against the
zod schema before being returned. `buildStoreySvg` turns that document into
a UTF-8 SVG string. The SVG:

- Has a `viewBox` equal to the world bounding box (plus a 5% margin by
  default).
- Wraps content in `<g transform="translate(0 yFlip) scale(1 -1)">` so path
  coordinates equal IFC world XY.
- Carries every visual property in the `<defs><style>` block as CSS custom
  properties; paths only carry `d`, `class` and `data-*` attributes. See
  [output-format.md](./output-format.md) for the variable contract.

## State + UI

`src/state/floorplanStore.ts` is a single zustand store. It owns:

- access token / Core API base URL / project context
- list of IFC files, selected file
- storey list, selected storey
- the per-storey generated documents
- render options + cut height
- status bar text

The store is intentionally flat — there's only one user, one project, one
IFC at a time. Selectors are colocated with components.

## Viewer

`SvgCanvas` injects the generator's SVG string into a host `<div>` and then
manipulates that DOM directly (visibility, selection, viewBox) instead of
re-running React's diff on potentially thousands of `<path>` nodes.

Pan + zoom + cursor coordinate tracking all live on the host container.
Pointer-capture is used so dragging works even when the cursor strays off a
path.

## Annotator

A small family of tools shares one selection model
(`floorplanStore.activeTool`):

- `PolygonTool` — work / takt / other areas and polygon-shaped site
  elements (site cabin, demolition area, …). Snaps to IFC corners, IFC
  edges, and existing user-area corners/edges (Alt skips snap).
- `PolylineTool` — driving routes and fences. Same snap engine.
- `PointTool` — single-click placement of site-plan symbols (crane, gate,
  waste container, elevator, entrance, electrical cabinet, first-aid).
- `BackgroundCalibrateTool` — drag-translates the calibrated raster
  background image; numeric scaling lives in the sidebar panel.

Snap candidates are indexed in two `rbush` R-trees (one for vertices, one
for edges) built from the active storey document. Vertex hits beat edge
hits when both are within the radius. The catalog of site-element
categories (`src/annotator/siteElementCatalog.ts`) drives both the picker
UI and the SVG output — including the inline `<symbol>` definitions
emitted into every storey SVG.

## Persistence

`uploadToTrimble` writes the per-storey SVG+JSON pairs to the active
project's `siteplan2d` folder. The folder is created on first use.
Subsequent uploads with the same filename produce a new version of the
existing file thanks to Trimble Connect's built-in auto-versioning.

`downloadZip` bundles the same per-storey pairs into a `…-floorplan.zip`
and triggers a browser download.

`listSavedFloorplans` + `downloadSavedFloorplan` power the "Saved
floorplans" sidebar panel: the JSON files in the `siteplan2d`
folder are listed, the user picks one, the JSON is downloaded and
validated against the schema, and the result is fed through
`floorplanStore.loadStoreyDocument(doc)`. From that point on the viewer,
annotator and "Save" action treat the loaded document identically to one
that was just generated from an IFC.

PDF export (`src/pdf/exportPdf.ts`) is invoked from the sidebar panel.
The pipeline takes the same SVG the viewer renders, draws it into an
off-screen `<canvas>` at 200 DPI (`canvg`-driven rasterisation), and
embeds the resulting raster into a `jsPDF` document via `addImage`.
The bytes are then either uploaded to the `siteplan2d` folder or
triggered as a local download.

### Why canvas + raster, not direct SVG-to-PDF

The first implementation used `svg2pdf.js` to produce a vector PDF —
the obviously preferable representation. It was dropped because:

- Modern CSS the viewer relies on (`color-mix(...)`, per-element
  `style="..."` overrides, `vector-effect`) confused svg2pdf's CSS
  resolver, and the resulting PDF either dropped strokes or stamped
  `NaN` coordinates.
- svg2pdf's `<use>` resolution didn't match how the runtime resolves
  Trimble-Modus catalog symbols, so site-element icons (cranes,
  cabins, …) printed without their glyphs.

Raster + canvas trades vector crispness for fidelity: anything the
viewer can paint, the PDF reproduces pixel-for-pixel. A future revision
can swap in a vector backend (pdf-lib + custom SVG walker, or a
re-evaluation of svg2pdf once it supports `color-mix`) without
touching the rest of the pipeline.

## Background image

`backgroundImage` is an optional field on the storey document. The
generator emits a calibrated `<image>` element behind the IFC content; the
calibration (origin + world width/height + rotation + opacity + locked
flag) lives in the JSON so the SVG self-references its own positioning.
While `locked` is false the `BackgroundCalibrateTool` drag-translates the
image in the viewer; numerical scaling lives in the sidebar panel so a
supervisor with measured site dimensions can punch in exact values.

## Internationalisation

`src/i18n/detectLocale.ts` probes:

1. `workspaceApi.user.getLanguage()` / `getLocale()` / static fields
2. `workspaceApi.extension.getLanguage()` (host-version dependent)
3. `navigator.language`
4. `"en"` fallback

Detection happens twice: once at boot from `navigator.language` so the
splash already uses the right language; once again after the Workspace API
hands us its user info so the host's authoritative locale wins.
