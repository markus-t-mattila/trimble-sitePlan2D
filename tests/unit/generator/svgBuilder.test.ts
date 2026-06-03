// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildStoreySvg } from "../../../src/generator/svgBuilder";
import type { StoreyDocument } from "../../../src/types";

const sampleDoc: StoreyDocument = {
  schemaVersion: "1.0.0",
  generatedAt: "2026-01-01T00:00:00.000Z",
  generator: { name: "trimble-sitePlan2D", version: "0.1.0" },
  source: {
    fileId: "file-1",
    versionId: "v-1",
    fileName: "Building.ifc",
    ifcSchema: "IFC4",
    projectId: "p-1",
    projectName: "Test",
  },
  storey: { expressId: 42, ifcGuid: "STOREY-GUID", name: "L01", longName: null, elevation: 0, unit: "m" },
  units: "m",
  boundingBox: { xMin: 0, yMin: 0, xMax: 10, yMax: 5 },
  cutHeightAboveStorey: 1.2,
  objects: [
    {
      ifcGuid: "WALL-GUID-1",
      ifcType: "IfcWall",
      name: "W & 1",
      longName: "Exterior",
      polygons: [
        [
          [
            [0, 0],
            [10, 0],
            [10, 0.2],
            [0, 0.2],
          ],
        ],
      ],
    },
  ],
  userAreas: [
    {
      id: "a1aa1aa1-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      name: "Takt-A <1>",
      kind: "takt",
      polygon: [
        [1, 1],
        [4, 1],
        [4, 3],
        [1, 3],
      ],
      createdAt: "2026-01-01T00:00:00.000Z",
    },
  ],
};

describe("buildStoreySvg", () => {
  it("produces a parseable SVG with one path per object plus one per user area", () => {
    const svg = buildStoreySvg(sampleDoc);
    const parser = new DOMParser();
    const dom = parser.parseFromString(svg, "image/svg+xml");
    const parserError = dom.querySelector("parsererror");
    expect(parserError).toBeNull();

    const ifcPaths = dom.querySelectorAll(".ifc-content path");
    expect(ifcPaths.length).toBe(1);
    expect(ifcPaths[0]?.getAttribute("data-ifc-guid")).toBe("WALL-GUID-1");
    expect(ifcPaths[0]?.getAttribute("data-ifc-type")).toBe("IfcWall");
    expect(ifcPaths[0]?.getAttribute("data-ifc-name")).toBe("W & 1");

    const userPaths = dom.querySelectorAll(".user-areas path");
    expect(userPaths.length).toBe(1);
    expect(userPaths[0]?.getAttribute("data-user-area-name")).toBe("Takt-A <1>");
    expect(userPaths[0]?.getAttribute("data-user-area-kind")).toBe("takt");
  });

  it("includes a Y-flip transform so path coordinates equal IFC world XY", () => {
    const svg = buildStoreySvg(sampleDoc);
    expect(svg).toContain("scale(1 -1)");
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const root = dom.documentElement;
    expect(root.getAttribute("viewBox")).toMatch(/^-?\d/);
    expect(root.getAttribute("data-unit")).toBe("m");
    expect(root.getAttribute("data-storey-guid")).toBe("STOREY-GUID");
  });

  it("escapes ampersands and angle brackets in user input", () => {
    const svg = buildStoreySvg(sampleDoc);
    expect(svg).toContain("data-ifc-name=\"W &amp; 1\"");
    expect(svg).toContain("data-user-area-name=\"Takt-A &lt;1&gt;\"");
  });
});
