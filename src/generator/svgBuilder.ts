import type { BackgroundImage, LabelPosition, Polygon, RenderOptions, SiteElement, StoreyDocument, UserArea, Vec2 } from "../types";
import { DEFAULT_RENDER_OPTIONS } from "../types";
import { computeRenderingBbox, withMargin } from "../utils/bbox";
import { polygonCentroid } from "../utils/centroid";
import { escapeXmlAttribute, escapeXmlText } from "../utils/escape";
import { DEFAULT_POINT_SIZE_WORLD, findCatalogEntry, getPointSymbolMarkup, SITE_ELEMENT_CATALOG } from "../annotator/siteElementCatalog";

const SVG_NS = "http://www.w3.org/2000/svg";
const PATH_COORDINATE_PRECISION = 4;
const TEXT_COORDINATE_PRECISION = 3;
const DEFAULT_MARGIN_FRACTION = 0.05;
const SVG_VERSION_TAG = "trimble-sitePlan2D-1.0";

const DEFAULT_TYPE_STROKES: Readonly<Record<string, string>> = Object.freeze({
  IfcWall: "#1c1c1c",
  IfcWallStandardCase: "#1c1c1c",
  IfcCurtainWall: "#1c1c1c",
  IfcSlab: "#6a6e79",
  IfcRoof: "#15803d",
  IfcColumn: "#353a40",
  IfcBeam: "#353a40",
  IfcDoor: "#c2410c",
  IfcWindow: "#1e88c4",
  IfcStair: "#7c3aed",
  IfcStairFlight: "#7c3aed",
  IfcRamp: "#7c3aed",
  IfcRailing: "#a3a6b1",
  IfcFurnishingElement: "#6a6e79",
  IfcFurniture: "#6a6e79",
});

const DEFAULT_USER_AREA_KIND_COLORS: Readonly<Record<string, string>> = Object.freeze({
  work: "#0063a3",
  takt: "#e49325",
  other: "#6a6e79",
});

export interface BuildSvgOptions {
  marginFraction?: number;
  renderOptions?: RenderOptions;
}

/**
 * Emit a self-contained SVG string for one storey.
 *
 * Layered z-order (back to front):
 *   1. Background image (`<image>` calibrated against world coordinates).
 *   2. IFC content (the floorplan itself).
 *   3. User work / takt zones (`.user-areas`).
 *   4. Construction site-plan elements (`.site-elements`, polylines + point symbols).
 *   5. Labels (`.labels`).
 *
 * All styling lives inside the `<defs><style>` block as CSS custom properties.
 * `<path>`, `<image>`, `<use>` and `<text>` elements only carry geometry +
 * identity attributes (`d`, `class`, `data-*`), so re-skinning the SVG is a
 * stylesheet edit, not an attribute hunt.
 */
export function buildStoreySvg(doc: StoreyDocument, options: BuildSvgOptions = {}): string {
  const marginFraction = options.marginFraction ?? DEFAULT_MARGIN_FRACTION;
  const renderOptions = options.renderOptions ?? doc.renderOptions ?? DEFAULT_RENDER_OPTIONS;
  // Use the union of IFC + user-area + site-element + background-image
  // bbox so the emitted SVG's viewBox covers user annotations that sit
  // outside the IFC footprint. The JSON's persisted `doc.boundingBox`
  // stays IFC-only because that field describes the source geometry.
  const bbox = withMargin(computeRenderingBbox(doc), marginFraction);
  const width = bbox.xMax - bbox.xMin || 1;
  const height = bbox.yMax - bbox.yMin || 1;
  const viewBox = `${fmt(bbox.xMin, PATH_COORDINATE_PRECISION)} ${fmt(bbox.yMin, PATH_COORDINATE_PRECISION)} ${fmt(width, PATH_COORDINATE_PRECISION)} ${fmt(height, PATH_COORDINATE_PRECISION)}`;
  const flipOffset = bbox.yMin + bbox.yMax;

  const usedIfcTypes = Array.from(new Set(doc.objects.map((object) => object.ifcType))).sort();
  const styleBlock = buildStyleBlock(renderOptions, usedIfcTypes, doc);
  const metadataBlock = buildMetadataBlock(doc);
  const symbolsBlock = buildSymbolsBlock();

  const backgroundContent = renderBackgroundImage(doc.backgroundImage ?? null);
  const ifcPathsByType = groupObjectsByType(doc);
  const ifcContent = renderIfcContent(ifcPathsByType, renderOptions);
  const ifcLabels = renderIfcLabels(ifcPathsByType, renderOptions);
  const userAreaContent = renderUserAreas(doc.userAreas);
  const userAreaLabels = renderUserAreaLabels(doc.userAreas, renderOptions);
  const siteContent = renderSiteElements(doc.siteElements ?? []);
  const siteLabels = renderSiteElementLabels(doc.siteElements ?? [], renderOptions);

  return [
    `<svg xmlns="${SVG_NS}" viewBox="${viewBox}" data-unit="${escapeXmlAttribute(doc.units)}" data-storey-guid="${escapeXmlAttribute(doc.storey.ifcGuid)}" data-source-file-id="${escapeXmlAttribute(doc.source.fileId)}" data-generator="${SVG_VERSION_TAG}">`,
    `<defs>${symbolsBlock}<style>${styleBlock}</style></defs>`,
    metadataBlock,
    `<g class="floorplan" transform="translate(0 ${fmt(flipOffset, PATH_COORDINATE_PRECISION)}) scale(1 -1)">`,
    backgroundContent,
    `<g class="ifc-content">${ifcContent}</g>`,
    `<g class="user-areas">${userAreaContent}</g>`,
    `<g class="site-elements">${siteContent}</g>`,
    `<g class="labels ifc-labels">${ifcLabels}</g>`,
    `<g class="labels user-area-labels">${userAreaLabels}</g>`,
    `<g class="labels site-element-labels">${siteLabels}</g>`,
    `</g>`,
    `</svg>`,
  ].join("");
}

