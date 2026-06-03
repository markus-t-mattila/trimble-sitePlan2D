import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { downloadSavedFloorplan, listSavedFloorplans } from "../../../src/persistence/loadFromTrimble";
import { __resetProjectRootFolderIdCacheForTests } from "../../../src/trimble/coreApiClient";

type FetchInput = string | URL | Request;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function bytesResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/octet-stream" },
  });
}

describe("listSavedFloorplans", () => {
  const fetchMock = vi.fn<(input: FetchInput, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    __resetProjectRootFolderIdCacheForTests();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("finds the siteplan2d folder and pairs json+svg by base name", async () => {
    fetchMock
      // resolveProjectRootFolderId -> GET /projects/{id}
      .mockImplementationOnce(async () =>
        jsonResponse({ id: "PROJ", rootFolderId: "ROOT" }),
      )
      // findOrCreateProjectFolder -> listFolderItems on the project root
      .mockImplementationOnce(async () =>
        jsonResponse({
          items: [
            { id: "FLDR-OUT", name: "siteplan2d", type: "FOLDER" },
            { id: "OTHER", name: "Some Other", type: "FOLDER" },
          ],
        }),
      )
      // listProjectFolderItems on the matched folder
      .mockImplementationOnce(async () =>
        jsonResponse({
          items: [
            { id: "JSON-1", fileId: "JSON-1", versionId: "VJ", name: "tower-l01.json", type: "FILE" },
            { id: "SVG-1", fileId: "SVG-1", versionId: "VS", name: "tower-l01.svg", type: "FILE" },
            { id: "JSON-2", fileId: "JSON-2", versionId: "VJ2", name: "tower-roof.json", type: "FILE" },
          ],
        }),
      );
    const listing = await listSavedFloorplans("tok", "https://app.example.com", "ROOT", "PROJ");
    expect(listing.folderId).toBe("FLDR-OUT");
    expect(listing.entries).toHaveLength(2);
    expect(listing.entries[0]).toMatchObject({
      jsonName: "tower-l01.json",
      jsonFileId: "JSON-1",
      svgFileId: "SVG-1",
    });
    expect(listing.entries[1]).toMatchObject({
      jsonName: "tower-roof.json",
      svgFileId: null,
    });
  });
});

describe("downloadSavedFloorplan", () => {
  const fetchMock = vi.fn<(input: FetchInput, init?: RequestInit) => Promise<Response>>();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("downloads and validates the JSON against the schema", async () => {
    const validDocument = {
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
      boundingBox: { xMin: 0, yMin: 0, xMax: 1, yMax: 1 },
      cutHeightAboveStorey: 1.2,
      objects: [],
      userAreas: [],
    };
    fetchMock
      .mockImplementationOnce(async () => jsonResponse({ url: "https://signed.example.com/abc" }))
      .mockImplementationOnce(async () => bytesResponse(JSON.stringify(validDocument)));
    const parsed = await downloadSavedFloorplan("tok", "https://app.example.com", {
      jsonFileId: "F",
      jsonVersionId: "V",
      jsonName: "tower-l01.json",
      svgFileId: null,
      svgVersionId: null,
    });
    expect(parsed.storey.name).toBe("L01");
    expect(parsed.boundingBox).toEqual({ xMin: 0, yMin: 0, xMax: 1, yMax: 1 });
  });
});
