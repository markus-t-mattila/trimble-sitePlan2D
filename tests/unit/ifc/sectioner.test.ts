import { describe, expect, it } from "vitest";
import { intersectTriangleWithHorizontalPlane } from "../../../src/ifc/footprint/sectioner";

describe("intersectTriangleWithHorizontalPlane", () => {
  it("returns null when the triangle is entirely above the plane", () => {
    const result = intersectTriangleWithHorizontalPlane(0, 0, 2, 1, 0, 2, 0, 1, 2, 1);
    expect(result).toBeNull();
  });

  it("returns null when the triangle is entirely below the plane", () => {
    const result = intersectTriangleWithHorizontalPlane(0, 0, 0, 1, 0, 0, 0, 1, 0, 1);
    expect(result).toBeNull();
  });

  it("returns the cut segment when the plane crosses two edges", () => {
    // Triangle with vertices at z=0,0,2 should cut the plane at z=1.
    const result = intersectTriangleWithHorizontalPlane(0, 0, 0, 2, 0, 0, 0, 2, 2, 1);
    expect(result).not.toBeNull();
    if (!result) return;
    const xs = [result.a[0], result.b[0]];
    const ys = [result.a[1], result.b[1]];
    // The cut segment connects (0,1) and (1,1).
    expect(xs.includes(0)).toBe(true);
    expect(xs.includes(1)).toBe(true);
    expect(ys.every((y) => Math.abs(y - 1) < 1e-6)).toBe(true);
  });
});
