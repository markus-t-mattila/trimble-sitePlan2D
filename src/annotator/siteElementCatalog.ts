import type { SiteElementCategory, SiteElementGeometryKind } from "../types";

/**
 * Static metadata for every site-plan element category. The catalog drives
 * both the UI (tool picker, list) and the SVG output (which symbol to emit
 * and how to colour the geometry).
 */
export interface SiteElementCatalogEntry {
  category: SiteElementCategory;
  geometryKind: SiteElementGeometryKind;
  /** Localised display label key — index into `Translations.siteElements`. */
  labelKey:
    | "drivingRoute"
    | "fence"
    | "gate"
    | "crane"
    | "siteCabin"
    | "wasteContainer"
    | "elevator"
    | "entrance"
    | "electricalCabinet"
    | "demolitionArea"
    | "firstAid"
    | "parking"
    | "loadingArea"
    | "directionArrow"
    | "textLabel";
  /** Stroke colour used in CSS / SVG output. */
  strokeColor: string;
  /** Fill colour for polygon variants and point markers. */
  fillColor: string;
  /** SVG `<symbol>` id used by `<use>` for point markers. Omitted for line / polygon. */
  symbolId?: string;
  /**
   * Single-character emoji — kept for backward-compat with anything
   * that still reads it, but the tool-picker and Placed-elements
   * swatch now use `iconSvg` below. Emojis vary in rendering across
   * platforms (Apple Color, Segoe UI, Noto, Twemoji) and several of
   * the construction-site emojis we needed don't exist as standard
   * codepoints (a portable site office, a swing gate, a demolition
   * hammer, …). The custom SVG icons fix that.
   */
  emoji: string;
  /**
   * Purpose-built SVG icon used by the tool-picker button and the
   * Placed-elements list swatch. Design conventions (after consulting
   * a graphic designer + UX reviewer):
   *   - 24×24 viewport, line-based (no big filled blocks) so it
   *     scales cleanly from 16 px to 32 px without looking blobby.
   *   - `currentColor` for strokes/fills so the icon inherits the
   *     button's text colour by default, and an inline CSS variable
   *     (`--site-tool-color`) lets the button tint each one to the
   *     category's brand colour without a second SVG variant.
   *   - Iconic + literal (a portable trailer for a site cabin, a
   *     swing leaf for a gate, a dumpster for waste, etc.) rather
   *     than generic noun pictograms — they're easier to recognise
   *     in a crowded sidebar.
   */
  iconSvg: string;
  /**
   * Default width of the swept path (polyline only), in world units.
   * Driving routes prompt the user for this in the name dialog when the
   * polyline is finished; the value is stored on
   * `geometry.widthWorld` and renders as a real-world carriageway
   * around the drawn centreline. Undefined → no default; the user can
   * still type one in, or leave the polyline as a thin display line.
   */
  defaultWidthWorld?: number;
}

/*
 * Toolbar icon SVGs.
 *
 * Each icon is a 24×24 viewport, sized to render at any pixel density
 * without aliasing artefacts. Strokes use `currentColor` and a CSS
 * variable (`--site-tool-color`) so the icon picks up the category
 * brand colour when the surrounding button sets it. Authoring rules
 * (the user explicitly asked for "stylish, convincing, purpose-
 * appropriate" — after consulting a designer + UX reviewer):
 *
 *   - Outlines, not filled blobs — readable from a tight tool-strip.
 *   - Use the most literal silhouette the noun affords (a swing gate,
 *     a portable trailer, a dumpster with a hinged lid, an actual
 *     lightning bolt for power, …) instead of a generic noun pictogram.
 *   - Consistent stroke weight (2 in 24×24 = ~8%) so the row reads
 *     as one family even when each icon represents a different thing.
 *   - Decorative dashes used sparingly (the route's centreline; the
 *     gate's swing arc) so motion / openness reads from a glance.
 *
 * Centralised here, not inline in the catalog rows, so the catalog
 * stays scannable as a table.
 */
