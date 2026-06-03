import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import {
  downloadIfcArrayBuffer,
  isIfcFileName,
  listProjectIfcFiles,
  uploadFileArrayBuffer,
} from "../../../src/trimble/coreApiClient";

/*
A FetchPlan is an ordered list of `(matcher, handler)` pairs. The mock returns
the first handler whose matcher accepts the URL. This keeps each test's
expectations declarative and easy to read without needing a global request
counter.
*/
interface FetchCall {
  url: string;
  init: RequestInit | undefined;
}

interface FetchPlanEntry {
  matcher: (url: string, init: RequestInit | undefined) => boolean;
  handler: (call: FetchCall) => Response | Promise<Response>;
}

function installPlannedFetch(plan: ReadonlyArray<FetchPlanEntry>): FetchCall[] {
  const calls: FetchCall[] = [];
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : String(input);
    const call: FetchCall = { url, init };
    calls.push(call);

    const match = plan.find((entry) => entry.matcher(url, init));
    if (!match) {
      throw new Error(`Unexpected fetch in test: ${url}`);
    }
    return match.handler(call);
  });

  vi.stubGlobal("fetch", mock);
  return calls;
}

function jsonResponse(body: unknown, init: ResponseInit = { status: 200 }): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "Content-Type": "application/json", ...(init.headers ?? {}) },
  });
}

function arrayBufferResponse(buf: ArrayBuffer, init: ResponseInit = { status: 200 }): Response {
  return new Response(buf, init);
}

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isIfcFileName", () => {
  it("returns true for a .ifc extension", () => {
    expect(isIfcFileName("foo.ifc")).toBe(true);
    expect(isIfcFileName("FOO.IFC")).toBe(true);
    expect(isIfcFileName("path/to/Building.ifc")).toBe(true);
  });

  it("returns false for non-IFC extensions", () => {
    expect(isIfcFileName("foo.txt")).toBe(false);
    expect(isIfcFileName("foo")).toBe(false);
  });

  it("returns false for nullish or empty input", () => {
    expect(isIfcFileName(null)).toBe(false);
    expect(isIfcFileName("")).toBe(false);
    expect(isIfcFileName(undefined)).toBe(false);
  });
});

describe("listProjectIfcFiles — legacy folder traversal success", () => {
  it("uses the EU host first when the project location is 'europe', and returns only .ifc files sorted by path", async () => {
    const europeHost = "https://app21.connect.trimble.com/tc/api/2.0";

    const calls = installPlannedFetch([
      // Root folder listing on EU host: a "models" subfolder plus an unrelated .txt.
      {
        matcher: (url) => url === `${europeHost}/folders/root-folder-id/items?tokenThumburl=false`,
        handler: () =>
          jsonResponse({
            items: [
              { id: "models-id", name: "models", isFolder: true },
              { id: "schematics-id", name: "schematics", isFolder: true },
              { id: "file-skip", name: "notes.txt", versionId: "v-notes" },
            ],
          }),
      },
      // "models" subfolder: one IFC file.
      {
        matcher: (url) => url === `${europeHost}/folders/models-id/items?tokenThumburl=false`,
        handler: () =>
          jsonResponse({
            items: [
              { id: "file-models", name: "Building.ifc", versionId: "v-models" },
              { id: "file-skip-2", name: "readme.md", versionId: "v-md" },
            ],
          }),
      },
      // "schematics" subfolder: another IFC file. Insertion order puts this
      // after "models" but sorted by path it must come AFTER `models/...`
      // alphabetically too — both because m < s.
      {
        matcher: (url) => url === `${europeHost}/folders/schematics-id/items?tokenThumburl=false`,
        handler: () =>
          jsonResponse({
            items: [
              { id: "file-schematics", name: "Site.ifc", versionId: "v-schematics" },
            ],
          }),
      },
    ]);

    const result = await listProjectIfcFiles(
      "tok-1",
      "proj-1",
      "root-folder-id",
      "europe",
    );

    expect(result.coreApiBaseUrl).toBe(europeHost);
    expect(result.fileEntries).toEqual([
      {
        fileId: "file-models",
        folderId: "models-id",
        versionId: "v-models",
        name: "Building.ifc",
        path: "models",
      },
      {
        fileId: "file-schematics",
        folderId: "schematics-id",
        versionId: "v-schematics",
        name: "Site.ifc",
        path: "schematics",
      },
    ]);

    // Every call should be authenticated with the bearer token.
    for (const call of calls) {
      const headers = call.init?.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer tok-1");
    }
  });
});

