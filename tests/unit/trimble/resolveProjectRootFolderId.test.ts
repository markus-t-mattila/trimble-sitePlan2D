import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetProjectRootFolderIdCacheForTests,
  resolveProjectRootFolderId,
} from "../../../src/trimble/coreApiClient";

type FetchInput = string | URL | Request;

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("resolveProjectRootFolderId", () => {
  const fetchMock = vi.fn<(input: FetchInput, init?: RequestInit) => Promise<Response>>();

  beforeEach(() => {
    fetchMock.mockReset();
    __resetProjectRootFolderIdCacheForTests();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("always prefers the Core API root over the workspace-supplied id", async () => {
    // The workspace may return a *wrong* rootFolderId (e.g. the IFC's
    // parent folder if it was filled in via Toolbar's fallback chain).
    // We must not trust that value blindly — the Core API is the source
    // of truth, matching trimble-sitedrive's getRootFolderId behaviour.
    fetchMock.mockImplementationOnce(async (input) => {
      expect(String(input)).toContain("/projects/PROJ-1");
      return jsonResponse({ id: "PROJ-1", rootFolderId: "ROOT-FROM-CORE" });
    });
    const id = await resolveProjectRootFolderId(
      "tok",
      "https://app.example.com",
      "PROJ-1",
      "ROOT-FROM-WORKSPACE-BUT-WRONG",
    );
    expect(id).toBe("ROOT-FROM-CORE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("handles nested rootFolder.id payloads (older Core API shape)", async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ id: "PROJ-1", rootFolder: { id: "ROOT-NESTED" } }),
    );
    const id = await resolveProjectRootFolderId(
      "tok",
      "https://app.example.com",
      "PROJ-1",
      null,
    );
    expect(id).toBe("ROOT-NESTED");
  });

  it("falls back to the workspace value when /projects/{id} fails", async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: "nope" }, 500));
    const id = await resolveProjectRootFolderId(
      "tok",
      "https://app.example.com",
      "PROJ-1",
      "ROOT-FROM-WORKSPACE",
    );
    expect(id).toBe("ROOT-FROM-WORKSPACE");
  });

  it("falls back to the projectId when both Core API and workspace are empty", async () => {
    fetchMock.mockImplementationOnce(async () => jsonResponse({ error: "nope" }, 500));
    const id = await resolveProjectRootFolderId(
      "tok",
      "https://app.example.com",
      "PROJ-1",
      null,
    );
    expect(id).toBe("PROJ-1");
  });

  it("caches the resolved root so repeated saves don't re-fetch", async () => {
    fetchMock.mockImplementationOnce(async () =>
      jsonResponse({ id: "PROJ-1", rootFolderId: "ROOT-FROM-CORE" }),
    );
    const first = await resolveProjectRootFolderId(
      "tok",
      "https://app.example.com",
      "PROJ-1",
      null,
    );
    const second = await resolveProjectRootFolderId(
      "tok",
      "https://app.example.com",
      "PROJ-1",
      null,
    );
    expect(first).toBe("ROOT-FROM-CORE");
    expect(second).toBe("ROOT-FROM-CORE");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