const ICON_DRIVING_ROUTE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 22 Q5 12 12 12 Q19 12 19 2"/><path d="M5 22 Q5 12 12 12 Q19 12 19 2" stroke-dasharray="1.5 2.5" stroke-width="0.8"/></svg>`;
const ICON_FENCE = `<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 7v15h2V7l2-3 2 3v15h2V7l2-3 2 3v15h2V7l2-3 2 3v15h2V7l-3-4h-2l-3 4h-2l-3-4h-2L8 7H6L3 7z" opacity="0"/><path d="M4 8h2v14H4zM10 8h2v14h-2zM16 8h2v14h-2zM4 11h14v1.5H4zM4 16h14v1.5H4zM4 8l2-3h0M10 8l2-3M16 8l2-3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>`;
const ICON_SITE_CABIN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><rect x="2" y="9" width="20" height="11" rx="0.5"/><path d="M2 9 L5 5 L19 5 L22 9"/><rect x="5" y="13" width="3" height="4" fill="currentColor" opacity="0.18"/><rect x="13.5" y="13" width="3" height="4" fill="currentColor" opacity="0.18"/><line x1="9.5" y1="20" x2="9.5" y2="13" /></svg>`;
const ICON_DEMOLITION = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 21 L4 11 L10 6 L16 11 L16 21"/><path d="M16 14 L20 14 L20 21"/><path d="M4 21 L20 21"/><path d="M7 12 L11 16 M11 13 L13 18 M14 15 L17 18" stroke-width="1.5"/></svg>`;
const ICON_LOADING = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M2 17 L13 17 L13 8 L17 8 L21 12 L21 17 L22 17"/><circle cx="6" cy="18.5" r="1.6"/><circle cx="18" cy="18.5" r="1.6"/></svg>`;
const ICON_PARKING = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2.5"/><path d="M9 7 L9 17 M9 7 L13 7 Q16 7 16 10 Q16 13 13 13 L9 13" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
const ICON_CRANE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><line x1="3" y1="5" x2="21" y2="5"/><line x1="7" y1="5" x2="12" y2="2"/><line x1="12" y1="2" x2="12" y2="5"/><line x1="12" y1="5" x2="12" y2="22"/><line x1="9" y1="22" x2="15" y2="22"/><rect x="3" y="3.5" width="3" height="3"/></svg>`;
const ICON_GATE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><rect x="2" y="9" width="3" height="11" fill="currentColor"/><rect x="19" y="9" width="3" height="11" fill="currentColor"/><line x1="5" y1="14" x2="15" y2="6" stroke-width="2.5"/><circle cx="5" cy="14" r="1.4" fill="currentColor"/><path d="M9 11 A 9 9 0 0 1 15 4" stroke-dasharray="1.5 1.5"/></svg>`;
const ICON_WASTE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M3 8 L21 8 L19 21 L5 21 Z"/><line x1="2" y1="6.5" x2="22" y2="6.5" stroke-width="2.5"/><line x1="9" y1="4" x2="15" y2="4" stroke-width="2.5"/><line x1="8" y1="11" x2="8" y2="18" stroke-width="1.5"/><line x1="12" y1="11" x2="12" y2="18" stroke-width="1.5"/><line x1="16" y1="11" x2="16" y2="18" stroke-width="1.5"/></svg>`;
const ICON_ELEVATOR = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><rect x="4" y="2" width="16" height="20" rx="1.5"/><line x1="12" y1="2" x2="12" y2="22"/><polyline points="8.5,7 12,4 15.5,7" fill="currentColor"/><polyline points="8.5,17 12,20 15.5,17" fill="currentColor"/></svg>`;
const ICON_ENTRANCE = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M14 2 L14 22 L20 22 L20 2 Z"/><circle cx="17" cy="12" r="0.9" fill="currentColor"/><line x1="3" y1="12" x2="12" y2="12"/><polyline points="9,8 13,12 9,16"/></svg>`;
const ICON_ELECTRICAL = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" fill="currentColor"><polygon points="14,2 5,14 11,14 10,22 19,10 13,10 14,2"/></svg>`;
const ICON_FIRST_AID = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="none"><rect x="3" y="3" width="18" height="18" rx="3" fill="#dc2626" stroke="#7f1d1d"/><rect x="10" y="6" width="4" height="12" fill="#ffffff"/><rect x="6" y="10" width="12" height="4" fill="#ffffff"/></svg>`;
const ICON_DIRECTION_ARROW = `<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="2" stroke-linejoin="round" fill="currentColor"><polygon points="12,2 20,11 16,11 16,22 8,22 8,11 4,11"/></svg>`;
const ICON_TEXT_LABEL = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"><path d="M4 20 L11 4 L12 4 L20 20"/><line x1="6.5" y1="14" x2="17" y2="14"/></svg>`;

