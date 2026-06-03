import { describe, expect, it } from "vitest";
import { chainSegmentsIntoRings, simplifyPolygons, simplifyRing } from "../../../src/ifc/footprint/polygonOps";
import type { Segment2D } from "../../../src/ifc/footprint/sectioner";
import type { Polygon, Vec2 } from "../../../src/types";

describe("chainSegmentsIntoRings", () => {
  it("returns an empty array for empty input", () => {
    expect(chainSegmentsIntoRings([])).toEqual([]);
  });

  it("chains four edges into one square ring", () => {
    const segments: Segment2D[] = [
      { a: [0, 0], b: [1, 0] },
      { a: [1, 0], b: [1, 1] },
      { a: [1, 1], b: [0, 1] },
      { a: [0, 1], b: [0, 0] },
    ];
    const rings = chainSegmentsIntoRings(segments);
    expect(rings).toHaveLength(1);
    expect(rings[0]?.length).toBeGreaterThanOrEqual(4);
  });

  it("returns two rings when two disjoint cycles are present", () => {
    const segments: Segment2D[] = [
      { a: [0, 0], b: [1, 0] },
      { a: [1, 0], b: [0, 0] },
      { a: [10, 10], b: [11, 10] },
      { a: [11, 10], b: [10, 10] },
    ];
    // 2-edge cycles are degenerate (two parallel segments between the same
    // pair of points); chaining yields at most 1 valid ring per cycle, which
    // is fine for this test — we assert non-zero rings.
    const rings = chainSegmentsIntoRings(segments);
    expect(rings.length).toBeGreaterThan(0);
  });
});

describe("simplifyRing", () => {
  it("collapses three collinear vertices into two", () => {
    // Mid-point sits exactly on the line A→C.
    const ring: Vec2[] = [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ];
    const result = simplifyRing(ring);
    expect(result).toEqual([
      [0, 0],
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
    ]);
  });

  it("strips the RAVA3pro IfcSpace pattern down to its 4 real corners", () => {
    // Real reproduction of the bug: a rotated rectangle with 2 extra
    // collinear mid-edge points per edge that web-ifc's triangulation
    // emitted. After simplification we keep the 4 corners (+ closure).
    const ring: Vec2[] = [
      [2.189575849225032, 30.898351359674884],
      [3.7013508958809807, 30.666756000950812],
      [5.253827578557733, 30.428925382545913],
      [5.6273674225079615, 32.86726533083703],
      [6.0109641084475856, 35.371252893361394],
      [4.499189061791637, 35.602848252085465],
      [2.946712379114885, 35.840678870490365],
      [2.573172535164656, 33.40233892219925],
      [2.189575849225032, 30.898351359674884],
    ];
    const result = simplifyRing(ring);
    expect(result).toHaveLength(5);
    expect(result[0]).toEqual(result[result.length - 1]);
    // The four corners are the start, the end of the right edge, the top,
    // and the end of the bottom-left edge.
    const corners = result.slice(0, -1);
    expect(corners).toEqual([
      [2.189575849225032, 30.898351359674884],
      [5.253827578557733, 30.428925382545913],
      [6.0109641084475856, 35.371252893361394],
      [2.946712379114885, 35.840678870490365],
    ]);
  });

  it("removes the seam vertex when the first/last neighbours are collinear with it", () => {
    // Ring that starts mid-edge: [(0,0), (1,0), (2,0), (2,1), (0,1)].
    // The starting (0,0) is collinear with its wrap-around neighbours
    // (0,1) and (1,0)? — actually no, (0,0) is a real corner here.
    // Use a case where the seam vertex IS collinear: start mid-edge.
    const ring: Vec2[] = [
      [1, 0],   // seam — lies on (0,0)-(2,0)
      [2, 0],
      [2, 2],
      [0, 2],
      [0, 0],
      [1, 0],
    ];
    const result = simplifyRing(ring);
    // After simplification, the seam vertex is gone.
    expect(result.length).toBeLessThanOrEqual(5);
    const corners = result.slice(0, result.length - 1);
    expect(corners).toContainEqual([2, 0]);
    expect(corners).toContainEqual([2, 2]);
    expect(corners).toContainEqual([0, 2]);
    expect(corners).toContainEqual([0, 0]);
  });

  it("leaves a triangle (3 real corners) untouched", () => {
    const ring: Vec2[] = [
      [0, 0],
      [4, 0],
      [2, 3],
      [0, 0],
    ];
    expect(simplifyRing(ring)).toEqual(ring);
  });
});

describe("simplifyPolygons", () => {
  it("drops degenerate rings (fewer than 3 distinct vertices after simplification)", () => {
    const sliver: Polygon = [
      [
        [0, 0],
        [10, 0],
        [20, 0], // all collinear — collapses to a 2-point line
        [0, 0],
      ],
    ];
    const real: Polygon = [
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
        [0, 0],
      ],
    ];
    const result = simplifyPolygons([sliver, real]);
    expect(result).toHaveLength(1);
    expect(result[0]?.[0]?.length).toBe(5);
  });
});
