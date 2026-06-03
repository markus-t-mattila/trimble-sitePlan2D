/*
Cross-cutting types referenced by multiple workstreams. Pinned early so each
workstream's owner can rely on a stable contract.
*/

/** Immutable 2D point in IFC world units. */
export type Vec2 = readonly [number, number];

/**
 * What's currently selected on the canvas. Lifted here (rather than kept
 * as local state inside the SvgCanvas) so that sidebar lists — Placed
 * elements, User areas, the IFC type picker — can also drive selection
 * by writing into the same target and the canvas highlight follows.
 */
export type SelectionTarget =
  | { kind: "ifc"; id: string }
  | { kind: "userArea"; id: string }
  | { kind: "siteElement"; id: string };

export type Ring = ReadonlyArray<Vec2>;
/** Outer ring first, holes (if any) follow. */
export type Polygon = ReadonlyArray<Ring>;

/**
 * Length unit declared by the IFC's `IfcUnitAssignment`. The footprint
 * pipeline reads it once per file and forwards it into every storey
 * document so downstream consumers know how to interpret the coordinates.
 * `"unknown"` means the IFC did not declare a length unit or web-ifc
 * could not parse it — coordinates are still in whatever native units
 * the file uses; treat them as raw numbers.
 */
export type IfcUnit = "m" | "mm" | "cm" | "ft" | "in" | "unknown";

/**
 * Active Trimble Connect project the user is working in. `rootFolderId`
 * is null until the Core API call that resolves the project root
 * returns; the file-browser UI shows a spinner during that gap rather
 * than rendering an empty tree.
 */
export interface ProjectContext {
  id: string;
  name: string;
  location: string | null;
  rootFolderId: string | null;
}

/**
 * One entry in the Trimble Connect file picker. `fileId` is the latest
 * version's id (the Core API treats files and versions as separate
 * resources); `versionId` is pinned so re-saves stay attached to the
 * specific revision the user picked.
 */
export interface IfcFileEntry {
  fileId: string;
  versionId: string;
  folderId: string;
  name: string;
  path: string;
}

/**
 * Single `IfcBuildingStorey` summary. `elevation` is in the IFC's
 * declared length unit (see `IfcUnit`); the storey list renders it
 * with the unit suffix so the user sees `1200 mm` vs `1.2 m` directly.
 */
export interface StoreyInfo {
  expressId: number;
  ifcGuid: string;
  name: string;
  longName: string | null;
  elevation: number;
}

/**
 * One IFC entity projected to 2D for a single storey. `polygons` is a
 * list of polygons-of-polygons: each entry is one disjoint piece
 * (outer ring first, holes follow in CCW-after-CW order so
 * `polygon-clipping` round-trips cleanly).
 */
export interface StoreyObject {
  ifcGuid: string;
  ifcType: string;
  name: string;
  longName: string | null;
  polygons: Polygon[];
}

/**
 * Where the name label sits relative to the geometry. `center` (the default)
 * uses the polygon centroid / point position. The four edge options nudge
 * the text outside the bounding box by ~one line-height; the renderer
 * adjusts `text-anchor` so the text never falls off a corner.
 */
export type LabelPosition = "center" | "above" | "below" | "left" | "right";

export interface UserArea {
  id: string;
  name: string;
  kind: "work" | "takt" | "other";
  polygon: Vec2[];
  createdAt: string;
  /** Optional override: outline thickness in world units. Falls back to RenderOptions. */
  strokeWidthWorld?: number;
  /** Optional: whether the name appears as a label on the drawing. Default true. */
  labelVisible?: boolean;
  /** Optional: per-area label font size in world units. Falls back to RenderOptions. */
  labelFontSizeWorld?: number;
  /** Optional per-area stroke colour override. Falls back to the area kind palette. */
  strokeColor?: string;
  /** Optional per-area fill colour override. Falls back to the area kind palette. */
  fillColor?: string;
  /** Optional per-area label text colour. Defaults to black at render time. */
  labelColor?: string;
  /** Where the label sits relative to the polygon. Defaults to `center`. */
  labelPosition?: LabelPosition;
}