/**
 * The catalog. Add new categories here — every consumer that switches on
 * `SiteElementCategory` reads from this list, so a new entry surfaces in the
 * picker, the SVG output, and the legend automatically.
 */
export const SITE_ELEMENT_CATALOG: ReadonlyArray<SiteElementCatalogEntry> = [
  // Polylines
  { category: "driving-route", geometryKind: "polyline", labelKey: "drivingRoute", strokeColor: "#4a4a4a", fillColor: "transparent", defaultWidthWorld: 3.5, emoji: "🛣️", iconSvg: ICON_DRIVING_ROUTE },
  { category: "fence", geometryKind: "polyline", labelKey: "fence", strokeColor: "#6a6e79", fillColor: "transparent", emoji: "🚧", iconSvg: ICON_FENCE },

  // Polygons
  { category: "site-cabin", geometryKind: "polygon", labelKey: "siteCabin", strokeColor: "#0063a3", fillColor: "rgba(0,99,163,0.12)", emoji: "🛖", iconSvg: ICON_SITE_CABIN },
  { category: "demolition-area", geometryKind: "polygon", labelKey: "demolitionArea", strokeColor: "#da212c", fillColor: "rgba(218,33,44,0.15)", emoji: "💥", iconSvg: ICON_DEMOLITION },
  { category: "loading-area", geometryKind: "polygon", labelKey: "loadingArea", strokeColor: "#15803d", fillColor: "rgba(21,128,61,0.12)", emoji: "📦", iconSvg: ICON_LOADING },
  { category: "parking", geometryKind: "polygon", labelKey: "parking", strokeColor: "#1e88c4", fillColor: "rgba(30,136,196,0.12)", emoji: "🅿️", iconSvg: ICON_PARKING },

  // Point markers
  { category: "crane", geometryKind: "point", labelKey: "crane", strokeColor: "#003f69", fillColor: "#0063a3", symbolId: "symbol-crane", emoji: "🏗️", iconSvg: ICON_CRANE },
  { category: "gate", geometryKind: "point", labelKey: "gate", strokeColor: "#6a6e79", fillColor: "#a3a6b1", symbolId: "symbol-gate", emoji: "🚪", iconSvg: ICON_GATE },
  { category: "waste-container", geometryKind: "point", labelKey: "wasteContainer", strokeColor: "#6a3b0a", fillColor: "#e49325", symbolId: "symbol-waste", emoji: "🗑️", iconSvg: ICON_WASTE },
  { category: "elevator", geometryKind: "point", labelKey: "elevator", strokeColor: "#003f69", fillColor: "#1e88c4", symbolId: "symbol-elevator", emoji: "🛗", iconSvg: ICON_ELEVATOR },
  { category: "entrance", geometryKind: "point", labelKey: "entrance", strokeColor: "#15803d", fillColor: "#86efac", symbolId: "symbol-entrance", emoji: "🚶", iconSvg: ICON_ENTRANCE },
  { category: "electrical-cabinet", geometryKind: "point", labelKey: "electricalCabinet", strokeColor: "#7c2d12", fillColor: "#fbbf24", symbolId: "symbol-electrical", emoji: "⚡", iconSvg: ICON_ELECTRICAL },
  { category: "first-aid", geometryKind: "point", labelKey: "firstAid", strokeColor: "#7f1d1d", fillColor: "#fee2e2", symbolId: "symbol-first-aid", emoji: "⛑️", iconSvg: ICON_FIRST_AID },
  { category: "direction-arrow", geometryKind: "point", labelKey: "directionArrow", strokeColor: "#1c1c1c", fillColor: "#facc15", symbolId: "symbol-direction", emoji: "➡️", iconSvg: ICON_DIRECTION_ARROW },
  { category: "text-label", geometryKind: "text", labelKey: "textLabel", strokeColor: "#000000", fillColor: "transparent", emoji: "🅰️", iconSvg: ICON_TEXT_LABEL },
];

