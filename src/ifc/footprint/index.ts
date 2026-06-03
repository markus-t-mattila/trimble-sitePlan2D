import type { Polygon, Vec2 } from "../../types";
import { applyToPoint3 } from "../../utils/matrix";
import type { MeshFlat } from "./projector";
import { projectMeshOntoPlane } from "./projector";
import { intersectTriangleWithHorizontalPlane } from "./sectioner";
import type { Segment2D } from "./sectioner";
import { chainSegmentsIntoRings, simplifyPolygons } from "./polygonOps";

export type { MeshFlat } from "./projector";

export type ProjectionAxis = "x" | "y" | "z";

export interface FootprintInput {
  mesh: MeshFlat;
  placement: ArrayLike<number>;
  /** Position of the cut plane along the chosen `upAxis` (in IFC world units). */
  cutPosition: number;
  /** Which world axis points "up". Default `"z"` matches the IFC standard. */
  upAxis?: ProjectionAxis;
}

/**
 * Compute the 2D footprint polygons for one IFC object.
 *
 * web-ifc's vertex arrays and placement matrices come back in **Three.js
 * convention** (Y is up, Z points out of the screen). That is *not* the way
 * IFC files or third-party IFC viewers present coordinates — they use the
 * IFC standard where **Z is up**. We translate every transformed vertex
 * back into IFC convention before any sectioning / projection. After that
 * conversion the rest of the pipeline (sectioner, cursor coordinate
 * overlay, JSON output) works in IFC coordinates so the numbers we show
 * the user match what they see in BIM tooling.
 *
 * `upAxis` lets the caller override the assumption that IFC Z is the
 * vertical direction — useful for the rare files that already came in with
 * a non-standard convention. Default `"z"` is correct for ≥99% of files.
 */
export function computeFootprint(input: FootprintInput): Polygon[] {
  const segments: Segment2D[] = [];
  const mesh = input.mesh;
  const triCount = mesh.indices.length / 3;
  const placement = input.placement;
  const cutPosition = input.cutPosition;
  const upAxis: ProjectionAxis = input.upAxis ?? "z";

  function worldToPlanFrame(x: number, y: number, z: number): [number, number, number] {
    const webIfc = applyToPoint3(placement, x, y, z);
    const ifc = webIfcToIfcConvention(webIfc);
    return remapForUpAxis(ifc, upAxis);
  }

  let crossedCount = 0;
  for (let i = 0; i < triCount; i++) {
    const i0 = mesh.indices[i * 3]! * mesh.vertexStride;
    const i1 = mesh.indices[i * 3 + 1]! * mesh.vertexStride;
    const i2 = mesh.indices[i * 3 + 2]! * mesh.vertexStride;
    const a = worldToPlanFrame(mesh.vertexFloats[i0]!, mesh.vertexFloats[i0 + 1]!, mesh.vertexFloats[i0 + 2]!);
    const b = worldToPlanFrame(mesh.vertexFloats[i1]!, mesh.vertexFloats[i1 + 1]!, mesh.vertexFloats[i1 + 2]!);
    const c = worldToPlanFrame(mesh.vertexFloats[i2]!, mesh.vertexFloats[i2 + 1]!, mesh.vertexFloats[i2 + 2]!);
    const seg = intersectTriangleWithHorizontalPlane(
      a[0], a[1], a[2],
      b[0], b[1], b[2],
      c[0], c[1], c[2],
      cutPosition,
    );
    if (seg) {
      segments.push(seg);
      crossedCount++;
    }
  }

  if (crossedCount > 0) {
    const rings = chainSegmentsIntoRings(segments);
    if (rings.length > 0) {
      // Each chained ring becomes its own simple polygon (no holes). We
      // then strip near-collinear vertices so a rectangle reads as 4
      // corners + closure, not 8 (one extra per triangulated edge).
      const polygons = rings.map((ring) => [ring as ReadonlyArray<Vec2>] as Polygon);
      return simplifyPolygons(polygons);
    }
  }

  // Fallback: project every triangle onto the plan plane and union them.
  // The union output is also triangulation-heavy at the boundary; simplify
  // the same way for consistency with the sectioning path.
  return simplifyPolygons(projectMeshOntoPlane(mesh, worldToPlanFrame));
}

/**
 * Re-order web-ifc's vertex output into the standard IFC convention.
 *
 * web-ifc reports vertex coordinates in a right-handed Three.js-style frame
 * where **Y is the vertical axis** and **Z points away from the viewer**.
 * IFC files and every IFC viewer display coordinates with **Z as the
 * vertical axis** and Y as the in-plane "north / forward" direction.
 *
 * Mapping (right-handed → right-handed, single 90° rotation around X):
 *   IFC.X =  webifc.X
 *   IFC.Y = -webifc.Z   (sign flip because the third axis points the
 *                        opposite way between the two conventions)
 *   IFC.Z =  webifc.Y
 *
 * With this in place the rest of the pipeline (sectioner cut at constant
 * IFC.Z, cursor coordinate overlay, JSON output) lines up with what every
 * other IFC tool shows.
 */
function webIfcToIfcConvention(world: [number, number, number]): [number, number, number] {
  return [world[0], -world[2], world[1]];
}

/**
 * Reorder the three IFC-convention coordinates so the chosen "up" axis lands
 * at index 2. The 2D plan view consumes index 0 + index 1.
 */
function remapForUpAxis(
  world: [number, number, number],
  upAxis: ProjectionAxis,
): [number, number, number] {
  switch (upAxis) {
    case "z":
      return world;
    case "y":
      // (x, y, z) -> (x, z, y); cut is at constant Y, plan stays (X, Z).
      return [world[0], world[2], world[1]];
    case "x":
      // (x, y, z) -> (y, z, x); cut is at constant X, plan stays (Y, Z).
      return [world[1], world[2], world[0]];
    default:
      return world;
  }
}