describe("listProjectIfcFiles — v2.1 by-path fallback", () => {
  it("falls back when legacy traversal returns an empty list", async () => {
    const europeHost = "https://app21.connect.trimble.com/tc/api/2.0";
    const europeHostNoVersion = "https://app21.connect.trimble.com/tc/api";

    installPlannedFetch([
      // Legacy returns an empty folder.
      {
        matcher: (url) => url === `${europeHost}/folders/root-folder-id/items?tokenThumburl=false`,
        handler: () => jsonResponse({ items: [] }),
      },
      // v2.1 by-path returns one IFC file.
      {
        matcher: (url) =>
          url ===
          `${europeHostNoVersion}/2.1/folders/by_path?projectId=proj-1&path=&pageSize=500`,
        handler: () =>
          jsonResponse({
            items: [
              {
                id: "file-from-path",
                name: "Site.ifc",
                versionId: "v-1",
                parentId: "parent-folder",
              },
            ],
          }),
      },
    ]);

    const result = await listProjectIfcFiles("tok", "proj-1", "root-folder-id", "europe");

    expect(result.coreApiBaseUrl).toBe(europeHost);
    expect(result.fileEntries).toEqual([
      {
        fileId: "file-from-path",
        folderId: "parent-folder",
        versionId: "v-1",
        name: "Site.ifc",
        path: "",
      },
    ]);
  });

  it("follows pagination links that stay on the same origin", async () => {
    const europeHost = "https://app21.connect.trimble.com/tc/api/2.0";
    const europeHostNoVersion = "https://app21.connect.trimble.com/tc/api";

    installPlannedFetch([
      {
        matcher: (url) => url === `${europeHost}/folders/root-folder-id/items?tokenThumburl=false`,
        handler: () => jsonResponse({ items: [] }),
      },
      {
        matcher: (url) =>
          url ===
          `${europeHostNoVersion}/2.1/folders/by_path?projectId=proj-1&path=&pageSize=500`,
        handler: () =>
          jsonResponse({
            items: [
              { id: "file-one", name: "A.ifc", versionId: "v-1", parentId: "p" },
            ],
            links: {
              next: { href: `${europeHostNoVersion}/2.1/folders/by_path?cursor=next` },
            },
          }),
      },
      {
        matcher: (url) =>
          url === `${europeHostNoVersion}/2.1/folders/by_path?cursor=next`,
        handler: () =>
          jsonResponse({
            items: [
              { id: "file-two", name: "B.ifc", versionId: "v-2", parentId: "p" },
            ],
          }),
      },
    ]);

    const result = await listProjectIfcFiles("tok", "proj-1", "root-folder-id", "europe");
    expect(result.fileEntries.map((entry) => entry.fileId)).toEqual([
      "file-one",
      "file-two",
    ]);
  });

  it("rejects pagination links pointing at an unexpected origin", async () => {
    installPlannedFetch([
      // Legacy fails for every host (always returns 500).
      {
        matcher: (url) => /\/folders\/[^/]+\/items/.test(url),
        handler: () => jsonResponse({ message: "boom" }, { status: 500 }),
      },
      // by-path on any host returns a pagination link to an attacker host.
      // We match every by-path request because the host-fallback walks the
      // full candidate list once cross-origin pagination throws on EU.
      {
        matcher: (url) => url.includes("/2.1/folders/by_path"),
        handler: () =>
          jsonResponse({
            items: [
              { id: "file-one", name: "A.ifc", versionId: "v-1", parentId: "p" },
            ],
            links: {
              next: { href: "https://attacker.example.com/2.1/folders/by_path?cursor=next" },
            },
          }),
      },
    ]);

    await expect(
      listProjectIfcFiles("tok", "proj-1", "root-folder-id", "europe"),
    ).rejects.toThrow(/All Core API hosts failed/);
  });
});

