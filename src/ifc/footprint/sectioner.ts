import type { Vec2 } from "../../types";

/*
Triangle vs horizontal plane (Z = zCut) intersection.

Given a triangle's three vertices in world coordinates, return the line
segment (two endpoints, in XY) where the plane crosses the triangle, or null
if the triangle is entirely above/below or coplanar.

Coplanar (all three z near zCut) is treated as "no cut" — we let the
projection fallback handle horizontal elements like slabs.
*/

const EPS = 1e-7;

export interface Segment2D {
  a: Vec2;
  b: Vec2;
}

export function intersectTriangleWithHorizontalPlane(
  v0x: number,
  v0y: number,
  v0z: number,
  v1x: number,
  v1y: number,
  v1z: number,
  v2x: number,
  v2y: number,
  v2z: number,
  zCut: number,
): Segment2D | null {
  const d0 = v0z - zCut;
  const d1 = v1z - zCut;
  const d2 = v2z - zCut;
  const positives = (d0 > EPS ? 1 : 0) + (d1 > EPS ? 1 : 0) + (d2 > EPS ? 1 : 0);
  const negatives = (d0 < -EPS ? 1 : 0) + (d1 < -EPS ? 1 : 0) + (d2 < -EPS ? 1 : 0);
  if (positives === 3 || negatives === 3) return null;
  if (positives === 0 && negatives === 0) return null;

  const hits: Vec2[] = [];
  // Edge v0 -> v1
  pushEdgeIntersection(hits, v0x, v0y, v0z, v1x, v1y, v1z, d0, d1);
  // Edge v1 -> v2
  pushEdgeIntersection(hits, v1x, v1y, v1z, v2x, v2y, v2z, d1, d2);
  // Edge v2 -> v0
  pushEdgeIntersection(hits, v2x, v2y, v2z, v0x, v0y, v0z, d2, d0);

  if (hits.length < 2) return null;
  // The plane intersects a triangle in 2 points (degenerate cases produce 3 if
  // a vertex lies exactly on the plane; we then keep the two extremes).
  const a = hits[0];
  const b = hits[1];
  if (!a || !b) return null;
  if (a[0] === b[0] && a[1] === b[1]) return null;
  return { a, b };
}

function pushEdgeIntersection(
  out: Vec2[],
  ax: number,
  ay: number,
  _az: number,
  bx: number,
  by: number,
  _bz: number,
  da: number,
  db: number,
): void {
  if (Math.abs(da) <= EPS) {
    out.push([ax, ay]);
    return;
  }
  if (Math.abs(db) <= EPS) {
    // Skipped: the endpoint will be added by the next edge's `da` check.
    return;
  }
  if ((da > 0 && db < 0) || (da < 0 && db > 0)) {
    const t = da / (da - db);
    out.push([ax + (bx - ax) * t, ay + (by - ay) * t]);
  }
}
