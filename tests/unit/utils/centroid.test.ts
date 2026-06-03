import { describe, expect, it } from "vitest";
import { bboxCenter, polygonCentroid } from "../../../src/utils/centroid";
import type { Vec2 } from "../../../src/types";

describe("polygonCentroid", () => {
  it("returns the centre of an axis-aligned square", () => {
    const ring: Vec2[] = [
      [0, 0],
      [4, 0],
      [4, 4],
      [0, 4],
    ];
    const [x, y] = polygonCentroid(ring);
    expect(x).toBeCloseTo(2);
    expect(y).toBeCloseTo(2);
  });

  it("returns the centroid of a triangle", () => {
    const ring: Vec2[] = [
      [0, 0],
      [6, 0],
      [0, 6],
    ];
    const [x, y] = polygonCentroid(ring);
    expect(x).toBeCloseTo(2);
    expect(y).toBeCloseTo(2);
  });

  it("falls back to the bounding box centre for degenerate rings", () => {
    const ring: Vec2[] = [
      [10, 10],
      [10, 10],
    ];
    expect(polygonCentroid(ring)).toEqual([10, 10]);
  });

  it("handles polygons far from the origin", () => {
    const ring: Vec2[] = [
      [10000, 10000],
      [10010, 10000],
      [10010, 10010],
      [10000, 10010],
    ];
    const [x, y] = polygonCentroid(ring);
    expect(x).toBeCloseTo(10005);
    expect(y).toBeCloseTo(10005);
  });
});

describe("bboxCenter", () => {
  it("returns origin for empty input", () => {
    expect(bboxCenter([])).toEqual([0, 0]);
  });
});
