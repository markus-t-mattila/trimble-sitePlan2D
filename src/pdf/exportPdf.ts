import jsPDF from "jspdf";
import { buildStoreySvg } from "../generator/svgBuilder";
import type { StoreyDocument } from "../types";
import { injectPdfAnnotations, parseViewBox, type AnnotationViewBox } from "./pdfAnnotations";

/**
 * ISO and ANSI paper sizes supported by the PDF exporter. Values are in mm.
 */
export const PAPER_SIZES: Readonly<Record<PaperSize, { widthMm: number; heightMm: number }>> = Object.freeze({
  A4: { widthMm: 210, heightMm: 297 },
  A3: { widthMm: 297, heightMm: 420 },
  A2: { widthMm: 420, heightMm: 594 },
  A1: { widthMm: 594, heightMm: 841 },
  A0: { widthMm: 841, heightMm: 1189 },
  Letter: { widthMm: 215.9, heightMm: 279.4 },
  Tabloid: { widthMm: 279.4, heightMm: 431.8 },
});

export type PaperSize = "A4" | "A3" | "A2" | "A1" | "A0" | "Letter" | "Tabloid";
export type PdfOrientation = "portrait" | "landscape";

export interface ExportPdfOptions {
  doc: StoreyDocument;
  paperSize: PaperSize;
  orientation: PdfOrientation;
  /** Page margin in mm. */
  marginMm?: number;
  /** Optional crop rectangle in world coordinates. Overrides the SVG's
   *  default viewBox so the user's interactive pan + zoom in the preview
   *  translates to a "what you see is what you print" PDF. When omitted
   *  the storey's full rendering bbox (IFC + user content) is used. */
  cropBbox?: { xMin: number; yMin: number; xMax: number; yMax: number };
  /** Whether to draw the coordinate-axes + scale-bar annotation card in
   *  the bottom-right of the printed page. Defaults to `true`. */
  includeAnnotations?: boolean;
}

const DEFAULT_MARGIN_MM = 12;

/** Target raster resolution at the PDF's printable area. 200 DPI is plenty
 * for floor plans printed at A0–A4 sizes — at A3 landscape (420 mm wide) that
 * lands around 3 300 px wide, which prints crisp without blowing up memory.
 */
const RASTER_DPI = 200;
const MM_PER_INCH = 25.4;

/**
 * Render a storey to a PDF.
 *
 * We render the SVG to a high-DPI canvas and embed that bitmap in the PDF
 * via `jsPDF.addImage`. We used to drive `svg2pdf.js` for vector output,
 * but svg2pdf has narrow CSS support — it choked on modern colour
 * functions and at some point started throwing `Invalid argument passed
 * to jsPDF.scale` on perfectly valid SVGs from our generator. The
 * canvas-rasterised path bypasses svg2pdf entirely and works for any
 * SVG the DOM can paint, at the cost of vector resolution. 200 DPI is
 * enough that text and lines stay crisp at every paper size we ship.
 *
 * The page picks up the user's paper size + orientation; the drawing is
 * scaled to fit the printable area while preserving aspect ratio so all
 * coordinates stay in scale with each other. Returns the raw PDF bytes
 * (caller decides between download / upload).
 */