function buildStyleBlock(
  renderOptions: RenderOptions,
  usedIfcTypes: ReadonlyArray<string>,
  doc: StoreyDocument,
): string {
  const defaultsBlock = buildDefaultVariableBlock(renderOptions);
  const perTypeVariables = buildPerTypeVariableBlock(renderOptions, usedIfcTypes);
  const siteCategoryVariables = buildSiteCategoryVariableBlock();
  const classRules = buildClassRuleBlock(usedIfcTypes);
  const objectOverrides = buildObjectStyleOverrides(renderOptions);
  const userAreaOverrides = buildUserAreaOverrides(doc.userAreas, renderOptions);
  return `${defaultsBlock}${perTypeVariables}${siteCategoryVariables}${classRules}${objectOverrides}${userAreaOverrides}`;
}

/**
 * Emit one CSS rule per IFC GUID that the user has individually styled
 * (fill, stroke, fillVisible=false). Selectors target `[data-ifc-guid]`
 * so the rule wins over the type-level class rule by specificity.
 */
function buildObjectStyleOverrides(renderOptions: RenderOptions): string {
  const rules: string[] = [];
  for (const [guid, style] of Object.entries(renderOptions.objectStyles)) {
    const props: string[] = [];
    if (style.strokeColor) props.push(`stroke: ${style.strokeColor}`);
    if (style.fillColor) props.push(`fill: ${style.fillColor}`);
    else if (style.fillVisible === false) props.push(`fill: none`);
    if (props.length === 0) continue;
    rules.push(`[data-ifc-guid="${escapeXmlAttribute(guid)}"] { ${props.join("; ")}; }`);
  }
  return rules.join("");
}

/**
 * Emit one CSS rule per user-area that has an individual stroke-width or
 * font-size override. The text labels for those areas also get a CSS rule
 * targeting `[data-area-label-for="<id>"]` so per-area font sizing works
 * without inline style attributes.
 */
function buildUserAreaOverrides(
  userAreas: ReadonlyArray<UserArea>,
  renderOptions: RenderOptions,
): string {
  const rules: string[] = [];
  for (const area of userAreas) {
    const safeId = escapeXmlAttribute(area.id);
    const pathProps: string[] = [];
    if (area.strokeWidthWorld != null && area.strokeWidthWorld > 0) {
      pathProps.push(`stroke-width: ${fmt(area.strokeWidthWorld, TEXT_COORDINATE_PRECISION)}`);
    }
    if (pathProps.length > 0) {
      rules.push(`[data-user-area-id="${safeId}"] { ${pathProps.join("; ")}; }`);
    }
    const labelFontSize = area.labelFontSizeWorld ?? renderOptions.fontSizeWorld;
    if (area.labelFontSizeWorld != null && area.labelFontSizeWorld > 0) {
      rules.push(
        `[data-area-label-for="${safeId}"] { font-size: ${fmt(labelFontSize, TEXT_COORDINATE_PRECISION)}; }`,
      );
    }
  }
  return rules.join("");
}

function buildDefaultVariableBlock(renderOptions: RenderOptions): string {
  const sharedFill = sharedFillValueFor(renderOptions);
  const strokeWidth = renderOptions.strokeWidthWorld > 0 ? renderOptions.strokeWidthWorld : 0.05;
  return [
    `:root {`,
    `--floorplan-stroke: #1c1c1c;`,
    `--floorplan-stroke-width: ${fmt(strokeWidth, TEXT_COORDINATE_PRECISION)};`,
    `--floorplan-fill: ${sharedFill};`,
    `--floorplan-label-font-family: "Open Sans", "Segoe UI", Roboto, sans-serif;`,
    `--floorplan-label-font-size: ${fmt(renderOptions.fontSizeWorld, TEXT_COORDINATE_PRECISION)};`,
    `--floorplan-label-fill: #252a2e;`,
    `--floorplan-label-halo: rgba(255,255,255,0.85);`,
    `--floorplan-user-area-stroke: #e49325;`,
    `--floorplan-user-area-stroke-width: 0.08;`,
    `--floorplan-user-area-fill: rgba(228,147,37,0.18);`,
    `--floorplan-user-area-label-fill: #6a3b0a;`,
    `--floorplan-user-area-work-stroke: ${DEFAULT_USER_AREA_KIND_COLORS["work"]};`,
    `--floorplan-user-area-takt-stroke: ${DEFAULT_USER_AREA_KIND_COLORS["takt"]};`,
    `--floorplan-user-area-other-stroke: ${DEFAULT_USER_AREA_KIND_COLORS["other"]};`,
    `--floorplan-site-stroke-width: 0.12;`,
    `--floorplan-site-polyline-stroke-width: 0.18;`,
    `--floorplan-background-opacity: 1;`,
    `}`,
  ].join("");
}

function buildPerTypeVariableBlock(renderOptions: RenderOptions, usedIfcTypes: ReadonlyArray<string>): string {
  if (usedIfcTypes.length === 0) return "";
  const declarations: string[] = [];
  for (const typeName of usedIfcTypes) {
    const override = renderOptions.typeStyles[typeName];
    const strokeColor = override?.strokeColor ?? DEFAULT_TYPE_STROKES[typeName] ?? "#1c1c1c";
    const fillColor = perTypeFillValueFor(renderOptions, typeName, override?.fillColor);
    const safe = cssVarSafeName(typeName);
    declarations.push(`--floorplan-${safe}-stroke: ${strokeColor};`);
    declarations.push(`--floorplan-${safe}-fill: ${fillColor};`);
  }
  return `:root {${declarations.join("")}}`;
}

function buildSiteCategoryVariableBlock(): string {
  const declarations: string[] = [];
  for (const entry of SITE_ELEMENT_CATALOG) {
    const safe = cssVarSafeName(entry.category);
    declarations.push(`--floorplan-site-${safe}-stroke: ${entry.strokeColor};`);
    declarations.push(`--floorplan-site-${safe}-fill: ${entry.fillColor};`);
  }
  return `:root {${declarations.join("")}}`;
}

