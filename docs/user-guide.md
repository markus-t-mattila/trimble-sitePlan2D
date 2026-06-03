# User guide

A practical walkthrough for site supervisors: open an IFC, pick a storey,
draw your work / takt zones and site-plan symbols, save back to Trimble
Connect, export a PDF. No coding, no command line — every step is something
you can click in the **sitePlan2D** sidebar tab inside Trimble Connect.

## 1. Open the extension

- Open the relevant project in Trimble Connect.
- In the left tool rail click **sitePlan2D**. The extension panel opens
  on the right.
- If you don't see it, the project administrator still has to add the
  manifest URL one time — see the README section
  ["Install in Trimble Connect"](../README.md#install-in-trimble-connect).
- Once installed, the tab is sticky per browser; you won't need to add it
  again for that project.

## 2. Pick an IFC file

- The sidebar shows a **Files** browser scoped to the active project.
  Folders expand on click; the breadcrumb at the top shows where you are.
- Tap an `.ifc` file to select it. The download starts immediately —
  a small spinner appears next to the filename.
- If the project has many folders, type a few letters into the search box
  at the top of the file browser to filter by name.
- Only the file you tap is downloaded. Other IFCs in the project are
  ignored until you pick them.

## 3. Wait for the IFC to parse

- Parsing happens inside a background worker so the rest of Trimble Connect
  keeps responding.
- A progress bar in the sidebar shows the percentage. Geometry extraction
  is the slow phase — typical 50–200 MB IFCs take 30–90 seconds depending
  on the device.
- Large IFCs (up to ~1 GB) parse but take several minutes and a lot of
  RAM (1–4 GB peak). If the worker reports out-of-memory, close other
  tabs and reload the extension — the worker memory pool resets per
  tab session.
- You can switch away from the tab while it parses; the worker keeps
  going and you'll see the completed list when you come back.

## 4. Pick a storey

- When parsing finishes, the **Storey list** appears below the file
  browser. Each row shows the storey name (or `Storey <id>` if the IFC
  had no name) and the floor elevation.
- Click the row you want to plan against. The selection highlights and
  the **Type picker** opens.
- You can come back to this list later to switch storeys — your edits
  on the current storey are kept in memory until you reload.

## 5. Pick the IFC entity types and cut height

- The **Type picker** lists every IFC type the parser actually found
  (typically `IfcWall`, `IfcSlab`, `IfcDoor`, `IfcWindow`, `IfcColumn`,
  `IfcStair`, …). Tick the ones you want drawn.
- The **Cut height above storey** field controls where the horizontal
  section is taken. Default `1.2 m` — chest height, which is the
  standard architectural plan section.
- Lower the cut for furniture / floor markings, raise it to catch
  high-level beams or services.
- The value is in metres regardless of the IFC's internal unit — the
  extension converts on the fly.

## 6. Hit Generate

- Click **Generate**. The viewer fills the main canvas with the storey
  drawing.
- The first generate for a storey can take a few seconds while the
  per-triangle footprint unions run. Subsequent generates on the same
  storey reuse cached geometry and are near-instant.
- If something looks wrong (empty drawing, mis-projected axes), open the
  **Render options** panel and switch the **Projection axis** — most
  IFCs are Z-up but a minority use Y-up.

## 7. Navigate the viewer

- **Pan** — click and drag in empty space.
- **Zoom** — mouse wheel, or pinch on a trackpad. Zoom is anchored to
  the cursor.
- **Fit to screen** — the round target icon in the top-right toolbar
  recentres and rescales to show the whole storey at once.
- **World coordinates** of the cursor are pinned in the bottom-right
  corner so you can sanity-check positions against the original IFC.

## 8. Layer panel

- The **Layers** panel (left side) lists every IFC type plus the
  user-area layer and the site-element layer.
- Click the eye icon next to a type to hide or show all shapes of that
  type. Hidden layers are not drawn but stay in the saved file.
- Click the small **label** toggle in the same row to hide or show that
  type's text labels without hiding the shapes.
- Layer toggles are visual only; they don't change what gets saved.

## 9. Draw a user area (work / takt zone)

- Open the right toolbar and click the **polygon** tool icon (the
  outlined shape under the user-area heading).
- Pick a kind first: **work**, **takt**, or **other**. The colour
  follows the kind.
- Click in the canvas to add vertices. Snapping is automatic — the
  cursor jumps to nearby IFC corners (square marker) or edges (diamond
  marker). Hold **Alt** while clicking to skip snap for just that one
  click.
- Double-click the last vertex or press **Enter** to close the polygon.
  Press **Esc** to cancel mid-draw.
- A name dialog appears. Names must be **unique across the project**
  — duplicates are rejected with a hint. Pick something a colleague
  will recognise on a printout.

## 10. Draw site-plan elements

- The right toolbar groups symbols by category. Each button shows an
  emoji so the list reads at a glance.
- Categories split by geometry type:
  - **Points** — crane, gate, entrance, electrical cabinet, first-aid,
    site cabin, waste container, elevator, loading area, direction
    arrow, parking, text label. Click once to place; a single rotation
    handle appears on selection.
  - **Polylines** — fence, driving route. Click to add vertices,
    double-click to finish (no closure).
  - **Polygons** — demolition area, parking lot outline. Click vertices,
    double-click to close.
- Cranes get a dashed **reach radius** ring — drag its east handle to
  resize. Every other point has a south-east **size** handle for the
  symbol scale.

## 11. Edit an existing object

- **Double-click** any user area or site element to enter edit mode.
  Vertices, edges and the rotation handle become visible.
- **Drag a vertex** to reshape. **Drag the body** (the filled interior)
  to move the whole shape. **Click an edge midpoint** to insert a new
  vertex.
- **Rotation** — every point element and text annotation has a dashed
  arm with a circle at the end. Drag the circle to rotate; the rotation
  snaps to 15° increments.
- **Colour** — single-click the object instead of double-clicking to
  open the **Selection panel** on the right. Use the stroke / fill /
  label colour swatches to override the kind palette. "Reset" returns
  to the default.
- Press **Esc** or click empty space to exit edit mode.

## 12. Background photo (aerial calibration)

Three steps to lay a site photo behind the IFC drawing.

- **Upload** — the **Background** panel has an "Upload image" button.
  Pick a JPG or PNG; it appears at the canvas centre, half-opaque.
- **Drag and scale** — drag the image body to move it. Drag the corner
  handles to scale. The aspect ratio is preserved. Use the opacity
  slider to fade in or out so the IFC underneath stays readable.
- **Lock** — once the image lines up with the IFC, click the padlock
  icon. The calibrate handles disappear; pan and zoom no longer affect
  alignment. Unlock at any time to re-calibrate.

## 13. Save back to Trimble Connect

- The **Save** button (top-right of the canvas toolbar) writes one
  `.json` and one `.svg` per storey to the project's `siteplan2d`
  folder. The folder is auto-created on first save.
- Re-saving the same storey uses Trimble Connect's **built-in
  versioning** — the existing file is bumped to a new version rather
  than duplicated. Older versions stay accessible via the standard
  Trimble Connect history.
- The **Saved floorplans** list (bottom of the sidebar) shows every
  saved JSON in the `siteplan2d` folder. Click one to open it — the
  viewer and annotator re-hydrate so you can keep editing.
- Saves are per-storey. Editing multiple storeys means multiple save
  clicks, one per storey.

## 14. Export PDF

- Click **Export PDF** in the canvas toolbar. A dialog opens.
- **Paper size** — A4 through A0, plus US Letter and Tabloid.
  **Orientation** — portrait or landscape.
- **Margin** — millimetres of white space around the drawing.
- **Custom crop** — toggle on to drag a rectangle in the viewer; the
  PDF only contains that crop. Off → the storey bounding box is used.
- **Coordinate axes / scale bar** — toggle on to include a north arrow
  and a metric scale bar in the corner.
- The PDF is written to the same `siteplan2d` folder so it sits next
  to the JSON + SVG pair it was rendered from.

## Where things live

- **Inputs.** The source IFC sits wherever the project administrator
  uploaded it; the extension never modifies or moves it.
- **Outputs.** Every save lands in **Trimble Connect → your project
  → `siteplan2d`**. Each storey is represented by a JSON + SVG pair
  with the same base filename; the JSON is the source of truth and
  the SVG is the human-readable render.
- **PDFs.** Live alongside the JSON + SVG, same folder.
- **Re-opening.** Click any saved JSON in the **Saved floorplans**
  panel to rehydrate the viewer. The JSON carries the world geometry,
  the user areas, the site elements, the background image data, and
  the render options — everything you see on screen.
- **Sharing.** Anyone with access to the Trimble Connect project can
  open the saved floorplans from the same panel; no separate download
  step is needed.
