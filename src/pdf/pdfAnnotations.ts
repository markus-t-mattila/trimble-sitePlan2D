import type { StoreyDocument } from "../types";

/*
PDF-only annotation layer: project-coordinate axes (X / Y arrows) with
the world-coordinate value at the axis intersection, plus a scale bar.

These are added to the SVG immediately before rasterisation, so the
interactive viewer (SvgCanvas) never sees them — they'd clutter the
edit experience — but the PDF and the modal preview that mirrors the
PDF both do.

Math notes:
  - The floorplan content lives inside a `<g transform="translate(0,
    yMin+yMax) scale(1,-1)">` group emitted by svgBuilder. That flip
    is what makes positive world Y point up the page. The viewBox of
    the SVG is in SVG user-space (Y increases downward) — so the
    "bottom" of the viewBox is `yMin + height`.
  - Annotations live OUTSIDE that flip group, directly in SVG user-
    space. To compute "what world coordinate sits at this SVG point",
    apply the inverse flip:
        world_x = svg_x
        world_y = (doc.boundingBox.yMin + doc.boundingBox.yMax) - svg_y
    `doc.boundingBox` here is the ORIGINAL IFC + content bbox the
    SVG was emitted with — NOT the crop bbox (which only changes
    the viewBox window, not the flip transform).
  - The Y-arrow points toward smaller SVG-Y, i.e. up the page, which
    matches the project's positive-Y direction after the flip.
  - The scale bar length is rounded to a 1/2/5 × 10ⁿ "nice" value so
    it always reads as a round number in the unit.
*/

export interface AnnotationViewBox {
  xMin: number;
  yMin: number;
  width: number;
  height: number;
}

// Card dimensions in physical mm on the printed page. Defining them in
// mm rather than as a viewBox fraction is what makes the annotation
// card look the same physical size on every paper format — and
// therefore RELATIVELY smaller on a larger sheet, which is what the
// user wants ("suuremmalle arkille suhteessa kokonaisuuteen pienempi
// koko"). A4 → 4 mm font ≈ 2 % of the paper width; A0 → 4 mm font
// ≈ 0.5 % of the paper width.
const FONT_MM = 4;
const LINE_WIDTH_MM = 0.4;
const ARROW_SIZE_MM = 3;
const AXIS_LENGTH_MM = 12;
const TICK_SIZE_MM = 2;
const CARD_PAD_X_MM = 3;
const CARD_PAD_Y_MM = 3;
const CARD_INSET_MM = 3;
const ROW_GAP_MM = 1.8;
const SCALE_TARGET_MM = 35;