function buildClassRuleBlock(usedIfcTypes: ReadonlyArray<string>): string {
  const lines: string[] = [
    `.ifc-object { fill: var(--floorplan-fill); stroke: var(--floorplan-stroke); stroke-width: var(--floorplan-stroke-width); vector-effect: non-scaling-stroke; }`,
  ];
  for (const typeName of usedIfcTypes) {
    const safe = cssVarSafeName(typeName);
    const cls = cssClassNameFor(typeName);
    lines.push(`.${cls} { stroke: var(--floorplan-${safe}-stroke); fill: var(--floorplan-${safe}-fill); }`);
  }
  lines.push(
    `.user-area { stroke: var(--floorplan-user-area-stroke); stroke-width: var(--floorplan-user-area-stroke-width); fill: var(--floorplan-user-area-fill); vector-effect: non-scaling-stroke; }`,
    `.user-area--work { stroke: var(--floorplan-user-area-work-stroke); }`,
    `.user-area--takt { stroke: var(--floorplan-user-area-takt-stroke); }`,
    `.user-area--other { stroke: var(--floorplan-user-area-other-stroke); }`,
    `.site-element-polyline { fill: none; stroke-width: var(--floorplan-site-polyline-stroke-width); vector-effect: non-scaling-stroke; stroke-linecap: round; stroke-linejoin: round; }`,
    `.site-element-polygon { stroke-width: var(--floorplan-site-stroke-width); vector-effect: non-scaling-stroke; }`,
    `.site-element-point { vector-effect: non-scaling-stroke; }`,
  );
  for (const entry of SITE_ELEMENT_CATALOG) {
    const safe = cssVarSafeName(entry.category);
    const cls = `site-${safe}`;
    lines.push(`.${cls} { stroke: var(--floorplan-site-${safe}-stroke); fill: var(--floorplan-site-${safe}-fill); }`);
  }
  lines.push(
    `.background-image { opacity: var(--floorplan-background-opacity); }`,
    // NB: font-size is set as an SVG attribute on each <text> element (see
    // buildLabelText) — unitless CSS font-size is invalid and would fall
    // back to the 16-CSS-pixel browser default. The variable
    // --floorplan-label-font-size is published for downstream re-skinning
    // (someone can wire it back into a stylesheet if they prefer CSS), but
    // no in-app rule consumes it.
    `.ifc-label, .user-area-label, .site-element-label { font-family: var(--floorplan-label-font-family); fill: var(--floorplan-label-fill); text-anchor: middle; dominant-baseline: central; paint-order: stroke fill; stroke: var(--floorplan-label-halo); stroke-width: 0.18; vector-effect: non-scaling-stroke; }`,
    `.user-area-label { fill: var(--floorplan-user-area-label-fill); }`,
  );
  return lines.join("");
}

function sharedFillValueFor(renderOptions: RenderOptions): string {
  switch (renderOptions.fillStyle) {
    case "single":
      return renderOptions.singleFillColor;
    case "perType":
    case "none":
    default:
      return "none";
  }
}

function perTypeFillValueFor(renderOptions: RenderOptions, typeName: string, override: string | undefined): string {
  if (override) return override;
  if (renderOptions.fillStyle === "perType") {
    // Earlier we used `color-mix(in srgb, currentColor 12%, transparent)`
    // so each type's fill matched its stroke. The legacy SVG-to-PDF
    // backend couldn't parse `color-mix()` and threw during export; we
    // dropped it but keep an explicit rgba() built from the type's
    // default stroke hex so downstream rasterisers (and any consumer
    // that piggybacks on the same SVG) see a concrete colour.
    const strokeHex = DEFAULT_TYPE_STROKES[typeName] ?? "#1c1c1c";
    return hexToRgba(strokeHex, 0.12);
  }
  if (renderOptions.fillStyle === "single") return renderOptions.singleFillColor;
  return "none";
}

function buildSymbolsBlock(): string {
  return SITE_ELEMENT_CATALOG.filter((entry) => entry.symbolId)
    .map((entry) => getPointSymbolMarkup(entry.symbolId ?? "") ?? "")
    .join("");
}

function buildMetadataBlock(doc: StoreyDocument): string {
  const payload = {
    schemaVersion: doc.schemaVersion,
    generator: doc.generator,
    source: doc.source,
    storey: doc.storey,
    units: doc.units,
    boundingBox: doc.boundingBox,
    cutHeightAboveStorey: doc.cutHeightAboveStorey,
    generatedAt: doc.generatedAt,
  };
  // CDATA sections can't contain the literal `]]>` — if any string in
  // the payload (e.g. an IFC file name, project name, storey name)
  // contained `]]>`, the CDATA would close early and the rest would be
  // parsed as XML, opening the door to script injection via downstream
  // consumers. The standard escape is to split the `]]>` across two
  // CDATA sections.
  const serialised = JSON.stringify(payload).replace(/\]\]>/g, "]]]]><![CDATA[>");
  return `<metadata><![CDATA[${serialised}]]></metadata>`;
}

function renderBackgroundImage(image: BackgroundImage | null): string {
  if (!image) return "";
  const x = fmt(image.origin[0], PATH_COORDINATE_PRECISION);
  const y = fmt(image.origin[1], PATH_COORDINATE_PRECISION);
  const widthString = fmt(image.widthWorld, PATH_COORDINATE_PRECISION);
  const heightString = fmt(image.heightWorld, PATH_COORDINATE_PRECISION);
  const centerX = image.origin[0] + image.widthWorld / 2;
  const centerY = image.origin[1] + image.heightWorld / 2;
  // The parent group flips Y. We compensate locally (scale(1,-1)) so the
  // raster pixels are not upside-down, and apply rotation around the image
  // centre in unflipped world space.
  const transform =
    `translate(${fmt(centerX, PATH_COORDINATE_PRECISION)} ${fmt(centerY, PATH_COORDINATE_PRECISION)}) ` +
    `rotate(${fmt(-image.rotationDeg, PATH_COORDINATE_PRECISION)}) ` +
    `scale(1 -1) ` +
    `translate(${fmt(-centerX, PATH_COORDINATE_PRECISION)} ${fmt(-centerY, PATH_COORDINATE_PRECISION)})`;
  return (
    `<g class="background-image" style="--floorplan-background-opacity: ${fmt(image.opacity, 3)};">` +
    `<image href="${escapeXmlAttribute(image.href)}" x="${x}" y="${y}" width="${widthString}" height="${heightString}" preserveAspectRatio="none" transform="${transform}" data-background="true"/>` +
    `</g>`
  );
}

interface GroupedObjects {
  ifcType: string;
  cssClass: string;
  objects: ReadonlyArray<{
    ifcGuid: string;
    name: string;
    longName: string | null;
    polygons: Polygon[];
  }>;
}

