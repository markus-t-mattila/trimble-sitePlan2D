import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useFloorplanStore } from "../../../src/state/floorplanStore";
import type { StoreyDocument, UserArea } from "../../../src/types";

const baseArea: UserArea = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Takt-A",
  kind: "takt",
  polygon: [
    [0, 0],
    [1, 0],
    [1, 1],
  ],
  createdAt: "2026-01-01T00:00:00.000Z",
};

function baseDocument(): StoreyDocument {
  return {
    schemaVersion: "1.0.0",
    generatedAt: "2026-01-01T00:00:00.000Z",
    generator: { name: "trimble-sitePlan2D", version: "0.1.0" },
    source: {
      fileId: "f",
      versionId: "v",
      fileName: "Tower.ifc",
      ifcSchema: "IFC4",
      projectId: "p",
      projectName: "P",
    },
    storey: { expressId: 7, ifcGuid: "S", name: "L01", longName: null, elevation: 3, unit: "m" },
    units: "m",
    boundingBox: { xMin: 0, yMin: 0, xMax: 10, yMax: 10 },
    cutHeightAboveStorey: 1.2,
    objects: [],
    userAreas: [baseArea],
  };
}

describe("floorplanStore", () => {
  beforeEach(() => {
    useFloorplanStore.getState().resetStoreyDocuments();
  });
  afterEach(() => {
    useFloorplanStore.setState({
      accessToken: null,
      coreApiBaseUrl: null,
      project: null,
      ifcFiles: [],
      selectedFile: null,
      storeys: [],
      selectedStoreyExpressId: null,
      availableTypes: [],
      selectedTypes: [],
      storeyDocuments: {},
      status: "",
    });
  });

  it("loadStoreyDocument registers the storey and selects it", () => {
    const document = baseDocument();
    useFloorplanStore.getState().loadStoreyDocument(document);
    const state = useFloorplanStore.getState();
    expect(state.selectedStoreyExpressId).toBe(7);
    expect(state.storeys.map((storey) => storey.expressId)).toContain(7);
    expect(state.storeyDocuments[7]?.userAreas).toHaveLength(1);
  });

  it("renameUserArea returns false for duplicates and true otherwise", () => {
    const document = baseDocument();
    document.userAreas.push({ ...baseArea, id: "22222222-2222-4222-8222-222222222222", name: "Takt-B" });
    useFloorplanStore.getState().loadStoreyDocument(document);
    const store = useFloorplanStore.getState();
    expect(store.renameUserArea(7, baseArea.id, "Takt-B")).toBe(false);
    expect(store.renameUserArea(7, baseArea.id, "Takt-A2")).toBe(true);
    expect(useFloorplanStore.getState().storeyDocuments[7]?.userAreas[0]?.name).toBe("Takt-A2");
  });

  it("changeUserAreaKind updates the stored kind", () => {
    const document = baseDocument();
    useFloorplanStore.getState().loadStoreyDocument(document);
    useFloorplanStore.getState().changeUserAreaKind(7, baseArea.id, "work");
    expect(useFloorplanStore.getState().storeyDocuments[7]?.userAreas[0]?.kind).toBe("work");
  });

  it("setRenderOptions cascades into every loaded document", () => {
    useFloorplanStore.getState().loadStoreyDocument(baseDocument());
    useFloorplanStore.getState().setRenderOptions({ labelSource: "name" });
    expect(useFloorplanStore.getState().storeyDocuments[7]?.renderOptions?.labelSource).toBe("name");
  });

  it("updateUserAreaPolygon replaces the vertex list when valid", () => {
    useFloorplanStore.getState().loadStoreyDocument(baseDocument());
    const nextPolygon: [number, number][] = [
      [0, 0],
      [5, 0],
      [5, 5],
      [0, 5],
    ];
    useFloorplanStore.getState().updateUserAreaPolygon(7, baseArea.id, nextPolygon);
    expect(useFloorplanStore.getState().storeyDocuments[7]?.userAreas[0]?.polygon).toEqual(nextPolygon);
  });

  it("updateUserAreaPolygon ignores degenerate polygons (fewer than 3 vertices)", () => {
    useFloorplanStore.getState().loadStoreyDocument(baseDocument());
    useFloorplanStore.getState().updateUserAreaPolygon(7, baseArea.id, [[0, 0], [1, 0]]);
    expect(useFloorplanStore.getState().storeyDocuments[7]?.userAreas[0]?.polygon).toEqual(baseArea.polygon);
  });

  it("updateSiteElementVertices replaces polygon + polyline vertex lists", () => {
    const document = baseDocument();
    document.siteElements = [
      {
        id: "AAAA",
        name: "Site Cabin",
        category: "site-cabin",
        geometry: { kind: "polygon", vertices: [[0, 0], [2, 0], [2, 2]] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
      {
        id: "BBBB",
        name: "Fence",
        category: "fence",
        geometry: { kind: "polyline", vertices: [[0, 0], [10, 0]] },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    useFloorplanStore.getState().loadStoreyDocument(document);
    useFloorplanStore.getState().updateSiteElementVertices(7, "AAAA", [[1, 1], [5, 1], [5, 5], [1, 5]]);
    useFloorplanStore.getState().updateSiteElementVertices(7, "BBBB", [[0, 0], [3, 4], [10, 0]]);
    const stored = useFloorplanStore.getState().storeyDocuments[7]?.siteElements ?? [];
    expect(stored[0]?.geometry).toMatchObject({ kind: "polygon", vertices: [[1, 1], [5, 1], [5, 5], [1, 5]] });
    expect(stored[1]?.geometry).toMatchObject({ kind: "polyline", vertices: [[0, 0], [3, 4], [10, 0]] });
  });

  it("user-area mutations mark the document dirty so Save activates", () => {
    useFloorplanStore.getState().loadStoreyDocument(baseDocument());
    expect(useFloorplanStore.getState().dirty).toBe(false);
    useFloorplanStore.getState().changeUserAreaKind(7, baseArea.id, "work");
    expect(useFloorplanStore.getState().dirty).toBe(true);
  });

  it("undo / redo restore the previous storeyDocuments snapshot", () => {
    useFloorplanStore.getState().loadStoreyDocument(baseDocument());
    const before = useFloorplanStore.getState().storeyDocuments[7]?.userAreas[0]?.kind;
    expect(before).toBe("takt");
    useFloorplanStore.getState().changeUserAreaKind(7, baseArea.id, "work");
    expect(useFloorplanStore.getState().storeyDocuments[7]?.userAreas[0]?.kind).toBe("work");
    useFloorplanStore.getState().undo();
    expect(useFloorplanStore.getState().storeyDocuments[7]?.userAreas[0]?.kind).toBe("takt");
    useFloorplanStore.getState().redo();
    expect(useFloorplanStore.getState().storeyDocuments[7]?.userAreas[0]?.kind).toBe("work");
  });

  it("undo is a no-op when nothing is on the past stack", () => {
    useFloorplanStore.getState().loadStoreyDocument(baseDocument());
    expect(() => useFloorplanStore.getState().undo()).not.toThrow();
    expect(useFloorplanStore.getState().storeyDocuments[7]?.userAreas[0]?.kind).toBe("takt");
  });

  it("history is capped at 20 entries (oldest dropped)", () => {
    useFloorplanStore.getState().loadStoreyDocument(baseDocument());
    for (let i = 0; i < 25; i++) {
      // Alternate kinds so each call IS a genuine state change.
      useFloorplanStore.getState().changeUserAreaKind(7, baseArea.id, i % 2 === 0 ? "work" : "other");
    }
    expect(useFloorplanStore.getState().past.length).toBe(20);
  });

  it("updateSiteElementVertices is a no-op on point geometry", () => {
    const document = baseDocument();
    document.siteElements = [
      {
        id: "CRANE",
        name: "Crane 1",
        category: "crane",
        geometry: { kind: "point", position: [5, 5], rotationDeg: 0 },
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    useFloorplanStore.getState().loadStoreyDocument(document);
    // Should not mutate or crash — points are translated through
    // updateSiteElementGeometry.position, not updateSiteElementVertices.
    useFloorplanStore.getState().updateSiteElementVertices(7, "CRANE", [[9, 9]]);
    const stored = useFloorplanStore.getState().storeyDocuments[7]?.siteElements ?? [];
    expect(stored[0]?.geometry).toMatchObject({ kind: "point", position: [5, 5] });
  });
});