export function buildPdfAnnotations(
  doc: StoreyDocument,
  viewBox: AnnotationViewBox,
  printableWidthMm: number,
): string {
  if (viewBox.width <= 0 || viewBox.height <= 0) return "";
  if (!Number.isFinite(printableWidthMm) || printableWidthMm <= 0) return "";

  const xMax = viewBox.xMin + viewBox.width;
  const yMax = viewBox.yMin + viewBox.height;

  // World units per printed millimetre. Because we aspect-match the
  // viewBox to the printable area before calling this, viewBox.width
  // maps directly to printableWidthMm on paper. Every mm constant
  // above is converted into world units via this scale so the card
  // ALWAYS renders at the chosen physical size regardless of paper.
  const worldPerMm = viewBox.width / printableWidthMm;
  const fontSize = FONT_MM * worldPerMm;
  const lineWidth = LINE_WIDTH_MM * worldPerMm;
  const arrowSize = ARROW_SIZE_MM * worldPerMm;
  const axisLength = AXIS_LENGTH_MM * worldPerMm;
  const tickSize = TICK_SIZE_MM * worldPerMm;
  const cardInset = CARD_INSET_MM * worldPerMm;

  // Scale-bar target = ~35 mm on paper. Convert to world units and
  // nicify to a round 1/2/5 × 10ⁿ number so the label reads as a
  // round figure ("50 m" not "47.3 m"). The actual physical length on
  // paper is whatever the nice number maps to — usually within ±50 %
  // of the 35 mm target.
  const scaleLength = nicifyScale(SCALE_TARGET_MM * worldPerMm);
  const unitLabel = formatUnit(doc.units);
  const dateLabel = formatPrintDate(new Date());

  const flipOffset = doc.boundingBox.yMin + doc.boundingBox.yMax;
  const cardPadX = CARD_PAD_X_MM * worldPerMm;
  const cardPadY = CARD_PAD_Y_MM * worldPerMm;
  const rowGap = ROW_GAP_MM * worldPerMm;
  // 0.6 em per character is a conservative width estimate for a
  // sans-serif at typical sizes. Coord text can carry six-digit world
  // values plus two decimals, so we reserve a buffer.
  const charWidth = fontSize * 0.6;

  // Build the placeholder strings the layout reserves space for. The
  // actual rendered text uses the real numbers; the placeholders just
  // tell us how wide to make the card. Explicit `X:` and `Y:` prefixes
  // (matching the rendered labels) leave no ambiguity about which
  // number is which.
  const coordsLabelPlaceholder = `X: ${"x".repeat(8)}   Y: ${"y".repeat(8)}${unitLabel ? ` ${unitLabel}` : ""}`;
  const scaleLabelPlaceholder = `${formatScaleNumber(scaleLength)}${unitLabel ? ` ${unitLabel}` : ""}`;

  // Card content width is whichever row needs the most horizontal room:
  //   row A: axes square + gap + coord text
  //   row B: scale bar + gap + scale label
  //   row C: date text alone (right-aligned to card edge)
  const contentWidth = Math.max(
    axisLength + fontSize * 1.4 + coordsLabelPlaceholder.length * charWidth,
    scaleLength + fontSize * 0.6 + scaleLabelPlaceholder.length * charWidth,
    dateLabel.length * charWidth,
  );
  const cardWidth = cardPadX * 2 + contentWidth;
  // Four vertical regions inside the card:
  //   1) axes block (axisLength tall, Y arrow extends upward from the
  //      anchor; we leave half a font-size of extra clearance above the
  //      tip so the Y/X labels at the arrow tips don't kiss the card
  //      border)
  //   2) coordinates row (fontSize tall, sits under the axes block)
  //   3) scale-bar row (max(tickSize, fontSize), sits under coords)
  //   4) date row (fontSize tall, sits at the very bottom of the card)
  const cardHeight =
    cardPadY * 2 +
    axisLength + fontSize * 0.4 +
    rowGap + fontSize +
    rowGap + Math.max(tickSize, fontSize) +
    rowGap + fontSize;

  const cardX = xMax - cardInset - cardWidth;
  const cardY = yMax - cardInset - cardHeight;

  // Axes anchor: bottom-left of the axes block. Y arrow tip lands at
  // cardY + cardPadY + fontSize*0.4 (leaving room for any future label
  // above the tip); X arrow extends right from the anchor.
  const axesAnchorX = cardX + cardPadX + arrowSize * 0.5;
  const axesAnchorY = cardY + cardPadY + fontSize * 0.4 + axisLength;
  const worldAnchorX = axesAnchorX;
  const worldAnchorY = flipOffset - axesAnchorY;

  // Row baselines (Y), top-to-bottom.
  const coordRowY = axesAnchorY + rowGap + fontSize;
  const scaleRowY = coordRowY + rowGap + Math.max(tickSize, fontSize);
  const dateRowY = scaleRowY + rowGap + fontSize;

  const scaleStartX = cardX + cardPadX;

  // Explicit `X:` / `Y:` prefixes so a reader can't get the axis order
  // wrong on a printed plan. Three em-spaces between the two pairs so
  // they read as separate fields even without typography help.
  const coordsLabel = `X: ${formatCoord(worldAnchorX)}   Y: ${formatCoord(worldAnchorY)}${unitLabel ? ` ${unitLabel}` : ""}`;
  const scaleLabel = `${formatScaleNumber(scaleLength)}${unitLabel ? ` ${unitLabel}` : ""}`;

  const stroke = `stroke="#1c1c1c" stroke-width="${fmt(lineWidth)}" stroke-linecap="round" stroke-linejoin="round" fill="none"`;
  const arrowFill = `fill="#1c1c1c" stroke="none"`;
  const textCommon = `font-family="sans-serif" font-weight="500" fill="#1c1c1c" stroke="none"`;
  // Card background — opaque white so the annotations never visually
  // collide with drawn content underneath, plus a thin border so the
  // card edge reads on a printed page.
  const cardCornerRadius = fontSize * 0.4;

  return [
    `<g class="pdf-annotation-layer" pointer-events="none">`,
    // Card background
    `<rect x="${fmt(cardX)}" y="${fmt(cardY)}" width="${fmt(cardWidth)}" height="${fmt(cardHeight)}"`,
    ` rx="${fmt(cardCornerRadius)}" ry="${fmt(cardCornerRadius)}"`,
    ` fill="#ffffff" stroke="#1c1c1c" stroke-width="${fmt(lineWidth)}" opacity="0.94" />`,
    // Axes block + coord text on row A
    `<g transform="translate(${fmt(axesAnchorX)} ${fmt(axesAnchorY)})">`,
    `<line x1="0" y1="0" x2="${fmt(axisLength)}" y2="0" ${stroke} />`,
    `<polygon points="${fmt(axisLength)},0 ${fmt(axisLength - arrowSize)},${fmt(-arrowSize * 0.5)} ${fmt(axisLength - arrowSize)},${fmt(arrowSize * 0.5)}" ${arrowFill} />`,
    `<line x1="0" y1="0" x2="0" y2="${fmt(-axisLength)}" ${stroke} />`,
    `<polygon points="0,${fmt(-axisLength)} ${fmt(-arrowSize * 0.5)},${fmt(-axisLength + arrowSize)} ${fmt(arrowSize * 0.5)},${fmt(-axisLength + arrowSize)}" ${arrowFill} />`,
    // X / Y direction labels next to the arrow tips
    `<text x="${fmt(axisLength + fontSize * 0.4)}" y="0" font-size="${fmt(fontSize * 0.85)}" dominant-baseline="middle" ${textCommon}>X</text>`,
    `<text x="${fmt(fontSize * 0.4)}" y="${fmt(-axisLength + fontSize * 0.1)}" font-size="${fmt(fontSize * 0.85)}" dominant-baseline="middle" ${textCommon}>Y</text>`,
    `</g>`,
    // Row B: coordinate text below the axes block
    `<text x="${fmt(cardX + cardPadX)}" y="${fmt(coordRowY)}" font-size="${fmt(fontSize)}" dominant-baseline="ideographic" ${textCommon}>${escapeText(coordsLabel)}</text>`,
    // Row C: scale bar + label
    `<g transform="translate(${fmt(scaleStartX)} ${fmt(scaleRowY)})">`,
    `<line x1="0" y1="0" x2="${fmt(scaleLength)}" y2="0" ${stroke} />`,
    `<line x1="0" y1="${fmt(-tickSize)}" x2="0" y2="${fmt(tickSize * 0.3)}" ${stroke} />`,
    `<line x1="${fmt(scaleLength / 2)}" y1="${fmt(-tickSize * 0.6)}" x2="${fmt(scaleLength / 2)}" y2="${fmt(tickSize * 0.3)}" ${stroke} />`,
    `<line x1="${fmt(scaleLength)}" y1="${fmt(-tickSize)}" x2="${fmt(scaleLength)}" y2="${fmt(tickSize * 0.3)}" ${stroke} />`,
    `<text x="${fmt(scaleLength + fontSize * 0.6)}" y="0" font-size="${fmt(fontSize)}" dominant-baseline="middle" ${textCommon}>${escapeText(scaleLabel)}</text>`,
    `</g>`,
    // Row D: print date, right-aligned to the card edge so it doesn't
    // visually compete with the coord text on the left side
    `<text x="${fmt(cardX + cardWidth - cardPadX)}" y="${fmt(dateRowY)}" font-size="${fmt(fontSize)}" text-anchor="end" dominant-baseline="ideographic" ${textCommon}>${escapeText(dateLabel)}</text>`,
    `</g>`,
  ].join("");
}