function groupObjectsByType(doc: StoreyDocument): GroupedObjects[] {
  const byType = new Map<string, GroupedObjects>();
  for (const object of doc.objects) {
    let bucket = byType.get(object.ifcType);
    if (!bucket) {
      bucket = { ifcType: object.ifcType, cssClass: cssClassNameFor(object.ifcType), objects: [] };
      byType.set(object.ifcType, bucket);
    }
    (bucket.objects as Array<unknown>).push({
      ifcGuid: object.ifcGuid,
      name: object.name,
      longName: object.longName,
      polygons: object.polygons,
    });
  }
  return Array.from(byType.values()).sort((a, b) => a.ifcType.localeCompare(b.ifcType));
}

/**
 * Deterministic palette used when `fillStyle === "byName"`. Each distinct
 * `IfcName` is hashed to a stable index into this list so the same name
 * gets the same colour across storeys, exports, and re-renders.
 */
const NAME_PALETTE: ReadonlyArray<string> = Object.freeze([
  "#0063a3", "#e49325", "#1e8a44", "#7c3aed", "#c2410c",
  "#1e88c4", "#da212c", "#15803d", "#7c2d12", "#0f766e",
  "#9333ea", "#facc15", "#0891b2", "#be123c", "#0e7490",
  "#4f46e5", "#65a30d", "#dc2626", "#0d9488", "#a16207",
]);

/**
 * DJB2-style 32-bit hash. Produces the same value across runs and
 * platforms — we use it to pick a palette colour per `IfcName`.
 */