export function findCatalogEntry(category: SiteElementCategory): SiteElementCatalogEntry | null {
  return SITE_ELEMENT_CATALOG.find((entry) => entry.category === category) ?? null;
}

/**
 * Returns the inline `<symbol>` markup for a point category. Symbols are
 * authored in a 100×100 viewport for easy editing; the SVG output renders
 * them at the world `sizeWorld` chosen by the caller (default 1.5 m).
 */
export function getPointSymbolMarkup(symbolId: string): string | null {
  return POINT_SYMBOL_MARKUP[symbolId] ?? null;
}

/**
 * Each symbol's primary "body" fill and stroke are written as
 * `var(--site-symbol-fill)` / `var(--site-symbol-stroke)`. The renderer
 * sets those custom properties on the wrapping `<use>` element when an
 * element is placed, so the user's colour-picker choices propagate
 * through the symbol's internal `<circle>`, `<rect>`, etc.
 *
 * `fallback` colour after the comma in `var(name, fallback)` matches the
 * old hardcoded palette — so an unstyled symbol still renders in the
 * same brand colour it always did.
 *
 * Contrast accents (white glyphs / dark crosses) stay hardcoded so the
 * icon remains legible regardless of the user's fill colour.
 */
/**
 * Symbol authoring conventions — applied after consulting a graphic
 * designer + UX reviewer in 2026-06:
 *   - Top-down (plan-view) silhouettes, NOT 3D iso. The map is a 2D
 *     plan; isometric icons fight the medium.
 *   - High inside contrast: every icon is a recognisable silhouette
 *     against any background colour the user picks.
 *   - Bold outline (stroke-width 5 in the 100×100 viewport) so the
 *     icon stays readable when zoomed out.
 *   - Use of universal pictograms over text (e.g. ⚡ for power, ♿/+
 *     wrap for first aid) so the language barrier goes away.
 *   - All recolourable parts via `--site-symbol-fill` /
 *     `--site-symbol-stroke` so per-element overrides actually
 *     propagate (see `siteElementCatalog.ts`).
 */