describe("downloadIfcArrayBuffer", () => {
  it("requests a signed URL then downloads with credentials omitted", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";
    const signedUrl = "https://signed-storage.example.com/abc?token=xyz";
    const fileBytes = new TextEncoder().encode("ifc-bytes").buffer;

    const calls = installPlannedFetch([
      {
        matcher: (url) =>
          url === `${coreApiBaseUrl}/files/fs/file-1/downloadurl?versionId=v-1`,
        handler: () => jsonResponse({ url: signedUrl }),
      },
      {
        matcher: (url) => url === signedUrl,
        handler: () => arrayBufferResponse(fileBytes),
      },
    ]);

    const buffer = await downloadIfcArrayBuffer("tok", coreApiBaseUrl, "file-1", "v-1");
    expect(new Uint8Array(buffer)).toEqual(new Uint8Array(fileBytes));

    const signedCall = calls[1];
    expect(signedCall).toBeDefined();
    expect(signedCall?.init?.credentials).toBe("omit");
    // Signed download must not include the bearer token.
    const signedHeaders = (signedCall?.init?.headers ?? {}) as Record<string, string>;
    expect(signedHeaders.Authorization).toBeUndefined();
  });

  it("rejects non-HTTPS signed URLs", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";

    installPlannedFetch([
      {
        matcher: (url) =>
          url === `${coreApiBaseUrl}/files/fs/file-1/downloadurl?versionId=v-1`,
        handler: () => jsonResponse({ url: "ftp://evil.example.com/blob" }),
      },
    ]);

    await expect(
      downloadIfcArrayBuffer("tok", coreApiBaseUrl, "file-1", "v-1"),
    ).rejects.toThrow(/IFC download signed URL must use HTTPS/);
  });

  it("throws when file id or version id is missing", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";
    await expect(
      downloadIfcArrayBuffer("tok", coreApiBaseUrl, "", "v-1"),
    ).rejects.toThrow(/File ID and version ID are required/);
  });
});

