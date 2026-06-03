export interface BoundingBox2D {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export const EMPTY_BBOX: Readonly<BoundingBox2D> = Object.freeze({
  xMin: Number.POSITIVE_INFINITY,
  yMin: Number.POSITIVE_INFINITY,
  xMax: Number.NEGATIVE_INFINITY,
  yMax: Number.NEGATIVE_INFINITY,
});

export function emptyBbox(): BoundingBox2D {
  return { ...EMPTY_BBOX };
}

export function isEmpty(bbox: BoundingBox2D): boolean {
  return bbox.xMin > bbox.xMax || bbox.yMin > bbox.yMax;
}

export function extend(bbox: BoundingBox2D, x: number, y: number): void {
  if (x < bbox.xMin) bbox.xMin = x;
  if (y < bbox.yMin) bbox.yMin = y;
  if (x > bbox.xMax) bbox.xMax = x;
  if (y > bbox.yMax) bbox.yMax = y;
}

export function extendByPoints(bbox: BoundingBox2D, points: ReadonlyArray<readonly [number, number]>): void {
  for (const [x, y] of points) extend(bbox, x, y);
}

export function merge(a: BoundingBox2D, b: BoundingBox2D): BoundingBox2D {
  if (isEmpty(a)) return { ...b };
  if (isEmpty(b)) return { ...a };
  return {
    xMin: Math.min(a.xMin, b.xMin),
    yMin: Math.min(a.yMin, b.yMin),
    xMax: Math.max(a.xMax, b.xMax),
    yMax: Math.max(a.yMax, b.yMax),
  };
}

/**
 * Union the storey's IFC bbox with every piece of user-added content
 * (user areas, site elements, background image) so "Fit to screen" and
 * the emitted SVG viewBox both reach far enough to display annotations
 * sitting outside the building footprint. The JSON's `doc.boundingBox`
 * field is untouched — it remains the IFC's own bbox and continues to
 * represent the source geometry's reach to downstream consumers.
 */
import type { StoreyDocument } from "../types";

export function computeRenderingBbox(doc: StoreyDocument): BoundingBox2D {
  const bbox: BoundingBox2D = { ...doc.boundingBox };
  // User areas (polygons).
  for (const area of doc.userAreas) {
    extendByPoints(bbox, area.polygon);
  }
  // Site elements — handle every geometry kind.
  for (const element of doc.siteElements ?? []) {
    const g = element.geometry;
    if (g.kind === "polygon") {
      extendByPoints(bbox, g.vertices);
    } else if (g.kind === "polyline") {
      extendByPoints(bbox, g.vertices);
      // Widened polylines (driving routes) need the half-width added
      // to the perpendicular margins; we approximate with an axis-
      // aligned padding so the view always shows the road shoulders.
      const halfWidth = (g.widthWorld ?? 0) / 2;
      if (halfWidth > 0) {
        bbox.xMin -= halfWidth;
        bbox.yMin -= halfWidth;
        bbox.xMax += halfWidth;
        bbox.yMax += halfWidth;
      }
    } else if (g.kind === "point") {
      const half = Math.max(g.sizeWorld ?? 0, g.radiusWorld ?? 0);
      extend(bbox, g.position[0] - half, g.position[1] - half);
      extend(bbox, g.position[0] + half, g.position[1] + half);
    } else if (g.kind === "text") {
      // Text bbox is roughly `sizeWorld` in height; we don't know the
      // actual rendered width without a font metrics call, so use a
      // square of `sizeWorld` × 4 as a generous estimate (English
      // average ~4 characters fit in a square of em-height).
      const halfH = g.sizeWorld / 2;
      const halfW = g.sizeWorld * 2;
      extend(bbox, g.position[0] - halfW, g.position[1] - halfH);
      extend(bbox, g.position[0] + halfW, g.position[1] + halfH);
    }
  }
  // Background image: take its axis-aligned bounding rect ignoring
  // rotation. Good enough for fit-to-screen; the user can always pan
  // if a rotated photo's far corner is clipped.
  if (doc.backgroundImage) {
    const bg = doc.backgroundImage;
    extend(bbox, bg.origin[0], bg.origin[1]);
    extend(bbox, bg.origin[0] + bg.widthWorld, bg.origin[1] + bg.heightWorld);
  }
  return bbox;
}

/**
 * Pad the bbox symmetrically in whichever dimension is too narrow so
 * its aspect (width / height) matches `targetAspect`. The result is
 * always >= the input bbox — we extend, never shrink — so no user
 * content can be cropped out by this normalisation. Used by the PDF
 * pipeline so the SVG viewBox aspect always matches the printable
 * area's aspect, which means (a) the rendered SVG fills the page
 * without letterboxing and (b) annotations at the viewBox corners
 * line up with the printable area's corners exactly.
 */
export function extendToAspect(bbox: BoundingBox2D, targetAspect: number): BoundingBox2D {
  if (isEmpty(bbox) || !Number.isFinite(targetAspect) || targetAspect <= 0) return { ...bbox };
  const width = bbox.xMax - bbox.xMin;
  const height = bbox.yMax - bbox.yMin;
  if (width === 0 || height === 0) return { ...bbox };
  const currentAspect = width / height;
  if (Math.abs(currentAspect - targetAspect) < 1e-9) return { ...bbox };
  if (currentAspect < targetAspect) {
    const newWidth = height * targetAspect;
    const extra = (newWidth - width) / 2;
    return { xMin: bbox.xMin - extra, xMax: bbox.xMax + extra, yMin: bbox.yMin, yMax: bbox.yMax };
  }
  const newHeight = width / targetAspect;
  const extra = (newHeight - height) / 2;
  return { xMin: bbox.xMin, xMax: bbox.xMax, yMin: bbox.yMin - extra, yMax: bbox.yMax + extra };
}

export function withMargin(bbox: BoundingBox2D, marginFraction: number): BoundingBox2D {
  if (isEmpty(bbox)) return bbox;
  const width = bbox.xMax - bbox.xMin;
  const height = bbox.yMax - bbox.yMin;
  const longest = Math.max(width, height);
  const margin = longest * marginFraction;
  return {
    xMin: bbox.xMin - margin,
    yMin: bbox.yMin - margin,
    xMax: bbox.xMax + margin,
    yMax: bbox.yMax + margin,
  };
}
