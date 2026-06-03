// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { buildStoreySvg } from "../../../src/generator/svgBuilder";
import type { BackgroundImage, SiteElement, StoreyDocument } from "../../../src/types";

function makeDoc(overrides: Partial<StoreyDocument> = {}): StoreyDocument {
  return {
    schemaVersion: "1.0.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    generator: { name: "trimble-sitePlan2D", version: "0.1.0" },
    source: {
      fileId: "f",
      versionId: "v",
      fileName: "Tower.ifc",
      ifcSchema: null,
      projectId: "p",
      projectName: "P",
    },
    storey: { expressId: 1, ifcGuid: "S", name: "L01", longName: null, elevation: 0, unit: "m" },
    units: "m",
    boundingBox: { xMin: 0, yMin: 0, xMax: 30, yMax: 20 },
    cutHeightAboveStorey: 1.2,
    objects: [],
    userAreas: [],
    ...overrides,
  };
}

describe("buildStoreySvg site elements", () => {
  it("emits a polyline path for driving routes", () => {
    const element: SiteElement = {
      id: "00000000-0000-4000-8000-000000000001",
      name: "Main route",
      category: "driving-route",
      geometry: { kind: "polyline", vertices: [[0, 0], [10, 0], [10, 10]] },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const svg = buildStoreySvg(makeDoc({ siteElements: [element] }));
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const path = dom.querySelector(".site-element-polyline");
    expect(path).not.toBeNull();
    expect(path?.getAttribute("data-site-element-category")).toBe("driving-route");
  });

  it("emits a <use> symbol reference for point categories", () => {
    const element: SiteElement = {
      id: "00000000-0000-4000-8000-000000000002",
      name: "Crane #1",
      category: "crane",
      geometry: { kind: "point", position: [5, 5], rotationDeg: 0 },
      createdAt: "2026-01-01T00:00:00.000Z",
    };
    const svg = buildStoreySvg(makeDoc({ siteElements: [element] }));
    const dom = new DOMParser().parseFromString(svg, "image/svg+xml");
    const use = dom.querySelector("use[data-site-element-id]");
    expect(use).not.toBeNull();
    expect(use?.getAttribute("href")).toBe("#symbol-crane");
  });

  it("includes a <symbol> definition for every point category", () => {
    const svg = buildStoreySvg(makeDoc());
    expect(svg).toContain("<symbol id=\"symbol-crane\"");
    expect(svg).toContain("<symbol id=\"symbol-gate\"");
  });

  it("renders the background image only when present", () => {
    const svgWithout = buildStoreySvg(makeDoc());
    // The class rule for `.background-image` is always present in the style
    // block; the actual `<g class="background-image">` group is not.
    expect(svgWithout).not.toContain("data-background");
    const background: BackgroundImage = {
      href: "data:image/png;base64,abc",
      origin: [0, 0],
      widthWorld: 30,
      heightWorld: 20,
      rotationDeg: 0,
      opacity: 0.6,
      pixelWidth: 1000,
      pixelHeight: 666,
      locked: false,
    };
    const svgWith = buildStoreySvg(makeDoc({ backgroundImage: background }));
    expect(svgWith).toContain("data-background=\"true\"");
    expect(svgWith).toContain("data:image/png;base64,abc");
  });
});
