// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildStoreySvg } from "../../../src/generator/svgBuilder";
import type { RenderOptions, StoreyDocument } from "../../../src/types";

function makeDoc(overrides: Partial<StoreyDocument> = {}): StoreyDocument {
  return {
    schemaVersion: "1.0.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    generator: { name: "trimble-sitePlan2D", version: "0.1.0" },
    source: {
      fileId: "f",
      versionId: "v",
      fileName: "Building.ifc",
      ifcSchema: "IFC4",
      projectId: "p",
      projectName: "Test",
    },
    storey: { expressId: 1, ifcGuid: "STOREY", name: "L01", longName: null, elevation: 0, unit: "m" },
    units: "m",
    boundingBox: { xMin: 10000, yMin: 10000, xMax: 10010, yMax: 10005 },
    cutHeightAboveStorey: 1.2,
    objects: [
      {
        ifcGuid: "WALL-1",
        ifcType: "IfcWall",
        name: "Wall-1",
        longName: "Exterior",
        polygons: [
          [
            [
              [10000, 10000],
              [10010, 10000],
              [10010, 10000.2],
              [10000, 10000.2],
            ],
          ],
        ],
      },
    ],
    userAreas: [],
    ...overrides,
  };
}

describe("buildStoreySvg render options", () => {
  it("emits CSS custom properties for every IFC type present", () => {
    const svg = buildStoreySvg(makeDoc());
    expect(svg).toContain("--floorplan-ifcwall-stroke");
    expect(svg).toContain("--floorplan-ifcwall-fill");
    expect(svg).toContain(".ifc-ifcwall {");
  });

  it("places labels inside shapes when labelSource = name", () => {
    const renderOptions: RenderOptions = {
      labelSource: "name",
      userAreaLabelSource: "none",
      fontSizeWorld: 0.5,
      fillStyle: "none",
      singleFillColor: "#000000",
      strokeWidthWorld: 0.05,
      typeStyles: {},
      objectStyles: {},
      projectionAxis: "z",
    };
    const doc = makeDoc({ renderOptions });
    const svg = buildStoreySvg(doc);
    expect(svg).toContain("class=\"ifc-label\"");
    expect(svg).toContain("Wall-1");
    expect(svg).toMatch(/transform="translate\(10005/);
  });

  it("does not render labels when labelSource = none", () => {
    const renderOptions: RenderOptions = {
      labelSource: "none",
      userAreaLabelSource: "none",
      fontSizeWorld: 0.5,
      fillStyle: "none",
      singleFillColor: "#000000",
      strokeWidthWorld: 0.05,
      typeStyles: {},
      objectStyles: {},
      projectionAxis: "z",
    };
    const svg = buildStoreySvg(makeDoc({ renderOptions }));
    expect(svg).not.toContain("class=\"ifc-label\"");
  });

  it("keeps the viewBox tight to the world bounding box (no empty whitespace to origin)", () => {
    const svg = buildStoreySvg(makeDoc());
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const viewBox = dom.documentElement.getAttribute("viewBox") ?? "";
    const parts = viewBox.split(/\s+/).map(Number);
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBeGreaterThan(9000);
    expect(parts[0]).toBeLessThan(10001);
    expect(parts[1]).toBeGreaterThan(9000);
    expect(parts[2]).toBeLessThan(20);
    expect(parts[3]).toBeLessThan(20);
  });

  it("writes only data + class attributes on IFC paths (no inline styling)", () => {
    const svg = buildStoreySvg(makeDoc());
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const path = dom.querySelector(".ifc-object");
    expect(path).not.toBeNull();
    if (!path) return;
    const attributeNames = Array.from(path.attributes).map((attr) => attr.name);
    expect(attributeNames).not.toContain("style");
    expect(attributeNames).not.toContain("fill");
    expect(attributeNames).not.toContain("stroke");
    expect(attributeNames).toContain("class");
    expect(attributeNames).toContain("data-ifc-guid");
    expect(attributeNames).toContain("data-ifc-type");
  });

  it("never emits color-mix() in any fill style — svg2pdf can't parse it and the PDF export would fail", () => {
    for (const fillStyle of ["none", "perType", "single", "byName"] as const) {
      const renderOptions: RenderOptions = {
        labelSource: "none",
        userAreaLabelSource: "none",
        fontSizeWorld: 0.5,
        fillStyle,
        singleFillColor: "#0063a3",
        strokeWidthWorld: 0.05,
        typeStyles: {},
        objectStyles: {},
        projectionAxis: "z",
      };
      const svg = buildStoreySvg(makeDoc({ renderOptions }));
      expect(svg, `fillStyle=${fillStyle} must not emit color-mix()`).not.toContain("color-mix(");
    }
  });
});
