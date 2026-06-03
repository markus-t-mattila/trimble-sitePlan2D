import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { findOrCreateProjectFolder } from "../../../src/trimble/coreApiClient";

type FetchInput = string | URL | Request;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("findOrCreateProjectFolder", () => {
  const fetchMock = vi.fn<(input: FetchInput, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the existing folder id when one matches by name (case-insensitive)", async () => {
    fetchMock.mockImplementationOnce(async (input) => {
      expect(String(input)).toContain("/folders/ROOT/items");
      return jsonResponse({
        items: [
          { id: "FILE-1", name: "Drawings.pdf", type: "FILE" },
          // Stored with different casing than the lookup to verify the
          // case-insensitive name comparison.
          { id: "FLDR-A", name: "SitePlan2D", type: "FOLDER" },
        ],
      });
    });
    const result = await findOrCreateProjectFolder("tok", "https://app.example.com", "ROOT", "siteplan2d");
    expect(result).toEqual({ folderId: "FLDR-A", created: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates the folder when none matches, sending the Trimble Core body shape", async () => {
    fetchMock
      .mockImplementationOnce(async () => jsonResponse({ items: [{ id: "F1", name: "Other", type: "FOLDER" }] }))
      .mockImplementationOnce(async (input, init) => {
        expect(String(input)).toContain("/folders");
        expect(init?.method).toBe("POST");
        const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
        // Body shape verified against the working trimble-sitedrive
        // integration: `{ name, parentId, projectId, rootId }`. Without
        // projectId + rootId, Trimble returns 400/422 with no useful
        // diagnostic — silently no folder ever appears.
        expect(body["name"]).toBe("siteplan2d");
        expect(body["parentId"]).toBe("ROOT");
        expect(body["rootId"]).toBe("ROOT");
        expect(body["projectId"]).toBe("PROJ-1");
        // The file-upload `parentType` discriminator must NOT be sent to
        // the folder endpoint — it's only valid for /files/fs/initiate.
        expect(body["parentType"]).toBeUndefined();
        return jsonResponse({ id: "NEW-FLDR" }, 201);
      });
    const result = await findOrCreateProjectFolder(
      "tok",
      "https://app.example.com",
      "ROOT",
      "siteplan2d",
      "PROJ-1",
    );
    expect(result).toEqual({ folderId: "NEW-FLDR", created: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from a 409 'already exists' by re-listing and resolving the id", async () => {
    fetchMock
      // first list — folder isn't visible (pagination edge / race)
      .mockImplementationOnce(async () => jsonResponse({ items: [{ id: "OTHER", name: "Other", type: "FOLDER" }] }))
      // POST → 409 conflict
      .mockImplementationOnce(async () => jsonResponse({ message: "already exists" }, 409))
      // second list — now we find it
      .mockImplementationOnce(async () =>
        jsonResponse({
          items: [
            { id: "OTHER", name: "Other", type: "FOLDER" },
            { id: "WINNER", name: "siteplan2d", type: "FOLDER" },
          ],
        }),
      );
    const result = await findOrCreateProjectFolder(
      "tok",
      "https://app.example.com",
      "ROOT",
      "siteplan2d",
      "PROJ-1",
    );
    expect(result).toEqual({ folderId: "WINNER", created: false });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects empty inputs early", async () => {
    await expect(findOrCreateProjectFolder("tok", "https://app.example.com", "", "x")).rejects.toThrow();
    await expect(findOrCreateProjectFolder("tok", "https://app.example.com", "ROOT", "")).rejects.toThrow();
  });
});