/** Round a target length to the nearest 1/2/5 × 10ⁿ value so the scale
 *  bar always reads as a round number ("5 m", "20 m", "100 m") rather
 *  than something like "12.7 m". */
function nicifyScale(target: number): number {
  if (target <= 0) return 1;
  const exponent = Math.floor(Math.log10(target));
  const power = Math.pow(10, exponent);
  const mantissa = target / power;
  let nice: number;
  if (mantissa < 1.5) nice = 1;
  else if (mantissa < 3.5) nice = 2;
  else if (mantissa < 7.5) nice = 5;
  else nice = 10;
  return nice * power;
}

function formatCoord(value: number): string {
  if (Math.abs(value) >= 1000) return value.toFixed(0);
  if (Math.abs(value) >= 10) return value.toFixed(1);
  return value.toFixed(2);
}

function formatScaleNumber(value: number): string {
  if (value >= 1) return value.toFixed(value % 1 === 0 ? 0 : 1);
  return value.toFixed(2);
}

function formatUnit(unit: string): string {
  if (unit === "unknown") return "";
  return unit;
}

/** ISO date `YYYY-MM-DD` in the user's local timezone. Drawings need a
 *  print stamp that's unambiguous across regions; ISO is the standard
 *  technical-drawing convention. We compose it from local-time fields
 *  (not `toISOString`, which uses UTC) so the printed date matches the
 *  user's wall clock. */
function formatPrintDate(date: Date): string {
  const yyyy = date.getFullYear().toString().padStart(4, "0");
  const mm = (date.getMonth() + 1).toString().padStart(2, "0");
  const dd = date.getDate().toString().padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function fmt(value: number): string {
  return Number.isFinite(value) ? value.toFixed(4) : "0";
}

function escapeText(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Inject the annotation fragment into an existing SVG string, right
 *  before the closing `</svg>` so it draws on top of all other content. */
export function injectPdfAnnotations(
  svgString: string,
  doc: StoreyDocument,
  viewBox: AnnotationViewBox,
  printableWidthMm: number,
): string {
  const fragment = buildPdfAnnotations(doc, viewBox, printableWidthMm);
  if (!fragment) return svgString;
  return svgString.replace(/<\/svg>\s*$/, `${fragment}</svg>`);
}

/** Read the SVG's `viewBox="xMin yMin w h"` attribute. Returns `null` if
 *  the attribute is missing or malformed. */
export function parseViewBox(svgString: string): AnnotationViewBox | null {
  const match = svgString.match(/<svg[^>]*\sviewBox="([^"]+)"/);
  const raw = match?.[1];
  if (!raw) return null;
  const parts = raw.trim().split(/[\s,]+/).map(Number);
  if (parts.length < 4 || !parts.every(Number.isFinite)) return null;
  const [xMin, yMin, width, height] = parts as [number, number, number, number];
  if (width <= 0 || height <= 0) return null;
  return { xMin, yMin, width, height };
}
