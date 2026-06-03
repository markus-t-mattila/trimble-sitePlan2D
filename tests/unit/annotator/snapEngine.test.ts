import { describe, expect, it } from "vitest";
import { SnapEngine, projectPointOntoSegment } from "../../../src/annotator/SnapEngine";
import type { StoreyDocument } from "../../../src/types";

function buildDoc(): StoreyDocument {
  return {
    schemaVersion: "1.0.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    generator: { name: "trimble-sitePlan2D", version: "0.1.0" },
    source: {
      fileId: "f",
      versionId: "v",
      fileName: "f.ifc",
      ifcSchema: null,
      projectId: "p",
      projectName: "p",
    },
    storey: { expressId: 1, ifcGuid: "g", name: "L1", longName: null, elevation: 0, unit: "m" },
    units: "m",
    boundingBox: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 },
    cutHeightAboveStorey: 1.2,
    objects: [
      {
        ifcGuid: "WALL-1",
        ifcType: "IfcWall",
        name: "W",
        longName: null,
        polygons: [
          [
            [
              [0, 0],
              [10, 0],
              [10, 1],
              [0, 1],
            ],
          ],
        ],
      },
    ],
    userAreas: [],
  };
}

describe("SnapEngine", () => {
  it("returns null when nothing is in range", () => {
    const engine = SnapEngine.fromStorey(buildDoc());
    expect(engine.findNearest(100, 100, 0.5)).toBeNull();
  });

  it("snaps to the nearest IFC vertex when inside the radius", () => {
    const engine = SnapEngine.fromStorey(buildDoc());
    const snap = engine.findNearest(0.05, 0.05, 0.2);
    expect(snap).not.toBeNull();
    expect(snap?.kind).toBe("ifc-vertex");
    expect(snap?.point).toEqual([0, 0]);
    expect(snap?.sourceId).toBe("WALL-1");
  });

  it("snaps to an IFC edge when no vertex is close enough", () => {
    const engine = SnapEngine.fromStorey(buildDoc());
    const snap = engine.findNearest(5, 0.05, 0.2);
    expect(snap).not.toBeNull();
    expect(snap?.kind).toBe("ifc-edge");
    expect(snap?.point[0]).toBeCloseTo(5);
    expect(snap?.point[1]).toBeCloseTo(0);
  });
});

describe("projectPointOntoSegment", () => {
  it("projects onto the interior of the segment", () => {
    expect(projectPointOntoSegment(2, 1, 0, 0, 4, 0)).toEqual([2, 0]);
  });

  it("clamps to the endpoints when outside", () => {
    expect(projectPointOntoSegment(-5, 1, 0, 0, 4, 0)).toEqual([0, 0]);
    expect(projectPointOntoSegment(10, 1, 0, 0, 4, 0)).toEqual([4, 0]);
  });
});
