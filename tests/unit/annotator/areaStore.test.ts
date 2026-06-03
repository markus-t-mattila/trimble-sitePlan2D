import { describe, expect, it } from "vitest";
import { AreaNameRegistry } from "../../../src/annotator/areaStore";
import type { UserArea } from "../../../src/types";

const sampleArea: UserArea = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  name: "Takt-A",
  kind: "takt",
  polygon: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
};

describe("AreaNameRegistry", () => {
  it("treats names case-insensitively", () => {
    const registry = new AreaNameRegistry();
    registry.reset([sampleArea]);
    expect(registry.contains("TAKT-a")).toBe(true);
    expect(registry.contains("takt-a")).toBe(true);
    expect(registry.contains("takt-b")).toBe(false);
  });

  it("rejects adding a duplicate name", () => {
    const registry = new AreaNameRegistry();
    registry.reset([sampleArea]);
    expect(registry.add("takt-A")).toBe(false);
    expect(registry.add("takt-B")).toBe(true);
  });

  it("renames atomically", () => {
    const registry = new AreaNameRegistry();
    registry.reset([sampleArea]);
    expect(registry.rename("Takt-A", "Takt-A2")).toBe(true);
    expect(registry.contains("takt-a")).toBe(false);
    expect(registry.contains("takt-a2")).toBe(true);
  });

  it("refuses to rename onto an existing name", () => {
    const registry = new AreaNameRegistry();
    registry.reset([sampleArea, { ...sampleArea, id: "b", name: "Takt-B" }]);
    expect(registry.rename("Takt-A", "Takt-B")).toBe(false);
    expect(registry.contains("takt-a")).toBe(true);
    expect(registry.contains("takt-b")).toBe(true);
  });
});