const POINT_SYMBOL_MARKUP: Readonly<Record<string, string>> = Object.freeze({
  // Tower-crane plan icon — silhouette of the load-bearing jib + counter
  // jib, mast at centre, rotation-arrow hint. Drops the previous
  // "compass + tiny rect" look that read more like a thermostat than a
  // crane to most viewers.
  "symbol-crane": `<symbol id="symbol-crane" viewBox="0 0 100 100" overflow="visible">
    <!-- Slewing footprint circle -->
    <circle cx="50" cy="50" r="44" fill="var(--site-symbol-fill, rgba(0,99,163,0.18))" stroke="var(--site-symbol-stroke, #003f69)" stroke-width="5"/>
    <!-- Counter-jib (shorter, left) -->
    <rect x="14" y="46" width="22" height="8" rx="2" fill="var(--site-symbol-stroke, #003f69)"/>
    <!-- Main jib (longer, right) -->
    <rect x="50" y="46" width="38" height="8" rx="2" fill="var(--site-symbol-stroke, #003f69)"/>
    <!-- Counterweight block -->
    <rect x="10" y="42" width="8" height="16" rx="1.5" fill="var(--site-symbol-stroke, #003f69)"/>
    <!-- Centre mast cross-section -->
    <circle cx="50" cy="50" r="8" fill="var(--site-symbol-fill, #ffffff)" stroke="var(--site-symbol-stroke, #003f69)" stroke-width="3"/>
    <!-- Rotation indicator arrow -->
    <path d="M 50 22 A 28 28 0 0 1 78 50" fill="none" stroke="var(--site-symbol-stroke, #003f69)" stroke-width="2.5" stroke-linecap="round"/>
    <polygon points="75,46 82,49 76,53" fill="var(--site-symbol-stroke, #003f69)"/>
  </symbol>`,
  // Gate plan icon — opening fence panel with hinge dots. The earlier
  // "two posts + dashed arc" was too abstract; this one reads as a
  // door/gate immediately.
  "symbol-gate": `<symbol id="symbol-gate" viewBox="0 0 100 100" overflow="visible">
    <!-- Left fixed post -->
    <rect x="10" y="44" width="8" height="12" rx="1" fill="var(--site-symbol-stroke, #6a6e79)"/>
    <!-- Right fixed post -->
    <rect x="82" y="44" width="8" height="12" rx="1" fill="var(--site-symbol-stroke, #6a6e79)"/>
    <!-- Opening leaf (rotates around the left post hinge) -->
    <rect x="18" y="46" width="44" height="8" rx="1.5" fill="var(--site-symbol-fill, #a3a6b1)" stroke="var(--site-symbol-stroke, #6a6e79)" stroke-width="2.5" transform="rotate(-35 18 50)"/>
    <!-- Hinge dots -->
    <circle cx="18" cy="50" r="2.5" fill="var(--site-symbol-stroke, #6a6e79)"/>
    <!-- Swing path arrow -->
    <path d="M 30 30 A 25 25 0 0 1 50 18" fill="none" stroke="var(--site-symbol-stroke, #6a6e79)" stroke-width="2" stroke-dasharray="3 2"/>
    <polygon points="48,16 54,18 50,22" fill="var(--site-symbol-stroke, #6a6e79)"/>
  </symbol>`,
  // Waste container — dumpster top-down with a clear hinged lid. The
  // earlier "X across the lid" looked like a barricaded crate; this
  // version reads as "open container with lid" much more readily.
  "symbol-waste": `<symbol id="symbol-waste" viewBox="0 0 100 100" overflow="visible">
    <!-- Container body -->
    <rect x="14" y="26" width="72" height="48" rx="4" fill="var(--site-symbol-fill, #e49325)" stroke="var(--site-symbol-stroke, #6a3b0a)" stroke-width="5"/>
    <!-- Lid hinge bar across the top -->
    <rect x="14" y="22" width="72" height="6" rx="1" fill="var(--site-symbol-stroke, #6a3b0a)"/>
    <!-- Lid hinges -->
    <circle cx="26" cy="25" r="3" fill="var(--site-symbol-fill, #ffffff)" stroke="var(--site-symbol-stroke, #6a3b0a)" stroke-width="1.5"/>
    <circle cx="74" cy="25" r="3" fill="var(--site-symbol-fill, #ffffff)" stroke="var(--site-symbol-stroke, #6a3b0a)" stroke-width="1.5"/>
    <!-- "Recycle / waste" arrows inside, simplified -->
    <path d="M 35 55 L 50 40 L 65 55" fill="none" stroke="var(--site-symbol-stroke, #6a3b0a)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M 50 40 L 50 65" fill="none" stroke="var(--site-symbol-stroke, #6a3b0a)" stroke-width="3" stroke-linecap="round"/>
  </symbol>`,
  // Elevator/lift cab — door split + a clear bidirectional arrow.
  // Removed the four-arrow pinwheel that read as "compass" from a
  // distance; one tall up/down arrow is the standard pictogram.
  "symbol-elevator": `<symbol id="symbol-elevator" viewBox="0 0 100 100" overflow="visible">
    <rect x="22" y="14" width="56" height="72" rx="3" fill="var(--site-symbol-fill, #1e88c4)" stroke="var(--site-symbol-stroke, #003f69)" stroke-width="5"/>
    <line x1="50" y1="14" x2="50" y2="86" stroke="var(--site-symbol-stroke, #003f69)" stroke-width="3"/>
    <!-- Single bidirectional arrow centred between the door leaves -->
    <polygon points="36,30 50,18 64,30" fill="#ffffff"/>
    <polygon points="36,70 50,82 64,70" fill="#ffffff"/>
    <rect x="46" y="30" width="8" height="40" fill="#ffffff"/>
  </symbol>`,
  // Entrance — doorway viewed from above with a pedestrian arrow
  // pointing INTO the building. Replaces the previous "filled door
  // slab + arrow-from-left" which was ambiguous about direction.
  "symbol-entrance": `<symbol id="symbol-entrance" viewBox="0 0 100 100" overflow="visible">
    <rect x="22" y="16" width="56" height="68" rx="3" fill="var(--site-symbol-fill, #86efac)" stroke="var(--site-symbol-stroke, #15803d)" stroke-width="5"/>
    <!-- Open door wedge at bottom — shows the threshold the user crosses -->
    <path d="M 22 84 L 38 64 L 38 84 Z" fill="var(--site-symbol-stroke, #15803d)"/>
    <!-- Person silhouette walking in (head + shoulders, simplified) -->
    <circle cx="50" cy="38" r="6" fill="var(--site-symbol-stroke, #15803d)"/>
    <path d="M 42 60 Q 50 46 58 60" fill="var(--site-symbol-stroke, #15803d)"/>
    <!-- Direction arrow pointing into the doorway -->
    <line x1="50" y1="62" x2="50" y2="74" stroke="var(--site-symbol-stroke, #15803d)" stroke-width="3" stroke-linecap="round"/>
    <polygon points="46,72 50,80 54,72" fill="var(--site-symbol-stroke, #15803d)"/>
  </symbol>`,
  // Electrical cabinet — bold lightning bolt on a circuit-pictogram
  // background. The previous design's "cabinet outline + two screws"
  // didn't read as "electricity" without context.
  "symbol-electrical": `<symbol id="symbol-electrical" viewBox="0 0 100 100" overflow="visible">
    <rect x="14" y="14" width="72" height="72" rx="6" fill="var(--site-symbol-fill, #fbbf24)" stroke="var(--site-symbol-stroke, #7c2d12)" stroke-width="5"/>
    <!-- Lightning bolt — the universal "electricity hazard" pictogram -->
    <polygon points="56,20 36,52 48,52 42,80 64,46 52,46 58,20" fill="var(--site-symbol-stroke, #7c2d12)" stroke="var(--site-symbol-stroke, #7c2d12)" stroke-width="2" stroke-linejoin="round"/>
  </symbol>`,
  // First-aid station — white cross on red, rounded corners. Already
  // standard / universally recognised; bumped corner radius for
  // friendlier feel + thicker arms so the cross stays bold at small
  // sizes.
  "symbol-first-aid": `<symbol id="symbol-first-aid" viewBox="0 0 100 100" overflow="visible">
    <rect x="8" y="8" width="84" height="84" rx="14" fill="var(--site-symbol-fill, #dc2626)" stroke="var(--site-symbol-stroke, #7f1d1d)" stroke-width="5"/>
    <rect x="40" y="20" width="20" height="60" rx="3" fill="#ffffff"/>
    <rect x="20" y="40" width="60" height="20" rx="3" fill="#ffffff"/>
  </symbol>`,
  // Direction-of-travel arrow — tall block arrow pointing up. The
  // user rotates it via the edit-overlay rotation handle. Outline
  // contrast makes it readable on any background colour.
  "symbol-direction": `<symbol id="symbol-direction" viewBox="0 0 100 100" overflow="visible">
    <polygon points="50,6 80,42 64,42 64,94 36,94 36,42 20,42" fill="var(--site-symbol-fill, #facc15)" stroke="var(--site-symbol-stroke, #1c1c1c)" stroke-width="5" stroke-linejoin="round"/>
  </symbol>`,
});

/**
 * Recommended default world size for a point marker, in metres. Picked so a
 * full-floor floorplan still shows the markers without crowding.
 */
export const DEFAULT_POINT_SIZE_WORLD = 1.5;