/**
 * Categories supported by the site-plan drawing tools. Each category is
 * pre-mapped to a geometry kind and a visual symbol in
 * `src/annotator/siteElementCatalog.ts`. Add new categories there.
 */
export type SiteElementCategory =
  | "driving-route"
  | "fence"
  | "gate"
  | "crane"
  | "site-cabin"
  | "waste-container"
  | "elevator"
  | "entrance"
  | "electrical-cabinet"
  | "demolition-area"
  | "first-aid"
  | "parking"
  | "loading-area"
  | "direction-arrow"
  | "text-label";

export type SiteElementGeometryKind = "polygon" | "polyline" | "point" | "text";

export type SiteElementGeometry =
  | { kind: "polygon"; vertices: Vec2[] }
  | {
      kind: "polyline";
      vertices: Vec2[];
      /**
       * Path width in world units (e.g. metres). Driving routes use this to
       * render an actual carriageway swept around the centreline rather
       * than a thin display stroke. Undefined → thin display stroke only.
       */
      widthWorld?: number;
    }
  | {
      kind: "point";
      position: Vec2;
      rotationDeg: number;
      sizeWorld?: number;
      /**
       * Optional "reach" radius drawn as a translucent circle around the
       * symbol. Used by cranes to show jib range; other categories may use
       * it for footprint / influence radius.
       */
      radiusWorld?: number;
    }
  | {
      /**
       * Free-standing text annotation. Position is the text's anchor
       * (centre by default). Rotation is in degrees clockwise from
       * "up" in IFC convention. The element's `name` field carries the
       * displayed string — there is no separate `text` field so the
       * existing rename / list / persistence paths just work.
       */
      kind: "text";
      position: Vec2;
      rotationDeg: number;
      /** Font size in world units (e.g. metres). */
      sizeWorld: number;
    };

export interface SiteElement {
  id: string;
  name: string;
  category: SiteElementCategory;
  geometry: SiteElementGeometry;
  createdAt: string;
  /** Outline thickness override in world units (polygon + polyline only). */
  strokeWidthWorld?: number;
  /** Per-element stroke colour (polylines + polygons). */
  strokeColor?: string;
  /** Per-element fill colour (polygons + point symbols). */
  fillColor?: string;
  /** When false the `name` label is suppressed on this element. Default true. */
  labelVisible?: boolean;
  /** Override for label font size in world units. */
  labelFontSizeWorld?: number;
  /** Optional per-element label text colour. Defaults to black at render time. */
  labelColor?: string;
  /** Where the label sits relative to the geometry. Defaults to `center`
   *  (or, for points, slightly above the symbol — the legacy offset). */
  labelPosition?: LabelPosition;
  /** Show the category icon at the polygon centroid. Default true.
   *  Polygon-kind only — point elements ARE the icon, polylines have
   *  no meaningful centroid to anchor it to. */
  iconVisible?: boolean;
  /** Multiplier on the auto-derived centroid icon size. Default 1.0. */
  iconScale?: number;
}

/**
 * Raster background (e.g. site aerial photo) laid behind the IFC content.
 * Stored as a data URL inside the JSON so the SVG remains self-contained.
 * Calibration is a three-step gesture the user performs in the viewer:
 * upload → drag/scale into world coordinates → toggle `locked` so pan
 * and zoom no longer move the image. While `locked === false` the
 * viewer renders drag handles; once locked, the image is read-only
 * until the user explicitly unlocks it.
 */
export interface BackgroundImage {
  href: string;
  /** Top-left corner in world coordinates. */
  origin: Vec2;
  /** Image width in world units (e.g. metres). */
  widthWorld: number;
  /** Image height in world units. */
  heightWorld: number;
  rotationDeg: number;
  opacity: number;
  /** Original pixel size for aspect-ratio preservation. */
  pixelWidth: number;
  pixelHeight: number;
  /** When true the position is locked: the calibrate handles are not shown. */
  locked: boolean;
}

/**
 * Provenance recorded inside every saved storey so a downstream
 * consumer can trace the floorplan back to its IFC. `fileId` /
 * `versionId` come from the Trimble Connect file picker;
 * `ifcSchema` is what web-ifc reported (e.g. `"IFC4"`) or null when
 * detection failed; `projectId` / `projectName` come from the
 * Workspace API at save time.
 */