export async function exportStoreyToPdf(options: ExportPdfOptions): Promise<Uint8Array> {
  const sheet = resolveSheetDimensions(options.paperSize, options.orientation);
  const margin = options.marginMm ?? DEFAULT_MARGIN_MM;
  const usableWidth = sheet.widthMm - margin * 2;
  const usableHeight = sheet.heightMm - margin * 2;

  const baseSvg = buildStoreySvg(options.doc);
  const wantAnnotations = options.includeAnnotations !== false;
  // Resolve the final viewBox: if the user cropped, that becomes the
  // window; otherwise inherit the SVG's emitted viewBox (the full
  // IFC + content bbox). Annotations are positioned relative to this
  // final window so they always sit inside the printable area, even
  // when the user has cropped the original bottom-right corner out.
  const finalViewBox: AnnotationViewBox =
    options.cropBbox != null
      ? {
          xMin: options.cropBbox.xMin,
          yMin: options.cropBbox.yMin,
          width: options.cropBbox.xMax - options.cropBbox.xMin,
          height: options.cropBbox.yMax - options.cropBbox.yMin,
        }
      : parseViewBox(baseSvg) ?? {
          xMin: options.doc.boundingBox.xMin,
          yMin: options.doc.boundingBox.yMin,
          width: options.doc.boundingBox.xMax - options.doc.boundingBox.xMin,
          height: options.doc.boundingBox.yMax - options.doc.boundingBox.yMin,
        };
  const svgString = wantAnnotations
    ? injectPdfAnnotations(baseSvg, options.doc, finalViewBox, usableWidth)
    : baseSvg;
  const { dataUrl, viewBoxAspect } = await rasterizeSvg(
    svgString,
    usableWidth,
    usableHeight,
    options.cropBbox,
  );

  // Fit the bitmap to the printable area while preserving the SVG's
  // intrinsic aspect ratio. Centre the bitmap inside the margins so a
  // landscape drawing on a portrait page (or vice-versa) doesn't bleed
  // into the margin.
  let renderedWidth: number;
  let renderedHeight: number;
  if (viewBoxAspect > usableWidth / usableHeight) {
    renderedWidth = usableWidth;
    renderedHeight = usableWidth / viewBoxAspect;
  } else {
    renderedHeight = usableHeight;
    renderedWidth = usableHeight * viewBoxAspect;
  }
  const offsetX = margin + (usableWidth - renderedWidth) / 2;
  const offsetY = margin + (usableHeight - renderedHeight) / 2;

  const pdf = new jsPDF({
    unit: "mm",
    format: [sheet.widthMm, sheet.heightMm],
    orientation: options.orientation,
    compress: true,
  });
  pdf.addImage(dataUrl, "PNG", offsetX, offsetY, renderedWidth, renderedHeight);

  const arrayBuffer = pdf.output("arraybuffer") as ArrayBuffer;
  return new Uint8Array(arrayBuffer);
}

interface RasterizedSvg {
  dataUrl: string;
  viewBoxAspect: number;
}

/**
 * Paint an SVG string into an off-screen canvas at print resolution and
 * return a PNG data URL.
 *
 * Steps:
 *   1. Parse the SVG, read its viewBox aspect ratio so the caller can size
 *      the PDF placement correctly.
 *   2. Inject explicit `width` and `height` attributes (some browsers
 *      refuse to paint an SVG into an image without them).
 *   3. Wrap the markup as a `data:image/svg+xml` URL and load it via
 *      `<img>`. We avoid object URLs because Trimble Connect's iframe
 *      sandbox sometimes blocks `URL.createObjectURL` references.
 *   4. Draw the loaded image into a canvas sized for the requested
 *      paper-area dimensions at `RASTER_DPI`.
 *   5. Export the canvas as `image/png` (PDF reader-friendly, no JPEG
 *      banding around fine lines).
 */