describe("uploadFileArrayBuffer — three-phase upload", () => {
  it("posts initiate, PUTs bytes, posts commit, and returns identifiers", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";
    const signedUploadUrl = "https://signed-storage.example.com/put?token=abc";
    const bytes = new TextEncoder().encode("svg-content").buffer;

    const calls = installPlannedFetch([
      {
        matcher: (url, init) =>
          url === `${coreApiBaseUrl}/files/fs/initiate` && init?.method === "POST",
        handler: () =>
          jsonResponse({
            uploadId: "upload-id-1",
            uploadURL: signedUploadUrl,
          }),
      },
      {
        matcher: (url, init) => url === signedUploadUrl && init?.method === "PUT",
        handler: () => new Response(null, { status: 200 }),
      },
      {
        matcher: (url, init) =>
          url === `${coreApiBaseUrl}/files/fs/commit` && init?.method === "POST",
        handler: () =>
          jsonResponse({ id: "file-final-id", versionId: "v-final" }),
      },
    ]);

    const result = await uploadFileArrayBuffer("tok-up", coreApiBaseUrl, {
      folderId: "folder-1",
      fileName: "plan.svg",
      contentType: "image/svg+xml",
      content: bytes,
    });

    expect(result).toEqual({
      fileId: "file-final-id",
      versionId: "v-final",
      uploadId: "upload-id-1",
    });

    // initiate request body.
    const initiateCall = calls[0];
    expect(initiateCall).toBeDefined();
    const initiateBody = JSON.parse(String(initiateCall?.init?.body)) as Record<
      string,
      unknown
    >;
    expect(initiateBody).toEqual({
      parentId: "folder-1",
      parentType: "FOLDER",
      name: "plan.svg",
    });

    // PUT uses the provided content type, no auth header, and credentials: "omit".
    const putCall = calls[1];
    expect(putCall).toBeDefined();
    expect(putCall?.init?.credentials).toBe("omit");
    const putHeaders = (putCall?.init?.headers ?? {}) as Record<string, string>;
    expect(putHeaders["Content-Type"]).toBe("image/svg+xml");
    expect(putHeaders.Authorization).toBeUndefined();

    // commit request body.
    const commitCall = calls[2];
    expect(commitCall).toBeDefined();
    const commitBody = JSON.parse(String(commitCall?.init?.body)) as Record<string, unknown>;
    expect(commitBody).toEqual({ uploadId: "upload-id-1" });
  });

  it("defaults content-type to application/octet-stream when not provided", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";
    const signedUploadUrl = "https://signed-storage.example.com/put";
    const bytes = new TextEncoder().encode("{}").buffer;

    const calls = installPlannedFetch([
      {
        matcher: (url) => url === `${coreApiBaseUrl}/files/fs/initiate`,
        handler: () => jsonResponse({ uploadId: "u-1", uploadURL: signedUploadUrl }),
      },
      {
        matcher: (url) => url === signedUploadUrl,
        handler: () => new Response(null, { status: 200 }),
      },
      {
        matcher: (url) => url === `${coreApiBaseUrl}/files/fs/commit`,
        handler: () => jsonResponse({ id: "f-1", versionId: "v-1" }),
      },
    ]);

    await uploadFileArrayBuffer("tok", coreApiBaseUrl, {
      folderId: "folder-1",
      fileName: "data.json",
      content: bytes,
    });

    const putCall = calls[1];
    const putHeaders = (putCall?.init?.headers ?? {}) as Record<string, string>;
    expect(putHeaders["Content-Type"]).toBe("application/octet-stream");
  });

  it("accepts Uint8Array content (TypedArray view)", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";
    const signedUploadUrl = "https://signed-storage.example.com/put";

    installPlannedFetch([
      {
        matcher: (url) => url === `${coreApiBaseUrl}/files/fs/initiate`,
        handler: () => jsonResponse({ uploadId: "u-1", uploadURL: signedUploadUrl }),
      },
      {
        matcher: (url) => url === signedUploadUrl,
        handler: () => new Response(null, { status: 200 }),
      },
      {
        matcher: (url) => url === `${coreApiBaseUrl}/files/fs/commit`,
        handler: () => jsonResponse({ id: "f-1", versionId: "v-1" }),
      },
    ]);

    const result = await uploadFileArrayBuffer("tok", coreApiBaseUrl, {
      folderId: "folder-1",
      fileName: "data.json",
      content: new Uint8Array([1, 2, 3, 4]),
    });

    expect(result.fileId).toBe("f-1");
  });

  it("rejects when required folder/fileName are missing", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";
    const bytes = new ArrayBuffer(0);

    await expect(
      uploadFileArrayBuffer("tok", coreApiBaseUrl, {
        folderId: "",
        fileName: "x.json",
        content: bytes,
      }),
    ).rejects.toThrow(/folder ID and file name/);
  });

  it("throws when initiation response omits uploadId or upload URL", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";
    const bytes = new ArrayBuffer(4);

    installPlannedFetch([
      {
        matcher: (url) => url === `${coreApiBaseUrl}/files/fs/initiate`,
        handler: () => jsonResponse({ uploadId: "u-1" }),
      },
    ]);

    await expect(
      uploadFileArrayBuffer("tok", coreApiBaseUrl, {
        folderId: "f-1",
        fileName: "data.json",
        content: bytes,
      }),
    ).rejects.toThrow(/missing uploadId or upload URL/);
  });

  it("sends If-Match header when a currentVersionId is provided", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";
    const signedUploadUrl = "https://signed-storage.example.com/put";
    const bytes = new ArrayBuffer(4);

    const calls = installPlannedFetch([
      {
        matcher: (url) => url === `${coreApiBaseUrl}/files/fs/initiate`,
        handler: () => jsonResponse({ uploadId: "u-1", uploadURL: signedUploadUrl }),
      },
      {
        matcher: (url) => url === signedUploadUrl,
        handler: () => new Response(null, { status: 200 }),
      },
      {
        matcher: (url) => url === `${coreApiBaseUrl}/files/fs/commit`,
        handler: () => jsonResponse({ id: "f-1", versionId: "v-1" }),
      },
    ]);

    await uploadFileArrayBuffer("tok", coreApiBaseUrl, {
      folderId: "folder-1",
      fileName: "plan.svg",
      content: bytes,
      currentVersionId: "v-existing",
    });

    const initiateCall = calls[0];
    const initiateHeaders = (initiateCall?.init?.headers ?? {}) as Record<string, string>;
    expect(initiateHeaders["If-Match"]).toBe("v-existing");
  });

  it("raises a mismatch error when commit returns an unexpected file id", async () => {
    const coreApiBaseUrl = "https://app21.connect.trimble.com/tc/api/2.0";
    const signedUploadUrl = "https://signed-storage.example.com/put";
    const bytes = new ArrayBuffer(4);

    installPlannedFetch([
      {
        matcher: (url) => url === `${coreApiBaseUrl}/files/fs/initiate`,
        handler: () => jsonResponse({ uploadId: "u-1", uploadURL: signedUploadUrl }),
      },
      {
        matcher: (url) => url === signedUploadUrl,
        handler: () => new Response(null, { status: 200 }),
      },
      {
        matcher: (url) => url === `${coreApiBaseUrl}/files/fs/commit`,
        handler: () =>
          jsonResponse({ id: "different-file-id", versionId: "v-final" }),
      },
    ]);

    await expect(
      uploadFileArrayBuffer("tok", coreApiBaseUrl, {
        folderId: "folder-1",
        fileName: "plan.svg",
        content: bytes,
        expectedFileId: "expected-file-id",
      }),
    ).rejects.toThrow(/unexpected file/);
  });
});
