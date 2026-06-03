import polygonClipping from "polygon-clipping";
import type { Polygon, Vec2 } from "../../types";
import type { Segment2D } from "./sectioner";

const VERTEX_SNAP_EPSILON = 1e-5;

/*
Chain a list of 2D line segments (the output of the section pass) into closed
rings. Each segment shares its endpoints with adjacent segments because the
triangle mesh is closed; vertices that are numerically close are snapped to a
shared key.

Open chains (e.g. for non-watertight meshes) are returned as best-effort rings
by appending the start of the chain to its end.
*/
export function chainSegmentsIntoRings(segments: ReadonlyArray<Segment2D>): Vec2[][] {
  if (segments.length === 0) return [];
  const tolerance = VERTEX_SNAP_EPSILON;
  const adjacency = new Map<string, Array<{ otherKey: string; otherPoint: Vec2; index: number }>>();
  const segmentKeys: Array<[string, string]> = [];

  function vertexKey(point: Vec2): string {
    const x = Math.round(point[0] / tolerance);
    const y = Math.round(point[1] / tolerance);
    return `${x}|${y}`;
  }

  segments.forEach((seg, index) => {
    const aKey = vertexKey(seg.a);
    const bKey = vertexKey(seg.b);
    if (aKey === bKey) return;
    segmentKeys.push([aKey, bKey]);
    push(adjacency, aKey, { otherKey: bKey, otherPoint: seg.b, index });
    push(adjacency, bKey, { otherKey: aKey, otherPoint: seg.a, index });
  });

  const used = new Set<number>();
  const rings: Vec2[][] = [];

  for (let i = 0; i < segments.length; i++) {
    if (used.has(i)) continue;
    const seg = segments[i];
    if (!seg) continue;
    const startKey = vertexKey(seg.a);
    const ring: Vec2[] = [seg.a, seg.b];
    used.add(i);
    let currentKey = vertexKey(seg.b);
    let safety = 0;
    while (safety++ < segments.length * 2) {
      const candidates = adjacency.get(currentKey) ?? [];
      let next: { otherKey: string; otherPoint: Vec2; index: number } | undefined;
      for (const cand of candidates) {
        if (!used.has(cand.index)) {
          next = cand;
          break;
        }
      }
      if (!next) break;
      used.add(next.index);
      ring.push(next.otherPoint);
      currentKey = next.otherKey;
      if (currentKey === startKey) break;
    }
    if (ring.length >= 3) rings.push(ring);
  }
  return rings;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const existing = map.get(key);
  if (existing) {
    existing.push(value);
  } else {
    map.set(key, [value]);
  }
}

/*
Union an array of polygons into a multipolygon (array of polygons). Used to
merge per-triangle projections.
*/
export function unionPolygons(polygons: Polygon[]): Polygon[] {
  if (polygons.length === 0) return [];
  const asInput = polygons.map((p) => p.map((ring) => ring.map(([x, y]) => [x, y] as [number, number])));
  const rest = asInput.slice(1) as unknown as Parameters<typeof polygonClipping.union>[1][];
  const head = asInput[0] as unknown as Parameters<typeof polygonClipping.union>[0];
  const result = polygonClipping.union(head, ...rest);
  return result.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x, y] as Vec2)));
}

/**
 * Default collinearity tolerance for IFC-world simplification, in metres.
 *
 * Footprints come back from web-ifc as triangulated boundaries, so a
 * rectangular IfcSpace whose edges were meshed in three triangles ends up
 * with 8 points (4 corners + 4 mid-edge collinear extras) instead of the
 * 4 corners the BIM tool drew. 1 mm is loose enough to swallow numerical
 * noise from the triangulation but tight enough to preserve real corners
 * — anything that turns by more than 1 mm/edge is a real geometric feature.
 */
const COLLINEAR_TOLERANCE_METRES = 1e-3;

/**
 * Drop consecutive vertices that lie (within tolerance) on the line through
 * their neighbours. Closed rings (first vertex repeated at the end) are
 * handled with wrap-around so a collinear point at the seam is also removed.
 *
 * Repeats until a full pass removes nothing, because removing one vertex
 * can make its neighbours collinear with each other (e.g. a 5-point ring
 * that's really a triangle: one pass leaves a triangle, the next confirms
 * nothing else is collinear).
 */
export function simplifyRing(ring: ReadonlyArray<Vec2>, tolerance = COLLINEAR_TOLERANCE_METRES): Vec2[] {
  if (ring.length < 4) return ring.map((p) => [p[0], p[1]] as Vec2);
  const head = ring[0];
  const tail = ring[ring.length - 1];
  const isClosed = head !== undefined && tail !== undefined && head[0] === tail[0] && head[1] === tail[1];
  let work: Vec2[] = ring.slice(isClosed ? 0 : 0, isClosed ? -1 : undefined).map((p) => [p[0], p[1]] as Vec2);

  let changed = true;
  while (changed) {
    changed = false;
    const next: Vec2[] = [];
    const n = work.length;
    if (n < 3) break;
    for (let i = 0; i < n; i++) {
      const prev = next.length > 0 ? next[next.length - 1]! : work[(i - 1 + n) % n]!;
      const curr = work[i]!;
      const after = work[(i + 1) % n]!;
      if (perpendicularDistance(curr, prev, after) < tolerance) {
        changed = true;
        continue;
      }
      next.push(curr);
    }
    work = next;
  }

  if (isClosed && work.length > 0) {
    work.push([work[0]![0], work[0]![1]] as Vec2);
  }
  return work;
}

/**
 * Apply `simplifyRing` to every ring of every polygon. Rings with fewer than
 * three distinct vertices after simplification are dropped (degenerate
 * sliver — the triangulator's leftover from the cut). Polygons left with
 * no outer ring are dropped entirely.
 */
export function simplifyPolygons(
  polygons: ReadonlyArray<Polygon>,
  tolerance = COLLINEAR_TOLERANCE_METRES,
): Polygon[] {
  const result: Polygon[] = [];
  for (const polygon of polygons) {
    const simplifiedRings: Vec2[][] = [];
    for (const ring of polygon) {
      const simplified = simplifyRing(ring, tolerance);
      const distinctCount = simplified.length > 0 && pointsEqual(simplified[0]!, simplified[simplified.length - 1]!)
        ? simplified.length - 1
        : simplified.length;
      if (distinctCount < 3) continue;
      simplifiedRings.push(simplified);
    }
    if (simplifiedRings.length > 0) result.push(simplifiedRings);
  }
  return result;
}

/**
 * Perpendicular distance from `point` to the line through `lineA`-`lineB`.
 * Uses the cross-product / segment-length form so it's stable for any
 * orientation. When the segment has zero length we return the Euclidean
 * distance from `point` to `lineA` so an isolated duplicate doesn't get
 * flagged "collinear" with a zero-length neighbour.
 */
function perpendicularDistance(point: Vec2, lineA: Vec2, lineB: Vec2): number {
  const dx = lineB[0] - lineA[0];
  const dy = lineB[1] - lineA[1];
  const length = Math.hypot(dx, dy);
  if (length === 0) {
    return Math.hypot(point[0] - lineA[0], point[1] - lineA[1]);
  }
  const cross = dx * (point[1] - lineA[1]) - dy * (point[0] - lineA[0]);
  return Math.abs(cross) / length;
}

function pointsEqual(a: Vec2, b: Vec2): boolean {
  return a[0] === b[0] && a[1] === b[1];
}
