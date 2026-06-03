import { describe, expect, it } from "vitest";
import { buildOutputDescriptors, FLOORPLAN_OUTPUT_FOLDER_NAME } from "../../../src/persistence/uploadToTrimble";
import type { StoreyDocument } from "../../../src/types";

function makeDoc(storeyName: string, expressId: number): StoreyDocument {
  return {
    schemaVersion: "1.0.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    generator: { name: "trimble-sitePlan2D", version: "0.1.0" },
    source: {
      fileId: "f",
      versionId: "v",
      fileName: "Building.ifc",
      ifcSchema: null,
      projectId: "p",
      projectName: "Test",
    },
    storey: { expressId, ifcGuid: "S", name: storeyName, longName: null, elevation: 0, unit: "m" },
    units: "m",
    boundingBox: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 },
    cutHeightAboveStorey: 1.2,
    objects: [],
    userAreas: [],
  };
}

describe("buildOutputDescriptors", () => {
  it("emits one svg and one json per storey, named {base}-{storey}", () => {
    const outputs = buildOutputDescriptors("My Building", [makeDoc("L01", 1), makeDoc("Roof", 2)]);
    const names = outputs.map((output) => output.name);
    expect(names).toEqual(["my-building-l01.svg", "my-building-l01.json", "my-building-roof.svg", "my-building-roof.json"]);
  });

  it("falls back to storey-<expressId> when the IFC has no storey name", () => {
    const outputs = buildOutputDescriptors("Tower", [makeDoc("", 42)]);
    expect(outputs.map((output) => output.name)).toEqual(["tower-storey-42.svg", "tower-storey-42.json"]);
  });

  it("uses content-types image/svg+xml and application/json", () => {
    const outputs = buildOutputDescriptors("X", [makeDoc("L1", 1)]);
    expect(outputs[0]?.contentType).toBe("image/svg+xml");
    expect(outputs[1]?.contentType).toBe("application/json");
  });
});

describe("FLOORPLAN_OUTPUT_FOLDER_NAME", () => {
  it("is the agreed-upon project folder name", () => {
    expect(FLOORPLAN_OUTPUT_FOLDER_NAME).toBe("siteplan2d");
  });
});

describe("buildOutputDescriptors with per-storey filename overrides", () => {
  it("applies the override as the suffix while keeping the IFC base name forced as the prefix", () => {
    const outputs = buildOutputDescriptors(
      "My Building",
      [makeDoc("L01", 1), makeDoc("Roof", 2)],
      { 1: "Ground Plan" }, // override only the first storey
    );
    expect(outputs.map((output) => output.name)).toEqual([
      // overridden suffix, model name still forced as prefix:
      "my-building-ground-plan.svg",
      "my-building-ground-plan.json",
      // second storey falls through to the default storey-name suffix:
      "my-building-roof.svg",
      "my-building-roof.json",
    ]);
  });

  it("slugifies the override to keep filenames safe (no path separators or spaces)", () => {
    const outputs = buildOutputDescriptors(
      "Tower",
      [makeDoc("L1", 10)],
      { 10: "Level / 1 . preview" },
    );
    expect(outputs.map((output) => output.name)).toEqual([
      "tower-level-1-preview.svg",
      "tower-level-1-preview.json",
    ]);
  });

  it("falls back to the default suffix when the override slugifies to empty", () => {
    const outputs = buildOutputDescriptors(
      "Tower",
      [makeDoc("L1", 10)],
      { 10: "***" }, // produces an empty slug
    );
    expect(outputs.map((output) => output.name)).toEqual([
      "tower-l1.svg",
      "tower-l1.json",
    ]);
  });
});