function hashStringToInt(value: string): number {
  let h = 5381;
  for (let i = 0; i < value.length; i += 1) {
    h = ((h << 5) + h + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function colourForName(name: string): string {
  if (!name) return NAME_PALETTE[0]!;
  return NAME_PALETTE[hashStringToInt(name) % NAME_PALETTE.length]!;
}

/**
 * Convert a `#rrggbb` (or `#rgb`) string into an `rgba(r, g, b, a)` string.
 *
 * We emit `rgba()` instead of CSS-4 `color-mix(in srgb, X 22%, transparent)`
 * because the original SVG-to-PDF exporter (svg2pdf.js, since removed)
 * could not parse `color-mix` and the bug taught us that downstream
 * consumers vary widely in CSS support. `rgba()` has been part of CSS
 * Color 3 for over a decade and every PDF / SVG consumer understands it.
 *
 * Falls back to the original input when the colour isn't a hex literal
 * (e.g. a named colour or already an `rgba()` value) so the caller doesn't
 * have to special-case.
 */
function hexToRgba(hex: string, alpha: number): string {
  const m6 = /^#([0-9a-fA-F]{6})$/.exec(hex);
  if (m6) {
    const r = parseInt(m6[1]!.slice(0, 2), 16);
    const g = parseInt(m6[1]!.slice(2, 4), 16);
    const b = parseInt(m6[1]!.slice(4, 6), 16);
    return `rgba(${r}, ${g}, ${b}, ${clampAlpha(alpha)})`;
  }
  const m3 = /^#([0-9a-fA-F]{3})$/.exec(hex);
  if (m3) {
    const r = parseInt(m3[1]!.charAt(0).repeat(2), 16);
    const g = parseInt(m3[1]!.charAt(1).repeat(2), 16);
    const b = parseInt(m3[1]!.charAt(2).repeat(2), 16);
    return `rgba(${r}, ${g}, ${b}, ${clampAlpha(alpha)})`;
  }
  return hex;
}

function clampAlpha(value: number): string {
  const v = Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : 1;
  return v.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function renderIfcContent(groups: ReadonlyArray<GroupedObjects>, renderOptions: RenderOptions): string {
  return groups
    .map((group) => {
      const paths = group.objects
        .map((object) =>
          object.polygons
            .map((polygon) =>
              buildIfcPath(polygon, object.ifcGuid, group.ifcType, group.cssClass, object.name, object.longName, renderOptions),
            )
            .join(""),
        )
        .join("");
      return `<g class="ifc-group ${group.cssClass}-group" data-ifc-type="${escapeXmlAttribute(group.ifcType)}">${paths}</g>`;
    })
    .join("");
}

function buildIfcPath(
  polygon: Polygon,
  ifcGuid: string,
  ifcType: string,
  cssClass: string,
  name: string,
  longName: string | null,
  renderOptions: RenderOptions,
): string {
  const d = polygonToPathD(polygon);
  if (!d) return "";
  const longNameAttribute = longName === null ? "" : ` data-ifc-long-name="${escapeXmlAttribute(longName)}"`;
  // For `byName` we emit an inline style attribute per path because CSS
  // attribute selectors inside an embedded SVG `<style>` block have proven
  // unreliable across browsers (specificity collisions with `.ifc-object`
  // and quirks in how SVG2 cascades). Inline style wins by SVG presentation
  // rules without ambiguity.
  let inlineStyle = "";
  if (renderOptions.fillStyle === "byName" && name) {
    const base = colourForName(name);
    inlineStyle = ` style="fill: ${hexToRgba(base, 0.22)}; stroke: ${base};"`;
  }
  return (
    `<path d="${d}" class="ifc-object ${cssClass}"` +
    ` data-ifc-guid="${escapeXmlAttribute(ifcGuid)}"` +
    ` data-ifc-type="${escapeXmlAttribute(ifcType)}"` +
    ` data-ifc-name="${escapeXmlAttribute(name)}"` +
    longNameAttribute +
    inlineStyle +
    `/>`
  );
}

function renderIfcLabels(groups: ReadonlyArray<GroupedObjects>, renderOptions: RenderOptions): string {
  if (renderOptions.labelSource === "none") return "";
  return groups
    .map((group) =>
      group.objects
        .map((object) => {
          const text = renderOptions.labelSource === "name" ? object.name : object.longName ?? "";
          if (!text) return "";
          const outerRing = pickFirstRingForLabel(object.polygons);
          if (!outerRing) return "";
          const [cx, cy] = polygonCentroid(outerRing);
          return buildLabelText(cx, cy, text, "ifc-label", renderOptions.fontSizeWorld, {
            "data-ifc-guid": object.ifcGuid,
            "data-ifc-type": group.ifcType,
          });
        })
        .join(""),
    )
    .join("");
}

function renderUserAreas(areas: ReadonlyArray<UserArea>): string {
  return areas
    .map((area) => {
      if (area.polygon.length < 3) return "";
      const d = ringToPathD(area.polygon);
      // Per-area colour overrides win over the kind-based CSS palette
      // so the user gets the same "click swatch, recolour" affordance
      // as site elements. When unset, the existing class rule for the
      // kind (work / takt / other) handles colour.
      const styleProps: string[] = [];
      if (area.strokeColor) styleProps.push(`stroke: ${area.strokeColor}`);
      if (area.fillColor) styleProps.push(`fill: ${area.fillColor}`);
      const styleAttr = styleProps.length > 0 ? ` style="${styleProps.join("; ")}"` : "";
      return (
        `<path d="${d}" class="user-area user-area--${escapeXmlAttribute(area.kind)}"` +
        ` data-user-area-id="${escapeXmlAttribute(area.id)}"` +
        ` data-user-area-name="${escapeXmlAttribute(area.name)}"` +
        ` data-user-area-kind="${escapeXmlAttribute(area.kind)}"` +
        ` data-user-area-created-at="${escapeXmlAttribute(area.createdAt)}"` +
        styleAttr +
        `/>`
      );
    })
    .join("");
}

/**
 * Compute the (x, y) anchor + text-anchor pair for a label given the
 * anchor centroid, the geometry's bounding box, the font size, and the
 * user's chosen `LabelPosition`. The bbox is what we offset against
 * for the four edge positions; `center` returns the anchor itself.
 *
 * The returned `anchor` lets us drive `text-anchor` (start / middle /
 * end) so the text doesn't fall off a corner: for "above" / "below"
 * we keep middle (text grows symmetrically), for "left" / "right" we
 * snap the anchor to end / start so the text grows AWAY from the
 * geometry rather than over it.
 */
function resolveLabelPlacement(
  centroid: Vec2,
  bbox: { xMin: number; yMin: number; xMax: number; yMax: number },
  fontSize: number,
  position: LabelPosition,
): { x: number; y: number; textAnchor: "start" | "middle" | "end" } {
  // A small breathing-room gap so the text doesn't kiss the polygon edge.
  const gap = fontSize * 0.5;
  switch (position) {
    case "above":
      return { x: centroid[0], y: bbox.yMax + gap, textAnchor: "middle" };
    case "below":
      return { x: centroid[0], y: bbox.yMin - gap, textAnchor: "middle" };
    case "left":
      return { x: bbox.xMin - gap, y: centroid[1], textAnchor: "end" };
    case "right":
      return { x: bbox.xMax + gap, y: centroid[1], textAnchor: "start" };
    case "center":
    default:
      return { x: centroid[0], y: centroid[1], textAnchor: "middle" };
  }
}

function ringBbox(ring: ReadonlyArray<Vec2>): { xMin: number; yMin: number; xMax: number; yMax: number } {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const point of ring) {
    if (point[0] < xMin) xMin = point[0];
    if (point[0] > xMax) xMax = point[0];
    if (point[1] < yMin) yMin = point[1];
    if (point[1] > yMax) yMax = point[1];
  }
  return { xMin, yMin, xMax, yMax };
}

function renderUserAreaLabels(areas: ReadonlyArray<UserArea>, renderOptions: RenderOptions): string {
  if (renderOptions.userAreaLabelSource === "none") return "";
  return areas
    .map((area) => {
      if (area.polygon.length < 3) return "";
      // Per-area override wins over the global render-options choice.
      if (area.labelVisible === false) return "";
      const centroid = polygonCentroid(area.polygon);
      const fontSizeWorld = area.labelFontSizeWorld ?? renderOptions.fontSizeWorld;
      // Per-area label position + text colour (defaults: centroid, black).
      const placement = resolveLabelPlacement(
        centroid,
        ringBbox(area.polygon),
        fontSizeWorld,
        area.labelPosition ?? "center",
      );
      const cx = placement.x;
      const cy = placement.y;
      return buildLabelText(cx, cy, area.name, "user-area-label", fontSizeWorld, {
        "data-user-area-id": area.id,
        "data-area-label-for": area.id,
      }, {
        color: area.labelColor ?? "#000000",
        textAnchor: placement.textAnchor,
      });
    })
    .join("");
}

function renderSiteElements(elements: ReadonlyArray<SiteElement>): string {
  return elements
    .map((element) => {
      const entry = findCatalogEntry(element.category);
      if (!entry) return "";
      const safe = cssVarSafeName(element.category);
      const baseClass = `site-element-${entry.geometryKind} site-${safe}`;
      const dataAttrs =
        ` data-site-element-id="${escapeXmlAttribute(element.id)}"` +
        ` data-site-element-name="${escapeXmlAttribute(element.name)}"` +
        ` data-site-element-category="${escapeXmlAttribute(element.category)}"`;

      if (element.geometry.kind === "polygon") {
        const styleAttr = buildSiteInlineStyle(element, { suppressVectorEffect: false });
        const pathPart = `<path d="${ringToPathD(element.geometry.vertices)}" class="${baseClass}"${styleAttr}${dataAttrs}/>`;
        const iconPart = renderPolygonCentroidIcon(element, entry);
        return iconPart ? pathPart + iconPart : pathPart;
      }

      if (element.geometry.kind === "polyline") {
        const widthWorld = element.geometry.widthWorld;
        const hasWorldWidth = widthWorld != null && widthWorld > 0;

        // Driving routes get a layered render — white edge stripes,
        // an asphalt body on top, and a dashed centreline — so the
        // line on the floor plan reads as an actual road rather than
        // a tinted band. Ends are square (`stroke-linecap: butt`) so
        // the start and stop are perpendicular to the centreline, the
        // way road markings sit on paper. Every layer carries the
        // same `data-site-element-id` so a click on any of them
        // selects the element (and the drag-preview helper in
        // EditOverlay finds them all via `querySelectorAll`).
        if (element.category === "driving-route" && hasWorldWidth) {
          const w = widthWorld;
          // Edge stripe ~6% of the road width, capped at 0.15 m for
          // very wide roads (matches typical pavement markings).
          const stripe = Math.min(0.15, w * 0.06);
          // Asphalt = the road minus a stripe on each shoulder.
          const asphaltWidth = Math.max(0.01, w - stripe * 2);
          const dash = w * 0.25;
          const gap = w * 0.18;
          const d = polylineToPathD(element.geometry.vertices);
          const asphaltColor = element.strokeColor ?? entry.strokeColor;
          // ALL paint properties go through `style="..."` not bare
          // `stroke="..."` attributes. Reason: the .site-element-polyline
          // CSS class rule sets `stroke: var(--floorplan-...)` for the
          // category, and a CSS rule outranks a presentation attribute
          // — so the three layers would otherwise all collapse to the
          // asphalt colour and read as one fat line, which is the
          // exact regression the user just hit. Inline `style` has
          // higher specificity than the class rule.
          const baseCommon = `class="${baseClass}"${dataAttrs}`;
          const sharedStyle =
            `fill: none; stroke-linecap: butt; stroke-linejoin: miter; vector-effect: none;`;
          return (
            // Layer 1 — white shoulders. Full requested width.
            `<path d="${d}" ${baseCommon}` +
            ` style="${sharedStyle} stroke: #ffffff; stroke-width: ${fmt(w, TEXT_COORDINATE_PRECISION)};" data-road-layer="edge"/>` +
            // Layer 2 — asphalt body. Narrower stroke leaves the
            // shoulder visible behind on both sides.
            `<path d="${d}" ${baseCommon}` +
            ` style="${sharedStyle} stroke: ${asphaltColor}; stroke-width: ${fmt(asphaltWidth, TEXT_COORDINATE_PRECISION)};" data-road-layer="asphalt"/>` +
            // Layer 3 — dashed white centreline. Thinnest of the three;
            // pattern derived from the road width so it scales.
            `<path d="${d}" ${baseCommon}` +
            ` style="${sharedStyle} stroke: #ffffff; stroke-width: ${fmt(stripe, TEXT_COORDINATE_PRECISION)}; stroke-dasharray: ${fmt(dash, TEXT_COORDINATE_PRECISION)} ${fmt(gap, TEXT_COORDINATE_PRECISION)};" data-road-layer="centerline"/>`
          );
        }

        // Non-road polyline (fence, etc.) — keep the original single
        // stroke. Rounded caps + joins are appropriate for a fence
        // because it's a continuous line, not a paved surface.
        const styleAttr = buildSiteInlineStyle(element, {
          suppressVectorEffect: hasWorldWidth,
          extraProps: hasWorldWidth
            ? [
                `stroke-width: ${fmt(widthWorld, TEXT_COORDINATE_PRECISION)}`,
                `stroke-linecap: round`,
                `stroke-linejoin: round`,
                element.fillColor ? `fill: ${element.fillColor}` : `fill: none`,
              ]
            : [],
        });
        return `<path d="${polylineToPathD(element.geometry.vertices)}" class="${baseClass}"${styleAttr}${dataAttrs}/>`;
      }

      // Free-text annotation: render a <text> directly with the
      // element's `name` as the displayed string. Uses the same
      // coordinate flip as labels (the floorplan group flips Y, so the
      // text inherits a per-element `scale(1 -1)` to read normally).
      if (element.geometry.kind === "text") {
        const tg = element.geometry;
        const fontSize = tg.sizeWorld > 0 ? tg.sizeWorld : 0.5;
        const fill = element.labelColor ?? element.strokeColor ?? entry.strokeColor ?? "#000000";
        const textTransform =
          `translate(${fmt(tg.position[0], PATH_COORDINATE_PRECISION)} ${fmt(tg.position[1], PATH_COORDINATE_PRECISION)}) ` +
          `scale(1 -1) ` +
          `rotate(${fmt(tg.rotationDeg, PATH_COORDINATE_PRECISION)})`;
        return (
          `<text class="${baseClass}"` +
          ` font-size="${fmt(fontSize, TEXT_COORDINATE_PRECISION)}"` +
          ` font-family="var(--floorplan-label-font-family, sans-serif)"` +
          ` text-anchor="middle"` +
          ` dominant-baseline="central"` +
          ` style="fill: ${fill}; stroke: none;"` +
          ` transform="${textTransform}"` +
          `${dataAttrs}>${escapeXmlText(element.name)}</text>`
        );
      }

      const point = element.geometry;
      const symbolId = entry.symbolId;
      if (!symbolId) return "";
      const size = point.sizeWorld && point.sizeWorld > 0 ? point.sizeWorld : DEFAULT_POINT_SIZE_WORLD;
      const halfSize = size / 2;
      const transform =
        `translate(${fmt(point.position[0], PATH_COORDINATE_PRECISION)} ${fmt(point.position[1], PATH_COORDINATE_PRECISION)}) ` +
        `scale(1 -1) ` +
        `rotate(${fmt(point.rotationDeg, PATH_COORDINATE_PRECISION)})`;
      // Symbol shapes pick up these CSS variables (see `siteElementCatalog`).
      // Plain `fill` / `stroke` on the <use> wouldn't propagate because
      // the symbol's internal <circle>, <rect>, etc. set their own
      // explicit fill / stroke attributes that win the cascade.
      const symbolStyleProps: string[] = [];
      const effectiveFill = element.fillColor ?? entry.fillColor;
      const effectiveStroke = element.strokeColor ?? entry.strokeColor;
      symbolStyleProps.push(`--site-symbol-fill: ${effectiveFill}`);
      symbolStyleProps.push(`--site-symbol-stroke: ${effectiveStroke}`);
      const styleAttr = buildSiteInlineStyle(element, {
        suppressVectorEffect: false,
        extraProps: symbolStyleProps,
      });
      const useMarkup =
        `<use href="#${symbolId}" x="${fmt(-halfSize, PATH_COORDINATE_PRECISION)}" y="${fmt(-halfSize, PATH_COORDINATE_PRECISION)}"` +
        ` width="${fmt(size, PATH_COORDINATE_PRECISION)}" height="${fmt(size, PATH_COORDINATE_PRECISION)}"` +
        ` class="${baseClass}"${styleAttr} transform="${transform}"${dataAttrs}/>`;
      const radiusWorld = point.radiusWorld;
      if (radiusWorld != null && radiusWorld > 0) {
        const stroke = element.strokeColor ?? entry.strokeColor;
        const radiusMarkup =
          `<circle cx="${fmt(point.position[0], PATH_COORDINATE_PRECISION)}"` +
          ` cy="${fmt(point.position[1], PATH_COORDINATE_PRECISION)}"` +
          ` r="${fmt(radiusWorld, PATH_COORDINATE_PRECISION)}"` +
          ` class="site-element-radius site-${safe}-radius"` +
          ` style="fill: ${hexToRgba(stroke, 0.08)}; stroke: ${stroke}; stroke-width: ${fmt(Math.max(radiusWorld / 60, 0.05), TEXT_COORDINATE_PRECISION)}; stroke-dasharray: ${fmt(radiusWorld / 18, TEXT_COORDINATE_PRECISION)} ${fmt(radiusWorld / 36, TEXT_COORDINATE_PRECISION)};"` +
          ` data-site-element-id="${escapeXmlAttribute(element.id)}"` +
          ` data-site-element-radius="true"/>`;
        return radiusMarkup + useMarkup;
      }
      return useMarkup;
    })
    .join("");
}

interface SiteInlineStyleOptions {
  suppressVectorEffect: boolean;
  extraProps?: string[];
}

/**
 * Build the inline `style="..."` attribute for a site element. Centralised
 * so polygon/polyline/point all honour the same colour/stroke override
 * precedence and so the polyline-with-world-width branch can drop the
 * non-scaling-stroke effect inline (presentation attributes outrank the
 * class rule it inherits).
 */
function buildSiteInlineStyle(element: SiteElement, options: SiteInlineStyleOptions): string {
  const props: string[] = [];
  if (element.strokeWidthWorld != null && element.strokeWidthWorld > 0 && !options.extraProps?.some((p) => p.startsWith("stroke-width"))) {
    props.push(`stroke-width: ${fmt(element.strokeWidthWorld, TEXT_COORDINATE_PRECISION)}`);
  }
  if (element.strokeColor) props.push(`stroke: ${element.strokeColor}`);
  if (element.fillColor && !options.extraProps?.some((p) => p.startsWith("fill"))) {
    props.push(`fill: ${element.fillColor}`);
  }
  if (options.suppressVectorEffect) props.push(`vector-effect: none`);
  if (options.extraProps) props.push(...options.extraProps);
  if (props.length === 0) return "";
  return ` style="${props.join("; ")}"`;
}

function renderSiteElementLabels(
  elements: ReadonlyArray<SiteElement>,
  renderOptions: RenderOptions,
): string {
  return elements
    .map((element) => {
      if (!element.name) return "";
      if (element.labelVisible === false) return "";
      // Text labels render their own text via the geometry pipeline —
      // no separate label is emitted, which would duplicate the text.
      if (element.geometry.kind === "text") return "";
      const anchor = labelAnchorFor(element);
      if (!anchor) return "";
      const fontSize = element.labelFontSizeWorld ?? renderOptions.fontSizeWorld;
      const bbox = labelBboxFor(element);
      const placement = bbox
        ? resolveLabelPlacement(anchor, bbox, fontSize, element.labelPosition ?? "center")
        : { x: anchor[0], y: anchor[1], textAnchor: "middle" as const };
      return buildLabelText(placement.x, placement.y, element.name, "site-element-label", fontSize, {
        "data-site-element-id": element.id,
      }, {
        color: element.labelColor ?? "#000000",
        textAnchor: placement.textAnchor,
      });
    })
    .join("");
}

/**
 * Polygon area elements (site cabin, demolition area, parking, …) carry
 * the same icon glyph the right-hand toolbar uses. Drawing the icon at
 * the polygon centroid lets the user identify the area at a glance even
 * when its colour swatch is ambiguous. The user can hide the icon
 * (`iconVisible = false`) and scale it (`iconScale`, default 1.0) per
 * element via the dialog + side panel.
 *
 * The catalog stores each icon as a self-contained `<svg viewBox="0 0
 * 24 24">…</svg>` string. We strip the wrapper, then re-embed the inner
 * markup inside a `<g transform="translate(cx, cy) scale(s, -s)
 * translate(-12, -12)">` so it sits centred on the polygon centroid.
 * The `scale(…, -…)` flip cancels the outer floorplan group's Y-down
 * flip locally so the icon reads right-side-up.
 */
function renderPolygonCentroidIcon(
  element: SiteElement,
  entry: { iconSvg: string; strokeColor: string },
): string {
  if (element.geometry.kind !== "polygon") return "";
  if (element.iconVisible === false) return "";
  if (element.geometry.vertices.length < 3) return "";
  const inner = stripSvgWrapper(entry.iconSvg);
  if (!inner) return "";
  const [cx, cy] = polygonCentroid(element.geometry.vertices);
  const bbox = ringBbox(element.geometry.vertices);
  const width = bbox.xMax - bbox.xMin;
  const height = bbox.yMax - bbox.yMin;
  // Auto size: ~30 % of the polygon's smaller dimension so the icon
  // never overruns a narrow strip. Clamped so a 1-m kiosk still shows
  // a readable glyph and a 100-m demolition zone doesn't get a
  // billboard-sized icon. iconScale multiplies on top so the user can
  // grow or shrink it.
  const auto = Math.min(width, height) * 0.3;
  const scale = (element.iconScale ?? 1) || 1;
  const size = Math.max(0.4, Math.min(8, auto * scale));
  const s = size / 24;
  const color = element.strokeColor ?? entry.strokeColor;
  const transform =
    `translate(${fmt(cx, PATH_COORDINATE_PRECISION)} ${fmt(cy, PATH_COORDINATE_PRECISION)}) ` +
    `scale(${fmt(s, TEXT_COORDINATE_PRECISION)} ${fmt(-s, TEXT_COORDINATE_PRECISION)}) ` +
    `translate(-12 -12)`;
  return (
    `<g class="site-centroid-icon" data-site-element-id="${escapeXmlAttribute(element.id)}"` +
    ` transform="${transform}" style="color: ${color}; pointer-events: none;">${inner}</g>`
  );
}

/** Convert a `<svg viewBox="…" fill="…" stroke="…" …>…</svg>` catalog
 *  icon string into a `<g …>…</g>` carrying the SAME attributes (minus
 *  the meaningless-on-`<g>` `viewBox`). Reason: the catalog ships icons
 *  with `stroke="currentColor" fill="none" stroke-width="2"` on the
 *  outer `<svg>`; SVG child shapes inherit those, so paint stays
 *  consistent across icons. If we just stripped the wrapper and dropped
 *  the inner content into the floorplan, every shape would fall back
 *  to SVG defaults (`fill: black, stroke: none`) and the user would
 *  see solid-black silhouettes — which is exactly the regression we
 *  hit before this fix. */
function stripSvgWrapper(svgString: string): string {
  return svgString
    .replace(/^<svg\b/i, "<g")
    .replace(/<\/svg>\s*$/i, "</g>")
    .replace(/\s+viewBox\s*=\s*"[^"]*"/gi, "");
}

function labelAnchorFor(element: SiteElement): Vec2 | null {
  switch (element.geometry.kind) {
    case "polygon":
      if (element.geometry.vertices.length < 3) return null;
      return polygonCentroid(element.geometry.vertices);
    case "polyline": {
      const vertices = element.geometry.vertices;
      if (vertices.length === 0) return null;
      const middleIndex = Math.floor(vertices.length / 2);
      const point = vertices[middleIndex];
      return point ?? null;
    }
    case "point":
    case "text":
      return [element.geometry.position[0], element.geometry.position[1]];
    default:
      return null;
  }
}

/**
 * Bounding box used to position labels around the geometry's edges
 * (above / below / left / right). For polygons it's the ring's own
 * bbox; for points and polylines we synthesise a small bbox around
 * the anchor based on the symbol size / route width.
 */
function labelBboxFor(
  element: SiteElement,
): { xMin: number; yMin: number; xMax: number; yMax: number } | null {
  if (element.geometry.kind === "polygon") {
    if (element.geometry.vertices.length < 3) return null;
    return ringBbox(element.geometry.vertices);
  }
  if (element.geometry.kind === "polyline") {
    if (element.geometry.vertices.length === 0) return null;
    const half = (element.geometry.widthWorld ?? 0.2) / 2;
    const ring = element.geometry.vertices;
    const base = ringBbox(ring);
    return { xMin: base.xMin - half, yMin: base.yMin - half, xMax: base.xMax + half, yMax: base.yMax + half };
  }
  if (element.geometry.kind === "point") {
    const half = (element.geometry.sizeWorld ?? DEFAULT_POINT_SIZE_WORLD) / 2;
    const [x, y] = element.geometry.position;
    return { xMin: x - half, yMin: y - half, xMax: x + half, yMax: y + half };
  }
  if (element.geometry.kind === "text") {
    const half = element.geometry.sizeWorld / 2;
    const [x, y] = element.geometry.position;
    return { xMin: x - half, yMin: y - half, xMax: x + half, yMax: y + half };
  }
  return null;
}

function buildLabelText(
  cx: number,
  cy: number,
  text: string,
  cssClass: string,
  fontSizeWorld: number,
  extraAttrs: Record<string, string>,
  options: { color?: string | undefined; textAnchor?: "start" | "middle" | "end" } = {},
): string {
  const attributes = Object.entries(extraAttrs)
    .map(([key, value]) => ` ${key}="${escapeXmlAttribute(value)}"`)
    .join("");
  const cxStr = fmt(cx, TEXT_COORDINATE_PRECISION);
  const cyStr = fmt(cy, TEXT_COORDINATE_PRECISION);
  const fontSize = fontSizeWorld > 0 ? fontSizeWorld : 0.25;
  // Per-element overrides: explicit fill (the user's chosen label
  // colour, default black at the call site) and text-anchor for the
  // four edge label-position variants. The label HALO (white outline
  // via paint-order) is intentionally dropped here — it would tint
  // the user's text colour and read as a 1-pixel-thin glow on tiny
  // labels regardless. Anyone who wants the halo back can re-style
  // the `.ifc-label` class block.
  const colorStyle = options.color ? ` style="fill: ${options.color}; stroke: none; paint-order: normal;"` : "";
  const textAnchorAttr = options.textAnchor && options.textAnchor !== "middle" ? ` text-anchor="${options.textAnchor}"` : "";
  return `<text class="${cssClass}" font-size="${fmt(fontSize, TEXT_COORDINATE_PRECISION)}"${textAnchorAttr}${colorStyle} transform="translate(${cxStr} ${cyStr}) scale(1 -1)"${attributes}>${escapeXmlText(text)}</text>`;
}

function pickFirstRingForLabel(polygons: ReadonlyArray<Polygon>): ReadonlyArray<Vec2> | null {
  for (const polygon of polygons) {
    const ring = polygon[0];
    if (ring && ring.length >= 3) return ring;
  }
  return null;
}

function polygonToPathD(polygon: Polygon): string {
  return polygon
    .map((ring) => ringToPathD(ring))
    .filter((d) => d !== "")
    .join(" ");
}

function ringToPathD(ring: ReadonlyArray<Vec2>): string {
  if (ring.length < 3) return "";
  const head = ring[0];
  if (!head) return "";
  const segments: string[] = [`M ${fmt(head[0], PATH_COORDINATE_PRECISION)} ${fmt(head[1], PATH_COORDINATE_PRECISION)}`];
  for (let i = 1; i < ring.length; i++) {
    const point = ring[i];
    if (!point) continue;
    segments.push(`L ${fmt(point[0], PATH_COORDINATE_PRECISION)} ${fmt(point[1], PATH_COORDINATE_PRECISION)}`);
  }
  segments.push("Z");
  return segments.join(" ");
}

function polylineToPathD(vertices: ReadonlyArray<Vec2>): string {
  if (vertices.length < 2) return "";
  const head = vertices[0];
  if (!head) return "";
  const segments: string[] = [`M ${fmt(head[0], PATH_COORDINATE_PRECISION)} ${fmt(head[1], PATH_COORDINATE_PRECISION)}`];
  for (let i = 1; i < vertices.length; i++) {
    const point = vertices[i];
    if (!point) continue;
    segments.push(`L ${fmt(point[0], PATH_COORDINATE_PRECISION)} ${fmt(point[1], PATH_COORDINATE_PRECISION)}`);
  }
  return segments.join(" ");
}

function cssClassNameFor(ifcType: string): string {
  return `ifc-${ifcType.toLowerCase()}`;
}

function cssVarSafeName(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9-]/g, "");
}

function fmt(value: number, precision: number): string {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(precision);
  return fixed.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

export const __internal = { escapeXmlText, cssClassNameFor, cssVarSafeName, polylineToPathD };