async function rasterizeSvg(
  svgString: string,
  printableWidthMm: number,
  printableHeightMm: number,
  cropBbox?: { xMin: number; yMin: number; xMax: number; yMax: number },
): Promise<RasterizedSvg> {
  if (typeof DOMParser === "undefined" || typeof document === "undefined") {
    throw new Error("PDF export must run in a browser environment (DOMParser + document required).");
  }
  const printReadySvg = applyPrintCssOverrides(svgString);
  const dom = new DOMParser().parseFromString(printReadySvg, "image/svg+xml");
  const svgEl = dom.documentElement;
  if (!svgEl || svgEl.nodeName.toLowerCase() !== "svg") {
    throw new Error("Generated SVG did not parse to a <svg> root element.");
  }
  // If the caller passed a crop rectangle, override the SVG's viewBox so
  // the rasteriser only sees that window — anything outside the crop is
  // clipped by `preserveAspectRatio` / overflow:hidden behaviour. We
  // keep `preserveAspectRatio="xMidYMid meet"` so the cropped content is
  // letterboxed within the canvas when its aspect doesn't match.
  if (cropBbox) {
    const cw = cropBbox.xMax - cropBbox.xMin;
    const ch = cropBbox.yMax - cropBbox.yMin;
    if (cw > 0 && ch > 0) {
      svgEl.setAttribute("viewBox", `${cropBbox.xMin} ${cropBbox.yMin} ${cw} ${ch}`);
    }
  }
  const viewBoxRaw = svgEl.getAttribute("viewBox") ?? "0 0 1 1";
  const viewBoxParts = viewBoxRaw
    .split(/[\s,]+/)
    .map((part) => Number(part))
    .filter((n) => Number.isFinite(n));
  const vbWidth = (viewBoxParts[2] ?? 1) || 1;
  const vbHeight = (viewBoxParts[3] ?? 1) || 1;
  const viewBoxAspect = vbWidth / vbHeight;

  const pixelsPerMm = RASTER_DPI / MM_PER_INCH;
  // Match the canvas to the printable area, NOT to the page — that way the
  // rasterised image fits the addImage call below exactly and we don't
  // waste pixels rendering off-page margin.
  let canvasWidthPx = Math.max(1, Math.round(printableWidthMm * pixelsPerMm));
  let canvasHeightPx = Math.max(1, Math.round(printableHeightMm * pixelsPerMm));
  // Preserve the SVG's aspect: shrink the dimension that doesn't fit.
  if (viewBoxAspect > canvasWidthPx / canvasHeightPx) {
    canvasHeightPx = Math.max(1, Math.round(canvasWidthPx / viewBoxAspect));
  } else {
    canvasWidthPx = Math.max(1, Math.round(canvasHeightPx * viewBoxAspect));
  }

  // Browsers vary on whether they paint an SVG image without an explicit
  // width/height. Setting them on the cloned root makes the rasterisation
  // deterministic across Chromium, Firefox, and WebKit.
  svgEl.setAttribute("width", String(canvasWidthPx));
  svgEl.setAttribute("height", String(canvasHeightPx));
  const preparedSvg = new XMLSerializer().serializeToString(svgEl);

  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(preparedSvg)}`;

  const image = await loadImage(svgDataUrl);

  const canvas = document.createElement("canvas");
  canvas.width = canvasWidthPx;
  canvas.height = canvasHeightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("PDF export: could not get a 2D canvas context.");
  // White background so transparent regions of the SVG print as paper-white,
  // not as the PDF viewer's checkerboard.
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  return { dataUrl: canvas.toDataURL("image/png"), viewBoxAspect };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () =>
      reject(new Error("PDF export: failed to decode the generated SVG as an image."));
    image.src = src;
  });
}

/**
 * Append a small CSS override block at the end of the SVG's `<style>` so
 * the rasterised version matches paper-drafting conventions:
 *
 *   - `vector-effect: non-scaling-stroke` is dropped (set to `none`).
 *     On the interactive viewer that effect keeps strokes at a fixed
 *     pixel width regardless of zoom — great for navigation. On paper
 *     it leaves strokes at sub-pixel width (one canvas pixel out of
 *     several thousand) so the printed lines vanish. Removing it lets
 *     the stroke widths inherit the viewBox transform: a 0.05 m world
 *     stroke on a 1:125 drawing prints as ~0.4 mm — a real drafting
 *     line.
 *
 *   - Label haloes (`stroke` + `stroke-width` on `.ifc-label` etc.) are
 *     suppressed. With non-scaling-stroke gone the 0.18-unit halo would
 *     become a 1.4 mm coloured band around every glyph; that's
 *     unreadable, so we paint labels with fill only on paper.
 *
 *   - The text labels keep their font-size (which is already in world
 *     units), so a 0.25 m label prints as ~2 mm at 1:125 — readable.
 *
 * Both rules use `!important` so they outrank the existing class rules
 * regardless of cascade order or specificity.
 */
export function applyPrintCssOverrides(svgString: string): string {
  const overrides = `
.ifc-object, .user-area,
.site-element-polyline, .site-element-polygon, .site-element-point,
.ifc-label, .user-area-label, .site-element-label {
  vector-effect: none !important;
}
.ifc-label, .user-area-label, .site-element-label {
  stroke: none !important;
  paint-order: normal !important;
}
`;
  if (svgString.includes("</style>")) {
    return svgString.replace("</style>", `${overrides}</style>`);
  }
  // No <style> block (defensive — every generator path emits one, but
  // future code paths might not). Inject a <defs> + <style> right after
  // the root <svg> open tag.
  return svgString.replace(/<svg([^>]*)>/, `<svg$1><defs><style>${overrides}</style></defs>`);
}

export const __internal = { applyPrintCssOverrides };

function resolveSheetDimensions(
  paperSize: PaperSize,
  orientation: PdfOrientation,
): { widthMm: number; heightMm: number } {
  const base = PAPER_SIZES[paperSize];
  if (!base) throw new Error(`Unknown paper size: ${paperSize}`);
  if (orientation === "landscape") {
    return { widthMm: Math.max(base.widthMm, base.heightMm), heightMm: Math.min(base.widthMm, base.heightMm) };
  }
  return { widthMm: Math.min(base.widthMm, base.heightMm), heightMm: Math.max(base.widthMm, base.heightMm) };
}
