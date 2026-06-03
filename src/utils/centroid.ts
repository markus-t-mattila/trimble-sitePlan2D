import type { Vec2 } from "../types";

/**
 * Compute the area-weighted (geometric) centroid of a closed polygon ring.
 *
 * The shoelace formula gives both the signed area and the centroid; we use
 * the absolute area for the weight so winding order doesn't matter. When the
 * ring is degenerate (zero area, fewer than three vertices) we fall back to
 * the bounding-box centre so callers always get a usable point.
 *
 * The returned point is in the same coordinate system as the input.
 *
 * @param ring  closed ring (last vertex == first is fine but not required)
 * @returns centroid in world coordinates
 */
export function polygonCentroid(ring: ReadonlyArray<Vec2>): Vec2 {
  if (ring.length === 0) return [0, 0];
  if (ring.length < 3) return bboxCenter(ring);
  let twiceArea = 0;
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i];
    const b = ring[(i + 1) % ring.length];
    if (!a || !b) continue;
    const cross = a[0] * b[1] - b[0] * a[1];
    twiceArea += cross;
    cx += (a[0] + b[0]) * cross;
    cy += (a[1] + b[1]) * cross;
  }
  if (twiceArea === 0) return bboxCenter(ring);
  const sixArea = 3 * twiceArea;
  return [cx / sixArea, cy / sixArea];
}

/**
 * Fallback centroid: the centre of the ring's axis-aligned bounding box. Used
 * for degenerate or self-intersecting rings where the area-weighted formula
 * would return NaN or land outside the polygon.
 */
export function bboxCenter(ring: ReadonlyArray<Vec2>): Vec2 {
  let xMin = Infinity;
  let yMin = Infinity;
  let xMax = -Infinity;
  let yMax = -Infinity;
  for (const point of ring) {
    if (!point) continue;
    if (point[0] < xMin) xMin = point[0];
    if (point[1] < yMin) yMin = point[1];
    if (point[0] > xMax) xMax = point[0];
    if (point[1] > yMax) yMax = point[1];
  }
  if (!Number.isFinite(xMin) || !Number.isFinite(yMin)) return [0, 0];
  return [(xMin + xMax) / 2, (yMin + yMax) / 2];
}