export interface FloorplanSource {
  fileId: string;
  versionId: string;
  fileName: string;
  ifcSchema: string | null;
  projectId: string;
  projectName: string;
}

/**
 * Render-time options that apply to every shape in a storey when the SVG is
 * emitted. Persisted as part of the storey document so the on-disk SVG is a
 * deterministic function of the JSON.
 */
export interface RenderOptions {
  /** Optional text label drawn inside each IFC shape. */
  labelSource: "none" | "name" | "longName";
  /** Optional text label drawn inside each user area. */
  userAreaLabelSource: "none" | "name";
  /** Label font size in world units (e.g. metres if the IFC is metric). */
  fontSizeWorld: number;
  /**
   * Strategy for IFC object fill:
   *   - `none`     — outlines only.
   *   - `perType`  — one colour per IFC type (IfcWall, IfcSlab, …).
   *   - `single`   — one shared colour for every shape (configured via
   *                  `singleFillColor`).
   *   - `byName`   — every distinct `IfcName` gets its own colour, so
   *                  repeated names share a swatch and unique names stand
   *                  out individually.
   */
  fillStyle: "none" | "perType" | "single" | "byName";
  /** CSS colour used when `fillStyle === "single"`. */
  singleFillColor: string;
  /** Outline stroke width in world units (default 0.05). */
  strokeWidthWorld: number;
  /** Per-IFC-type stroke/fill overrides. Missing entries fall back to defaults. */
  typeStyles: Record<string, { fillColor?: string; strokeColor?: string }>;
  /**
   * Per-IFC-object overrides keyed by `IfcGUID`. Lets the user click a shape
   * in the viewer and tint it individually without touching the type-wide
   * style. `fillVisible: false` forces no fill even if the type rule would
   * have given one.
   */
  objectStyles: Record<string, { fillColor?: string; strokeColor?: string; fillVisible?: boolean }>;
  /**
   * Which world axis points "up" in the source IFC. Drives the section
   * direction:
   *   - `"z"` (default, IFC standard): cut at constant Z, project to (X, Y).
   *   - `"y"`: cut at constant Y, project to (X, Z). Some exports use Y up.
   *   - `"x"`: cut at constant X, project to (Y, Z). Rare.
   */
  projectionAxis: "x" | "y" | "z";
}

/**
 * Top-level JSON document persisted for one storey. This is the on-disk
 * source of truth — the SVG is a deterministic re-render of the same
 * data. Carries the IFC-derived geometry (`objects`), the user's hand
 * drawings (`userAreas`, `siteElements`), the calibrated raster
 * (`backgroundImage`), and the render settings that froze its look.
 * `schemaVersion` is fixed at `1.0.0` for now; bumping it requires a
 * migration in `src/generator/schema.ts`. See
 * [docs/output-format.md](../docs/output-format.md) for the wire-format
 * reference and field-by-field contract.
 */
export interface StoreyDocument {
  schemaVersion: "1.0.0";
  generatedAt: string;
  generator: { name: string; version: string };
  source: FloorplanSource;
  storey: StoreyInfo & { unit: IfcUnit };
  units: IfcUnit;
  boundingBox: { xMin: number; yMin: number; xMax: number; yMax: number };
  cutHeightAboveStorey: number;
  objects: StoreyObject[];
  userAreas: UserArea[];
  /** Construction-site planning overlay (cranes, fences, routes, …). */
  siteElements?: SiteElement[];
  /** Optional raster background calibrated against the world coordinates. */
  backgroundImage?: BackgroundImage;
  renderOptions?: RenderOptions;
}

/**
 * Defaults applied when no render options are provided. Kept here so the
 * generator and UI agree on what "no choice" means.
 */
export const DEFAULT_RENDER_OPTIONS: RenderOptions = {
  labelSource: "none",
  userAreaLabelSource: "name",
  fontSizeWorld: 0.25,
  fillStyle: "none",
  singleFillColor: "rgba(0,99,163,0.12)",
  strokeWidthWorld: 0.05,
  typeStyles: {},
  objectStyles: {},
  projectionAxis: "z",
};
