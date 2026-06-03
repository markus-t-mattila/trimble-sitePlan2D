import polygonClipping from "polygon-clipping";
import type { Polygon, Vec2 } from "../../types";

/**
 * Project a mesh's triangles onto the 2D plan plane and union them into one
 * or more polygons. Used as the fallback when no triangle crossed the cut
 * plane (typical for slabs, ceilings, ramps, and for Revit IFC exports
 * whose geometry sits entirely below the storey-elevation + cut-offset
 * plane that the sectioner targets).
 *
 * The mesh comes in as flat typed arrays in the calling convention web-ifc
 * uses: `vertexFloats` is 6 floats per vertex (xyz + normal), `indices` is
 * one uint32 per triangle corner. The transformer applies the per-product
 * placement matrix plus any axis remap required for top-down projection.
 *
 * Robustness: real-world IFC meshes (especially from Revit) contain
 * self-intersecting / sliver / coincident triangles that crash
 * polygon-clipping when fed into a single union call. We:
 *
 *   1. Filter degenerate triangles (~0 area) up front.
 *   2. Process triangles in small **batches**, accumulating into one
 *      multipolygon. When a batch fails, we **fall back to per-triangle
 *      union** so a single bad triangle no longer skips its 31 neighbours.
 *   3. If the per-triangle union also throws for some triangles we
 *      silently drop those — better to lose a wedge than the whole object.
 *
 * The result is the object's footprint as a list of polygons in 2D world
 * coordinates.
 */

export interface MeshFlat {
  vertexFloats: ArrayLike<number>;
  vertexStride: number;
  indices: ArrayLike<number>;
}

const POLYGON_BATCH_SIZE = 32;
const TRIANGLE_AREA_EPSILON = 1e-9;

/**
 * `polygon-clipping` typings declare `Geom` as `Polygon | MultiPolygon`. We
 * narrow to the latter so the casts in the union call read as intent.
 */
type ClippingPolygon = Array<Array<[number, number]>>;

export function projectMeshOntoPlane(
  mesh: MeshFlat,
  transform: (x: number, y: number, z: number) => [number, number, number],
): Polygon[] {
  const trianglePolygons: ClippingPolygon[] = [];
  const triCount = mesh.indices.length / 3;
  for (let i = 0; i < triCount; i++) {
    const i0 = mesh.indices[i * 3]! * mesh.vertexStride;
    const i1 = mesh.indices[i * 3 + 1]! * mesh.vertexStride;
    const i2 = mesh.indices[i * 3 + 2]! * mesh.vertexStride;
    const a = transform(mesh.vertexFloats[i0]!, mesh.vertexFloats[i0 + 1]!, mesh.vertexFloats[i0 + 2]!);
    const b = transform(mesh.vertexFloats[i1]!, mesh.vertexFloats[i1 + 1]!, mesh.vertexFloats[i1 + 2]!);
    const c = transform(mesh.vertexFloats[i2]!, mesh.vertexFloats[i2 + 1]!, mesh.vertexFloats[i2 + 2]!);
    const ring: Array<[number, number]> = [
      [a[0], a[1]],
      [b[0], b[1]],
      [c[0], c[1]],
      [a[0], a[1]],
    ];
    if (triangleArea(ring) < TRIANGLE_AREA_EPSILON) continue;
    trianglePolygons.push([ring]);
  }
  if (trianglePolygons.length === 0) return [];

  let accumulated: ClippingPolygon[] = [];
  for (let start = 0; start < trianglePolygons.length; start += POLYGON_BATCH_SIZE) {
    const batch = trianglePolygons.slice(start, start + POLYGON_BATCH_SIZE);
    accumulated = unionBatchWithFallback(accumulated, batch);
  }

  return accumulated.map((poly) => poly.map((ring) => ring.map(([x, y]) => [x, y] as Vec2)));
}

/**
 * Union the current accumulator with the next batch. If the batched call
 * throws (one of the new triangles is malformed) we degrade gracefully by
 * unioning one triangle at a time — slower, but a single bad triangle no
 * longer wipes out the whole batch.
 */
function unionBatchWithFallback(accumulated: ClippingPolygon[], batch: ClippingPolygon[]): ClippingPolygon[] {
  try {
    return unionAll([...accumulated, ...batch]);
  } catch {
    // Fall back to one-at-a-time so we don't lose 31 good triangles to one bad neighbour.
    let current = accumulated;
    for (const triangle of batch) {
      try {
        current = unionAll([...current, triangle]);
      } catch {
        // Drop this single triangle and keep going. Silent on purpose:
        // logging once per bad triangle would flood the console for large
        // Revit exports.
      }
    }
    return current;
  }
}

function unionAll(polygons: ClippingPolygon[]): ClippingPolygon[] {
  if (polygons.length === 0) return [];
  const [head, ...rest] = polygons;
  if (!head) return [];
  if (rest.length === 0) return [head];
  const unioned = polygonClipping.union(head as unknown as never, ...(rest as unknown as never[]));
  return unioned as unknown as ClippingPolygon[];
}

function triangleArea(ring: Array<[number, number]>): number {
  if (ring.length < 3) return 0;
  const [a, b, c] = [ring[0]!, ring[1]!, ring[2]!];
  return Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
}
