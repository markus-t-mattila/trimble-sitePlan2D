import { describe, expect, it } from "vitest";
import { buildStoreyJson } from "../../../src/generator/jsonBuilder";
import { storeyDocumentSchema } from "../../../src/generator/schema";
import type { StoreyObject, UserArea } from "../../../src/types";

const baseInput = {
  generatorVersion: "0.1.0",
  source: {
    fileId: "file-1",
    versionId: "v-1",
    fileName: "Building.ifc",
    ifcSchema: "IFC4",
    projectId: "p-1",
    projectName: "Test",
  },
  storey: {
    expressId: 42,
    ifcGuid: "2u5Y3vEXn6vugkqIIugxR_",
    name: "L01",
    longName: null,
    elevation: 0,
  },
  units: "m" as const,
  cutHeightAboveStorey: 1.2,
  generatedAt: "2026-01-01T00:00:00.000Z",
};

describe("buildStoreyJson", () => {
  it("validates against the zod schema", () => {
    const objects: StoreyObject[] = [
      {
        ifcGuid: "AAA",
        ifcType: "IfcWall",
        name: "Wall-1",
        longName: "Exterior",
        polygons: [
          [
            [
              [0, 0],
              [3, 0],
              [3, 0.2],
              [0, 0.2],
            ],
          ],
        ],
      },
    ];
    const userAreas: UserArea[] = [];
    const doc = buildStoreyJson({ ...baseInput, objects, userAreas });
    expect(() => storeyDocumentSchema.parse(doc)).not.toThrow();
    expect(doc.boundingBox).toEqual({ xMin: 0, yMin: 0, xMax: 3, yMax: 0.2 });
  });

  it("falls back to a zero bounding box when there are no shapes", () => {
    const doc = buildStoreyJson({ ...baseInput, objects: [], userAreas: [] });
    expect(doc.boundingBox).toEqual({ xMin: 0, yMin: 0, xMax: 0, yMax: 0 });
  });

  it("includes user areas in the bounding box", () => {
    const doc = buildStoreyJson({
      ...baseInput,
      objects: [],
      userAreas: [
        {
          id: "a1aa1aa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
          name: "Takt-1",
          kind: "takt",
          polygon: [
            [-1, -1],
            [2, -1],
            [2, 2],
            [-1, 2],
          ],
          createdAt: "2026-01-01T00:00:00.000Z",
        },
      ],
    });
    expect(doc.boundingBox).toEqual({ xMin: -1, yMin: -1, xMax: 2, yMax: 2 });
  });
});
