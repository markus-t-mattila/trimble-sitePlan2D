/*
Trimble Connect Core API client ported from
`/Users/mattilam/trimble-mass-editor/app/api/coreApiClient.js`.

The reference module was IFC-specific in its upload helper. We generalize the
three-phase upload to accept arbitrary binary content (SVG, JSON, etc.) because
this extension uploads more than just IFC. The list/download helpers keep their
IFC filter and IFC-only download contract.
*/

import type { IfcFileEntry } from "../types";
import {
  asRecord,
  encodePathSegment,
  getProp,
  isNonEmptyString,
  normalizeToOptionalString,
  pickFirstNonEmptyString,
  toErrorMessage,
} from "./internal";

/**
 * Static Core API host fallback list. Order matters: the workspace's own
 * location is tried first (via `orderCoreApiCandidatesByProjectLocation`), then
 * we cycle through these in the order they appear.
 */
export const CORE_API_BASE_URL_CANDIDATES: ReadonlyArray<string> = [
  "https://app.connect.trimble.com/tc/api/2.0",
  "https://app21.connect.trimble.com/tc/api/2.0",
  "https://app31.connect.trimble.com/tc/api/2.0",
  "https://app32.connect.trimble.com/tc/api/2.0",
];

const LOCATION_TO_CORE_API_BASE_URL: Readonly<Record<string, string>> = {
  northamerica: "https://app.connect.trimble.com/tc/api/2.0",
  northamerican: "https://app.connect.trimble.com/tc/api/2.0",
  america: "https://app.connect.trimble.com/tc/api/2.0",
  us: "https://app.connect.trimble.com/tc/api/2.0",
  europe: "https://app21.connect.trimble.com/tc/api/2.0",
  eu: "https://app21.connect.trimble.com/tc/api/2.0",
  asia: "https://app31.connect.trimble.com/tc/api/2.0",
  apac: "https://app31.connect.trimble.com/tc/api/2.0",
  australia: "https://app32.connect.trimble.com/tc/api/2.0",
  anz: "https://app32.connect.trimble.com/tc/api/2.0",
};

const DEFAULT_INITIATE_UPLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_COMMIT_UPLOAD_TIMEOUT_MS = 30_000;
const DEFAULT_UPLOAD_TIMEOUT_MIN_MS = 180_000;
const DEFAULT_UPLOAD_TIMEOUT_MAX_MS = 2_700_000;
const DEFAULT_UPLOAD_TIMEOUT_BASE_MS = 60_000;
const DEFAULT_UPLOAD_TIMEOUT_PER_MIB_MS = 2_000;

/*
============================================================================
Public types
============================================================================
*/

/** Result of a project-wide IFC listing call. */
export interface ListProjectIfcFilesResult {
  fileEntries: IfcFileEntry[];
  coreApiBaseUrl: string;
}

/** Optional per-phase timeout overrides for the three-phase upload. */
export interface UploadTimeouts {
  initiateMs?: number;
  binaryUploadMs?: number;
  commitMs?: number;
}

/** Generalized upload input — accepts any content type, not just IFC. */
export interface UploadFileInput {
  folderId: string;
  fileName: string;
  /**
   * MIME type for the pre-signed PUT request. Defaults to
   * `application/octet-stream`, which is appropriate for binary uploads such
   * as `.svg`, `.json`, or `.ifc`.
   */
  contentType?: string;
  /** Optional ETag/version id to send as `If-Match` on the initiate request. */
  currentVersionId?: string;
  /**
   * When provided, a successful upload is validated to land on this file id.
   * Mismatch raises an error so we never silently write to the wrong target.
   */
  expectedFileId?: string;
  content: ArrayBuffer | ArrayBufferView;
  timeouts?: UploadTimeouts;
}

/** Result of a successful three-phase upload. */
export interface UploadFileResult {
  fileId: string | null;
  versionId: string | null;
  uploadId: string;
}

/*
============================================================================
Module-local types for Core API payloads
============================================================================
*/

/** Minimal shape of a folder-items API entry (file or folder). */
interface CoreFolderItem {
  id?: unknown;
  fileId?: unknown;
  folderId?: unknown;
  name?: unknown;
  title?: unknown;
  type?: unknown;
  objectType?: unknown;
  isFolder?: unknown;
  folder?: unknown;
  versionId?: unknown;
  latestVersionId?: unknown;
  fileVersionId?: unknown;
  parentId?: unknown;
  parent?: unknown;
}

/** Minimal shape of the initiate-upload response. */
interface InitiateUploadResponse {
  uploadId?: unknown;
  uploadURL?: unknown;
  uploadUrl?: unknown;
  url?: unknown;
  contents?: ReadonlyArray<{
    format?: unknown;
    uploadURL?: unknown;
    uploadUrl?: unknown;
    url?: unknown;
  }>;
}

/** Working entry shape used while traversing folders. */
interface CollectedFileEntry {
  fileId: string;
  folderId: string;
  versionId: string;
  name: string;
  path: string;
}

/** Error subclass tag attached to fetch timeouts. */
interface RequestTimeoutError extends Error {
  code: "REQUEST_TIMEOUT";
}

/*
============================================================================
Public functions
============================================================================
*/

/**
 * List every `.ifc` file entry in the project, using a Core API host whose
 * region matches the project when possible. Falls back through the static
 * candidate list and tries the v2.1 by-path endpoint when legacy folder
 * traversal returns nothing.
 */
export async function listProjectIfcFiles(
  accessToken: string,
  projectId: string,
  preferredRootFolderId: string | null,
  projectLocation: string | null = "",
): Promise<ListProjectIfcFilesResult> {
  return withCoreApiHostFallback(async (coreApiBaseUrl) => {
    let fileEntries: CollectedFileEntry[] = [];
    let legacyApiError: unknown = null;
    let pathApiError: unknown = null;

    try {
      const rootFolderId = await resolveRootFolderId(
        coreApiBaseUrl,
        accessToken,
        projectId,
        preferredRootFolderId,
      );
      fileEntries = await collectProjectFileEntries(
        coreApiBaseUrl,
        accessToken,
        rootFolderId,
      );
    } catch (errorFromLegacyApi) {
      legacyApiError = errorFromLegacyApi;
    }

    if (fileEntries.length === 0) {
      try {
        fileEntries = await collectProjectFileEntriesViaPathApi(
          coreApiBaseUrl,
          accessToken,
          projectId,
        );
      } catch (errorFromPathApi) {
        pathApiError = errorFromPathApi;
      }
    }

    if (fileEntries.length === 0 && legacyApiError && pathApiError) {
      throw new Error(
        `Legacy folder listing failed (${toErrorMessage(legacyApiError)}), and v2.1 by-path listing failed (${toErrorMessage(pathApiError)}).`,
      );
    }

    if (fileEntries.length === 0 && legacyApiError && !pathApiError) {
      throw legacyApiError;
    }

    const ifcEntries: IfcFileEntry[] = fileEntries
      .filter((fileEntry) => isIfcFileName(fileEntry.name))
      .sort((leftEntry, rightEntry) => {
        const leftPath = `${leftEntry.path || ""}/${leftEntry.name || ""}`.toLowerCase();
        const rightPath = `${rightEntry.path || ""}/${rightEntry.name || ""}`.toLowerCase();
        return leftPath.localeCompare(rightPath, "en", { sensitivity: "base" });
      });

    return {
      fileEntries: ifcEntries,
      coreApiBaseUrl,
    };
  }, projectLocation ?? "");
}

/**
 * Download one file from Core API using the signed-URL workflow:
 * `GET /files/fs/{fileId}/downloadurl?versionId=...` followed by a credentials-less
 * `GET <signedUrl>`.
 */
export async function downloadIfcArrayBuffer(
  accessToken: string,
  coreApiBaseUrl: string,
  fileId: string,
  versionId: string,
): Promise<ArrayBuffer> {
  const normalizedFileId = normalizeToOptionalString(fileId);
  const normalizedVersionId = normalizeToOptionalString(versionId);
  if (!normalizedFileId || !normalizedVersionId) {
    throw new Error("File ID and version ID are required for IFC download.");
  }

  const signedUrlEndpoint =
    `${coreApiBaseUrl}/files/fs/${encodePathSegment(normalizedFileId)}/downloadurl` +
    `?versionId=${encodePathSegment(normalizedVersionId)}`;
  const signedUrlPayload = await getJsonWithToken(signedUrlEndpoint, accessToken);
  const signedUrlPayloadRecord = asRecord(signedUrlPayload);
  const signedUrl = normalizeToOptionalString(
    signedUrlPayloadRecord["url"] ?? signedUrlPayloadRecord["downloadUrl"],
  );

  if (!signedUrl) {
    throw new Error("Core API did not return signed download URL.");
  }

  const trustedSignedUrl = assertSecureTransferUrl(signedUrl, "IFC download signed URL");
  const downloadResponse = await fetch(trustedSignedUrl, {
    method: "GET",
    credentials: "omit",
  });

  if (!downloadResponse.ok) {
    throw new Error(`Signed IFC download failed with status ${downloadResponse.status}.`);
  }

  return downloadResponse.arrayBuffer();
}

/**
 * Three-phase upload of arbitrary binary content into the project.
 *
 * Phases:
 * 1. `POST /files/fs/initiate` — register the upload and receive a pre-signed PUT URL.
 * 2. `PUT <signedUrl>` — send the binary payload directly to storage.
 * 3. `POST /files/fs/commit` — finalize and receive `{ fileId, versionId }`.
 *
 * Generalized from the reference IFC-only helper so callers can upload any
 * file (SVG, JSON, IFC). Content-type defaults to `application/octet-stream`.
 */
export async function uploadFileArrayBuffer(
  accessToken: string,
  coreApiBaseUrl: string,
  uploadInput: UploadFileInput,
): Promise<UploadFileResult> {
  const folderId = normalizeToOptionalString(uploadInput.folderId);
  const fileName = normalizeToOptionalString(uploadInput.fileName);
  const currentVersionId = normalizeToOptionalString(uploadInput.currentVersionId);
  const expectedFileId = normalizeToOptionalString(uploadInput.expectedFileId);
  const contentType = normalizeToOptionalString(uploadInput.contentType) ?? "application/octet-stream";
  const contentPayload = uploadInput.content;
  const timeoutOverrides = uploadInput.timeouts ?? {};

  const uploadBinaryPayload: ArrayBuffer | ArrayBufferView | null =
    contentPayload instanceof ArrayBuffer
      ? contentPayload
      : ArrayBuffer.isView(contentPayload)
        ? contentPayload
        : null;

  if (!folderId || !fileName) {
    throw new Error("Upload requires folder ID and file name.");
  }

  if (!uploadBinaryPayload) {
    throw new Error("Upload content must be ArrayBuffer or TypedArray.");
  }

  const initiateTimeoutMs = normalizePositiveTimeoutMs(
    timeoutOverrides.initiateMs,
    DEFAULT_INITIATE_UPLOAD_TIMEOUT_MS,
  );
  const binaryUploadTimeoutMs = normalizePositiveTimeoutMs(
    timeoutOverrides.binaryUploadMs,
    estimateBinaryUploadTimeoutMs(uploadBinaryPayload),
  );
  const commitTimeoutMs = normalizePositiveTimeoutMs(
    timeoutOverrides.commitMs,
    DEFAULT_COMMIT_UPLOAD_TIMEOUT_MS,
  );

  // Phase 1: initiate.
  const initiateEndpoint = `${coreApiBaseUrl}/files/fs/initiate`;
  const initiateHeaders: Record<string, string> = buildAuthHeaders(accessToken, {
    "Content-Type": "application/json",
  });
  if (currentVersionId) {
    initiateHeaders["If-Match"] = currentVersionId;
  }

  const initiateResponse = await fetchWithTimeout(
    initiateEndpoint,
    {
      method: "POST",
      headers: initiateHeaders,
      body: JSON.stringify({
        parentId: folderId,
        parentType: "FOLDER",
        name: fileName,
      }),
    },
    initiateTimeoutMs,
    "File upload initiation request",
  );

  if (!initiateResponse.ok) {
    const errorPayload = await safeReadJson(initiateResponse);
    throw new Error(
      `File upload initiation failed (${initiateResponse.status}): ${toErrorMessage(errorPayload, "Unable to initiate upload")}.`,
    );
  }

  const initiatePayload = (await initiateResponse.json()) as InitiateUploadResponse;
  const uploadId = normalizeToOptionalString(initiatePayload.uploadId);
  const uploadUrl = pickUploadUrlFromInitiatePayload(initiatePayload);

  if (!uploadId || !uploadUrl) {
    throw new Error("Upload initiation response is missing uploadId or upload URL.");
  }
  const trustedUploadUrl = assertSecureTransferUrl(uploadUrl, "File upload signed URL");

  // Phase 2: PUT bytes to signed URL.
  let uploadBinaryResponse: Response | null = null;
  let binaryUploadTimedOut = false;

  try {
    uploadBinaryResponse = await fetchWithTimeout(
      trustedUploadUrl,
      {
        method: "PUT",
        headers: {
          "Content-Type": contentType,
        },
        credentials: "omit",
        body: uploadBinaryPayload as BodyInit,
      },
      binaryUploadTimeoutMs,
      "File binary upload request",
    );
  } catch (uploadBinaryError) {
    if (isRequestTimeoutError(uploadBinaryError)) {
      /*
      Some real-world browser/network combinations time the PUT out client-side
      even though server-side storage already accepted the bytes. In that case
      we still try the commit once so the workflow can complete.
      */
      binaryUploadTimedOut = true;
    } else {
      throw uploadBinaryError;
    }
  }

  if (uploadBinaryResponse && !uploadBinaryResponse.ok) {
    throw new Error(`Uploading file bytes failed with status ${uploadBinaryResponse.status}.`);
  }

  // Phase 3: commit.
  const commitEndpoint = `${coreApiBaseUrl}/files/fs/commit`;
  let commitResponse: Response;
  try {
    commitResponse = await commitUpload(accessToken, commitEndpoint, uploadId, commitTimeoutMs);
  } catch (commitError) {
    if (binaryUploadTimedOut) {
      throw new Error(
        `File upload confirmation failed after binary upload timeout. Upload may still have completed on server. ${toErrorMessage(commitError)}.`,
      );
    }
    throw commitError;
  }

  const commitPayload = asRecord(await safeReadJson(commitResponse));
  const commitData = asRecord(commitPayload["data"]);
  const completedFileId = pickFirstNonEmptyString([
    commitPayload["id"],
    commitPayload["fileId"],
    commitData["id"],
  ]);
  const completedVersionId = pickFirstNonEmptyString([
    commitPayload["versionId"],
    commitPayload["latestVersionId"],
    commitData["versionId"],
    commitData["latestVersionId"],
  ]);

  if (expectedFileId && completedFileId && expectedFileId !== completedFileId) {
    throw new Error(
      `Upload completed to an unexpected file (${completedFileId}) instead of selected file (${expectedFileId}).`,
    );
  }

  return {
    fileId: completedFileId,
    versionId: completedVersionId,
    uploadId,
  };
}

/**
 * Check whether a file name points at IFC data based on its extension.
 */
export function isIfcFileName(fileName: unknown): boolean {
  const normalizedFileName = normalizeToOptionalString(fileName);
  return Boolean(normalizedFileName && normalizedFileName.toLowerCase().endsWith(".ifc"));
}

/**
 * Generic file download. Works for any file in a Trimble Connect project, not
 * just IFC — re-uses the same signed-URL flow as `downloadIfcArrayBuffer`.
 */
export async function downloadFileArrayBuffer(
  accessToken: string,
  coreApiBaseUrl: string,
  fileId: string,
  versionId: string,
): Promise<ArrayBuffer> {
  return downloadIfcArrayBuffer(accessToken, coreApiBaseUrl, fileId, versionId);
}

export interface FolderListing {
  /** Files (not folders) directly inside the queried folder. */
  files: Array<{ fileId: string; versionId: string; name: string; folderId: string }>;
}

/**
 * Enumerate the direct children of `folderId`. Sub-folders are skipped; only
 * concrete files (with a resolvable `fileId` + `versionId`) are returned.
 */
export async function listProjectFolderItems(
  accessToken: string,
  coreApiBaseUrl: string,
  folderId: string,
): Promise<FolderListing> {
  const normalized = normalizeToOptionalString(folderId);
  if (!normalized) {
    throw new Error("listProjectFolderItems requires a non-empty folder id.");
  }
  const rawItems = await listFolderItems(coreApiBaseUrl, accessToken, normalized);
  const files: FolderListing["files"] = [];
  for (const item of rawItems) {
    if (looksLikeFolderItem(item)) continue;
    const fileId = pickFirstNonEmptyString([item.fileId, item.id]);
    const versionId = pickFirstNonEmptyString([
      item.versionId,
      item.latestVersionId,
      item.fileVersionId,
    ]);
    const name = pickFirstNonEmptyString([item.name, item.title]);
    if (!fileId || !versionId || !name) continue;
    files.push({ fileId, versionId, name, folderId: normalized });
  }
  files.sort((a, b) => a.name.localeCompare(b.name, "en", { sensitivity: "base" }));
  return { files };
}

/**
 * Find a direct sub-folder of `parentFolderId` whose name matches `folderName`
 * (case-insensitive), and create it when missing. The created folder is a
 * sibling of the existing project folders rather than a deeply nested one — we
 * only ever inspect one level so the operation is fast even on large
 * projects.
 *
 * @param accessToken         OAuth bearer token
 * @param coreApiBaseUrl      Core API host that the caller already validated
 * @param parentFolderId      Trimble Connect folder under which we look/create
 * @param folderName          Target folder name (e.g. "siteplan2d")
 * @returns                   The matching folder's id and a flag indicating
 *                            whether the call created it.
 */
export async function findOrCreateProjectFolder(
  accessToken: string,
  coreApiBaseUrl: string,
  parentFolderId: string,
  folderName: string,
  projectId?: string,
): Promise<{ folderId: string; created: boolean }> {
  const normalizedParent = normalizeToOptionalString(parentFolderId);
  const normalizedName = normalizeToOptionalString(folderName);
  const normalizedProjectId = normalizeToOptionalString(projectId);
  if (!normalizedParent || !normalizedName) {
    throw new Error("findOrCreateProjectFolder requires both parentFolderId and folderName.");
  }

  const matched = await findFolderInParent(coreApiBaseUrl, accessToken, normalizedParent, normalizedName);
  if (matched) return { folderId: matched, created: false };

  const createEndpoint = `${coreApiBaseUrl}/folders`;
  const headers = buildAuthHeaders(accessToken, { "Content-Type": "application/json" });
  // Trimble Core API v2.0 folder-create body shape — verified against the
  // working trimble-sitedrive integration. The endpoint requires `name`
  // and `parentId`, but reliably succeeds (and returns a usable id) only
  // when `projectId` AND `rootId` are also present. Earlier minimal bodies
  // (`{ parentId, name }` or `{ parentId, parentType, name }`) returned
  // 400/422 with no useful diagnostic — folder silently never appeared.
  //
  // `parentId` and `rootId` are the same value here (we always create one
  // level deep under the project root); we send both so the request matches
  // the shape Trimble's own apps emit.
  const body: Record<string, string> = {
    name: normalizedName,
    parentId: normalizedParent,
    rootId: normalizedParent,
  };
  if (normalizedProjectId) body["projectId"] = normalizedProjectId;
  const createBody = JSON.stringify(body);

  const createResponse = await fetchWithTimeout(
    createEndpoint,
    {
      method: "POST",
      headers,
      body: createBody,
    },
    DEFAULT_INITIATE_UPLOAD_TIMEOUT_MS,
    "Folder creation request",
  );

  if (createResponse.status === 409) {
    // The 409 path is reached when our listing missed the folder (rare —
    // pagination edge case or a folder that was just created by a sibling
    // tab). The 409 body itself rarely contains the id, so we re-list and
    // pick up the matching folder by name. Mirrors the sitedrive fallback.
    const fallback = await findFolderInParent(coreApiBaseUrl, accessToken, normalizedParent, normalizedName);
    if (fallback) return { folderId: fallback, created: false };
  }

  if (!createResponse.ok) {
    const rawText = await safeReadResponseText(createResponse);
    throw new Error(
      `Folder creation failed (${createResponse.status} ${createResponse.statusText || ""}). ` +
        `Endpoint: ${createEndpoint}. Body: ${createBody}. Response: ${rawText.slice(0, 500)}`,
    );
  }
  const createdPayload = asRecord(await safeReadJson(createResponse));
  const createdData = asRecord(createdPayload["data"]);
  const createdFolderId = pickFirstNonEmptyString([
    createdPayload["id"],
    createdPayload["folderId"],
    createdData["id"],
    createdData["folderId"],
  ]);
  if (!createdFolderId) {
    // Some Core API versions return 200/201 with the new id only inside
    // `Location` header. Fall back to listing once more if the JSON body
    // didn't carry the id — we know the folder exists because the POST
    // succeeded.
    const refound = await findFolderInParent(coreApiBaseUrl, accessToken, normalizedParent, normalizedName);
    if (refound) return { folderId: refound, created: true };
    throw new Error("Folder creation response is missing the new folder id.");
  }
  return { folderId: createdFolderId, created: true };
}

/**
 * List the direct children of `parentFolderId` and return the id of the
 * first folder whose name matches `folderName` (case-insensitive). Returns
 * null if no match — used both as the pre-create probe and as the 409
 * fallback so they can't drift apart.
 */
async function findFolderInParent(
  coreApiBaseUrl: string,
  accessToken: string,
  parentFolderId: string,
  folderName: string,
): Promise<string | null> {
  const existingItems = await listFolderItems(coreApiBaseUrl, accessToken, parentFolderId);
  const target = folderName.toLowerCase();
  for (const item of existingItems) {
    if (!looksLikeFolderItem(item)) continue;
    const itemName = pickFirstNonEmptyString([item.name, item.title]);
    if (!itemName) continue;
    if (itemName.toLowerCase() !== target) continue;
    const id = pickFirstNonEmptyString([item.id, item.folderId]);
    if (id) return id;
  }
  return null;
}

/**
 * Heuristic: classify a folder-items entry as a folder rather than a file. We
 * inspect every field Trimble Connect is known to use across Core API
 * versions and the legacy endpoint.
 */
function looksLikeFolderItem(item: CoreFolderItem): boolean {
  if (item.folder === true) return true;
  if (item.isFolder === true) return true;
  const type = normalizeToOptionalString(item.type) ?? normalizeToOptionalString(item.objectType);
  if (type && type.toUpperCase() === "FOLDER") return true;
  if (item.folderId && !item.fileId) return true;
  return false;
}

/*
============================================================================
Helpers — folder traversal
============================================================================
*/

/**
 * Module-scoped cache for project-root resolutions. Keyed by
 * `{coreApiBaseUrl}|{projectId}` so two parallel tabs / parallel saves
 * on different projects don't collide. Trimble Connect's project root
 * never changes during a session, so a one-shot fetch per project is
 * safe; refreshing the page clears the cache.
 */
const projectRootFolderIdCache = new Map<string, string>();

/**
 * Resolve the project's true root folder id, prefering the Core API over
 * anything the Workspace surfaced. Save flows call this before creating
 * the `siteplan2d` folder so the create unambiguously targets
 * the project root.
 *
 * Why we don't trust the Workspace-supplied id: Workspace exposes a value
 * via `extension.getCurrentProject().rootFolderId`, but in practice
 * `Toolbar.tsx` also falls back to `selectedFile.folderId` when Workspace
 * is silent. That fallback is a SUB-folder (the IFC's parent), not the
 * root — using it as `parentId`/`rootId` in `POST /folders` either
 * 4xx's or lands the output folder one level too deep. The cure is to
 * always pull the real root from `GET /projects/{id}` (the same call
 * trimble-sitedrive's `getRootFolderId` makes) and only fall back to
 * the workspace value when Core API is unreachable.
 */
export async function resolveProjectRootFolderId(
  accessToken: string,
  coreApiBaseUrl: string,
  projectId: string,
  preferredRootFolderId: string | null,
): Promise<string> {
  const normalizedProjectId = normalizeToOptionalString(projectId);
  if (!normalizedProjectId) {
    throw new Error("resolveProjectRootFolderId requires a non-empty projectId.");
  }
  const cacheKey = `${coreApiBaseUrl}|${normalizedProjectId}`;
  const cached = projectRootFolderIdCache.get(cacheKey);
  if (cached) return cached;

  try {
    const projectEndpoint = `${coreApiBaseUrl}/projects/${encodePathSegment(normalizedProjectId)}`;
    const projectPayload = await getJsonWithToken(projectEndpoint, accessToken);
    const fromCore = extractRootFolderIdCandidate(projectPayload);
    if (fromCore) {
      projectRootFolderIdCache.set(cacheKey, fromCore);
      return fromCore;
    }
  } catch {
    // Network/permission failure — fall through to the preferred value.
  }

  const preferred = normalizeToOptionalString(preferredRootFolderId);
  if (preferred) {
    projectRootFolderIdCache.set(cacheKey, preferred);
    return preferred;
  }

  // Last-resort fallback matches the upstream mass-editor traversal seed.
  projectRootFolderIdCache.set(cacheKey, normalizedProjectId);
  return normalizedProjectId;
}

/**
 * Test hook. The cache hides intermittent /projects/{id} responses from
 * subsequent calls, which makes assertions about Core API calls fragile.
 * Exposed only to tests so we don't have to swap the cache shape itself.
 */
export function __resetProjectRootFolderIdCacheForTests(): void {
  projectRootFolderIdCache.clear();
}

/**
 * Resolve the root folder id for traversal, preferring the Workspace-supplied
 * value and falling back to the project metadata endpoint and finally the
 * project id itself.
 */
async function resolveRootFolderId(
  coreApiBaseUrl: string,
  accessToken: string,
  projectId: string,
  preferredRootFolderId: string | null,
): Promise<string> {
  const preferredFolderId = normalizeToOptionalString(preferredRootFolderId);
  if (preferredFolderId) {
    return preferredFolderId;
  }

  try {
    const projectEndpoint = `${coreApiBaseUrl}/projects/${encodePathSegment(projectId)}`;
    const projectPayload = await getJsonWithToken(projectEndpoint, accessToken);
    const fallbackFolderId = extractRootFolderIdCandidate(projectPayload);
    if (fallbackFolderId) {
      return fallbackFolderId;
    }
  } catch {
    /*
    The previous working implementation used the project id as a deterministic
    last-resort folder traversal seed when the project metadata endpoint was
    unavailable. We preserve that fallback.
    */
  }

  return projectId;
}

/**
 * Probe a project payload for every known root-folder-id field. Returns the
 * first non-empty candidate.
 */
function extractRootFolderIdCandidate(projectPayload: unknown): string | null {
  const root = asRecord(projectPayload);
  const project = asRecord(root["project"]);
  const data = asRecord(root["data"]);

  return pickFirstNonEmptyString([
    root["rootFolderId"],
    getProp(root["rootFolder"], "id"),
    root["rootId"],
    root["folderId"],
    root["defaultFolderId"],
    root["projectFolderId"],
    getProp(root["root"], "id"),
    project["rootFolderId"],
    getProp(project["rootFolder"], "id"),
    project["rootId"],
    project["defaultFolderId"],
    project["projectFolderId"],
    data["folderId"],
    data["rootFolderId"],
    getProp(data["rootFolder"], "id"),
    data["rootId"],
    data["defaultFolderId"],
    data["projectFolderId"],
  ]);
}

/**
 * Breadth-first traversal of the legacy `/folders/{id}/items` endpoint.
 */
async function collectProjectFileEntries(
  coreApiBaseUrl: string,
  accessToken: string,
  rootFolderId: string,
): Promise<CollectedFileEntry[]> {
  const visitedFolderIds = new Set<string>();
  const folderQueue: Array<{ folderId: string; parentPath: string }> = [
    { folderId: rootFolderId, parentPath: "" },
  ];
  const fileEntries: CollectedFileEntry[] = [];

  while (folderQueue.length > 0) {
    const queueItem = folderQueue.shift();
    if (!queueItem || !isNonEmptyString(queueItem.folderId)) {
      continue;
    }

    if (visitedFolderIds.has(queueItem.folderId)) {
      continue;
    }
    visitedFolderIds.add(queueItem.folderId);

    const folderItems = await listFolderItems(
      coreApiBaseUrl,
      accessToken,
      queueItem.folderId,
    );

    for (const rawItem of folderItems) {
      const itemId = pickFirstNonEmptyString([
        rawItem.id,
        rawItem.fileId,
        rawItem.folderId,
      ]);
      const itemName =
        pickFirstNonEmptyString([rawItem.name, rawItem.title]) ?? "Unnamed";
      const itemPath = queueItem.parentPath
        ? `${queueItem.parentPath}/${itemName}`
        : itemName;

      if (isFolderItem(rawItem)) {
        if (itemId) {
          folderQueue.push({
            folderId: itemId,
            parentPath: itemPath,
          });
        }
        continue;
      }

      const versionId = pickFirstNonEmptyString([
        rawItem.versionId,
        rawItem.latestVersionId,
        rawItem.fileVersionId,
      ]);

      fileEntries.push({
        fileId: itemId ?? `${queueItem.folderId}:${itemName}`,
        folderId: queueItem.folderId,
        versionId: versionId ?? "",
        name: itemName,
        path: queueItem.parentPath,
      });
    }
  }

  return fileEntries;
}

/**
 * Breadth-first traversal of the v2.1 by-path endpoint, used as fallback when
 * the legacy endpoint is unavailable in a project environment.
 */
async function collectProjectFileEntriesViaPathApi(
  coreApiBaseUrl: string,
  accessToken: string,
  projectId: string,
): Promise<CollectedFileEntry[]> {
  const visitedPaths = new Set<string>();
  const pathQueue: string[] = [""];
  const fileEntries: CollectedFileEntry[] = [];

  while (pathQueue.length > 0) {
    const currentPath = pathQueue.shift() ?? "";
    if (visitedPaths.has(currentPath)) {
      continue;
    }
    visitedPaths.add(currentPath);

    const folderItems = await listFolderItemsByPath(
      coreApiBaseUrl,
      accessToken,
      projectId,
      currentPath,
    );

    for (const rawItem of folderItems) {
      const itemName =
        pickFirstNonEmptyString([rawItem.name, rawItem.title]) ?? "Unnamed";
      const itemId = pickFirstNonEmptyString([
        rawItem.id,
        rawItem.fileId,
        rawItem.folderId,
      ]);

      if (isFolderItem(rawItem)) {
        const childPath = currentPath ? `${currentPath}/${itemName}` : itemName;
        pathQueue.push(childPath);
        continue;
      }

      const versionId = pickFirstNonEmptyString([
        rawItem.versionId,
        rawItem.latestVersionId,
        rawItem.fileVersionId,
      ]);

      fileEntries.push({
        fileId: itemId ?? `${currentPath}:${itemName}`,
        folderId:
          pickFirstNonEmptyString([
            rawItem.parentId,
            rawItem.folderId,
            getProp(rawItem.parent, "id"),
          ]) ?? "",
        versionId: versionId ?? "",
        name: itemName,
        path: currentPath,
      });
    }
  }

  return fileEntries;
}

/**
 * List one folder's direct children via the legacy endpoint.
 */
async function listFolderItems(
  coreApiBaseUrl: string,
  accessToken: string,
  folderId: string,
): Promise<CoreFolderItem[]> {
  const folderEndpoint = `${coreApiBaseUrl}/folders/${encodePathSegment(folderId)}/items?tokenThumburl=false`;
  const folderPayload = await getJsonWithToken(folderEndpoint, accessToken);
  return extractFolderItemsFromPayload(folderPayload);
}

/**
 * List folder contents through the v2.1 by-path endpoint with pagination
 * follow-up. Pagination links are validated against the originally-discovered
 * Core API origin so a malformed or tampered payload can't redirect
 * authenticated requests to an arbitrary host.
 */
async function listFolderItemsByPath(
  coreApiBaseUrl: string,
  accessToken: string,
  projectId: string,
  folderPath: string,
): Promise<CoreFolderItem[]> {
  const normalizedPath = folderPath || "";
  const coreApiBaseWithoutVersion = coreApiBaseUrl.replace("/2.0", "");
  let nextUrl: string | null =
    `${coreApiBaseWithoutVersion}/2.1/folders/by_path` +
    `?projectId=${encodePathSegment(projectId)}` +
    `&path=${encodeURIComponent(normalizedPath)}` +
    `&pageSize=500`;
  const collectedItems: CoreFolderItem[] = [];

  while (nextUrl) {
    const payload = await getJsonWithToken(nextUrl, accessToken);
    collectedItems.push(...extractFolderItemsFromPayload(payload));

    const links = asRecord(getProp(payload, "links"));
    const nextHref = normalizeToOptionalString(getProp(links["next"], "href"));
    if (!nextHref) {
      break;
    }

    nextUrl = resolveTrustedPaginationUrl(coreApiBaseWithoutVersion, nextHref);
  }

  return collectedItems;
}

/**
 * Resolve and validate a pagination link so authenticated requests never
 * follow unexpected origins.
 */
function resolveTrustedPaginationUrl(
  coreApiBaseWithoutVersion: string,
  paginationHref: string,
): string {
  const normalizedBaseUrl = normalizeToOptionalString(coreApiBaseWithoutVersion);
  const normalizedPaginationHref = normalizeToOptionalString(paginationHref);
  if (!normalizedBaseUrl || !normalizedPaginationHref) {
    throw new Error("Pagination URL resolution requires base URL and href.");
  }

  const baseUrlObject = new URL(normalizedBaseUrl);
  const baseForRelativeUrls = normalizedBaseUrl.endsWith("/")
    ? normalizedBaseUrl
    : `${normalizedBaseUrl}/`;
  const resolvedPaginationUrl = new URL(normalizedPaginationHref, baseForRelativeUrls);

  if (resolvedPaginationUrl.origin !== baseUrlObject.origin) {
    throw new Error(
      `Rejected pagination link to unexpected origin '${resolvedPaginationUrl.origin}'. Expected '${baseUrlObject.origin}'.`,
    );
  }

  if (!isSecureHttpUrl(resolvedPaginationUrl)) {
    throw new Error(
      `Rejected pagination link with insecure protocol '${resolvedPaginationUrl.protocol}'.`,
    );
  }

  return resolvedPaginationUrl.toString();
}

/**
 * Extract a folder-items array from one of several known API payload shapes.
 */
function extractFolderItemsFromPayload(folderPayload: unknown): CoreFolderItem[] {
  if (Array.isArray(folderPayload)) {
    return folderPayload as CoreFolderItem[];
  }

  const folderRecord = asRecord(folderPayload);
  if (Array.isArray(folderRecord["items"])) {
    return folderRecord["items"] as CoreFolderItem[];
  }

  const folderData = asRecord(folderRecord["data"]);
  if (Array.isArray(folderData["items"])) {
    return folderData["items"] as CoreFolderItem[];
  }

  return [];
}

/*
============================================================================
Helpers — host fallback
============================================================================
*/

/**
 * Try the same operation against ordered Core API host candidates until one
 * succeeds. Errors from earlier hosts are joined into the final failure
 * message so diagnostics are not lost.
 */
async function withCoreApiHostFallback<TResult>(
  runner: (coreApiBaseUrl: string) => Promise<TResult>,
  projectLocation: string = "",
): Promise<TResult> {
  const errors: string[] = [];
  const orderedCoreApiCandidates = orderCoreApiCandidatesByProjectLocation(projectLocation);

  for (const coreApiBaseUrl of orderedCoreApiCandidates) {
    try {
      return await runner(coreApiBaseUrl);
    } catch (operationError) {
      errors.push(`${coreApiBaseUrl}: ${toErrorMessage(operationError)}`);
    }
  }

  throw new Error(`All Core API hosts failed. ${errors.join(" | ")}`);
}

/**
 * Order Core API host candidates so the project's own region is attempted
 * first, the browser-host-derived API base second, and the static fallback
 * list afterwards. Duplicates are de-duplicated while preserving order.
 */
function orderCoreApiCandidatesByProjectLocation(projectLocation: string): string[] {
  const orderedCandidates: string[] = [];
  const seenCandidates = new Set<string>();

  const coreApiBaseUrlFromWindowHost = deriveCoreApiBaseUrlFromCurrentWindowHost();
  pushUniqueCoreApiCandidate(orderedCandidates, seenCandidates, coreApiBaseUrlFromWindowHost);

  const normalizedLocationKey = normalizeLocationKey(projectLocation);
  const preferredCoreApiBaseUrl = LOCATION_TO_CORE_API_BASE_URL[normalizedLocationKey] ?? "";
  pushUniqueCoreApiCandidate(orderedCandidates, seenCandidates, preferredCoreApiBaseUrl);

  for (const coreApiBaseUrl of CORE_API_BASE_URL_CANDIDATES) {
    pushUniqueCoreApiCandidate(orderedCandidates, seenCandidates, coreApiBaseUrl);
  }

  return orderedCandidates;
}

function normalizeLocationKey(locationValue: unknown): string {
  const normalizedValue = normalizeToOptionalString(locationValue)?.toLowerCase() ?? "";
  return normalizedValue.replaceAll(" ", "").replaceAll("-", "").replaceAll("_", "");
}

function deriveCoreApiBaseUrlFromCurrentWindowHost(): string {
  if (typeof window === "undefined") {
    return "";
  }

  const hostname = window.location?.hostname ?? "";
  const currentHostName = String(hostname).toLowerCase();
  if (!currentHostName) {
    return "";
  }

  if (currentHostName.startsWith("web.")) {
    const derivedAppHostName = currentHostName.replace(/^web\./, "app.");
    return `https://${derivedAppHostName}/tc/api/2.0`;
  }

  if (currentHostName.startsWith("app.")) {
    return `https://${currentHostName}/tc/api/2.0`;
  }

  return "";
}

function pushUniqueCoreApiCandidate(
  orderedCandidates: string[],
  seenCandidates: Set<string>,
  candidateUrl: string,
): void {
  const normalizedCandidateUrl = normalizeToOptionalString(candidateUrl);
  if (!normalizedCandidateUrl || seenCandidates.has(normalizedCandidateUrl)) {
    return;
  }

  seenCandidates.add(normalizedCandidateUrl);
  orderedCandidates.push(normalizedCandidateUrl);
}

/*
============================================================================
Helpers — upload bookkeeping
============================================================================
*/

/**
 * Commit an uploaded file with one timeout-aware retry so a transient commit
 * response stall does not leave the UI hanging after the bytes already
 * transferred successfully.
 */
async function commitUpload(
  accessToken: string,
  commitEndpoint: string,
  uploadId: string,
  commitTimeoutMs: number,
): Promise<Response> {
  const maxCommitAttempts = 2;
  let lastCommitError: unknown = null;

  for (let commitAttemptIndex = 0; commitAttemptIndex < maxCommitAttempts; commitAttemptIndex += 1) {
    try {
      const commitResponse = await fetchWithTimeout(
        commitEndpoint,
        {
          method: "POST",
          headers: buildAuthHeaders(accessToken, {
            "Content-Type": "application/json",
          }),
          body: JSON.stringify({ uploadId }),
        },
        commitTimeoutMs,
        "File upload commit request",
      );

      if (!commitResponse.ok) {
        const errorPayload = await safeReadJson(commitResponse);
        throw new Error(
          `File upload commit failed (${commitResponse.status}): ${toErrorMessage(errorPayload, "Unable to commit upload")}.`,
        );
      }

      return commitResponse;
    } catch (commitError) {
      lastCommitError = commitError;
      const shouldRetryTimeoutError =
        isRequestTimeoutError(commitError) && commitAttemptIndex < maxCommitAttempts - 1;
      if (shouldRetryTimeoutError) {
        continue;
      }
      throw commitError;
    }
  }

  throw lastCommitError instanceof Error
    ? lastCommitError
    : new Error("File upload commit failed for unknown reason.");
}

/**
 * Pick an upload URL from the initiate-upload payload across known response
 * variants — the modern shape exposes `uploadURL` at the top level; older
 * shapes nest it inside `contents[].uploadURL` / `contents[].url`.
 */
function pickUploadUrlFromInitiatePayload(
  initiatePayload: InitiateUploadResponse,
): string | null {
  const contentItems = Array.isArray(initiatePayload.contents) ? initiatePayload.contents : [];
  const sourceUploadContent = contentItems.find((contentItem) => {
    const normalizedFormat = normalizeToOptionalString(contentItem.format)?.toUpperCase() ?? "";
    return normalizedFormat === "" || normalizedFormat === "SOURCE";
  });
  const fallbackUploadContent = contentItems[0] ?? null;

  return pickFirstNonEmptyString([
    initiatePayload.uploadURL,
    initiatePayload.uploadUrl,
    sourceUploadContent?.uploadURL,
    sourceUploadContent?.uploadUrl,
    sourceUploadContent?.url,
    fallbackUploadContent?.uploadURL,
    fallbackUploadContent?.uploadUrl,
    fallbackUploadContent?.url,
    initiatePayload.url,
  ]);
}

/**
 * Estimate a sensible signed-PUT timeout based on payload size: connection
 * overhead + a per-MiB transfer budget, clamped to predictable min/max bounds.
 */
function estimateBinaryUploadTimeoutMs(binaryPayload: ArrayBuffer | ArrayBufferView): number {
  const payloadByteLength = extractBinaryPayloadByteLength(binaryPayload);
  const payloadSizeMiB = payloadByteLength > 0 ? payloadByteLength / (1024 * 1024) : 0;
  const transferBudgetMs = Math.ceil(payloadSizeMiB * DEFAULT_UPLOAD_TIMEOUT_PER_MIB_MS);
  const estimatedTimeoutMs = DEFAULT_UPLOAD_TIMEOUT_BASE_MS + transferBudgetMs;

  return Math.max(
    DEFAULT_UPLOAD_TIMEOUT_MIN_MS,
    Math.min(DEFAULT_UPLOAD_TIMEOUT_MAX_MS, estimatedTimeoutMs),
  );
}

function extractBinaryPayloadByteLength(binaryPayload: ArrayBuffer | ArrayBufferView): number {
  if (binaryPayload instanceof ArrayBuffer) {
    return binaryPayload.byteLength;
  }
  if (ArrayBuffer.isView(binaryPayload)) {
    return binaryPayload.byteLength;
  }
  return 0;
}

function normalizePositiveTimeoutMs(
  timeoutCandidate: unknown,
  fallbackTimeoutMs: number,
): number {
  const parsedTimeout = Number(timeoutCandidate);
  if (Number.isFinite(parsedTimeout) && parsedTimeout > 0) {
    return Math.round(parsedTimeout);
  }
  return Math.max(1, Math.round(Number(fallbackTimeoutMs) || 1));
}

/*
============================================================================
Helpers — networking
============================================================================
*/

/**
 * Wrap fetch with an `AbortController` timeout. Aborts triggered by the
 * timeout are converted into clear phase-specific errors tagged with
 * `code = "REQUEST_TIMEOUT"` so callers can decide whether to retry.
 */
async function fetchWithTimeout(
  requestUrl: string,
  requestOptions: RequestInit,
  timeoutMs: number,
  operationLabel: string,
): Promise<Response> {
  const normalizedTimeoutMs = normalizePositiveTimeoutMs(timeoutMs, 1);
  const normalizedOperationLabel = normalizeToOptionalString(operationLabel) ?? "Network request";

  if (typeof AbortController !== "function") {
    return fetch(requestUrl, requestOptions);
  }

  const requestAbortController = new AbortController();
  let timeoutTriggered = false;
  const timeoutId = setTimeout(() => {
    timeoutTriggered = true;
    requestAbortController.abort();
  }, normalizedTimeoutMs);

  try {
    return await fetch(requestUrl, {
      ...requestOptions,
      signal: requestAbortController.signal,
    });
  } catch (requestError) {
    if (
      timeoutTriggered ||
      (requestAbortController.signal.aborted && isAbortError(requestError))
    ) {
      throw createRequestTimeoutError(normalizedOperationLabel, normalizedTimeoutMs);
    }
    throw requestError;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAbortError(errorCandidate: unknown): boolean {
  const name = getProp(errorCandidate, "name");
  return normalizeToOptionalString(name) === "AbortError";
}

function createRequestTimeoutError(operationLabel: string, timeoutMs: number): RequestTimeoutError {
  const timeoutSeconds = Math.max(1, Math.round(Number(timeoutMs) / 1000));
  const timeoutError = new Error(
    `${operationLabel} timed out after ${timeoutSeconds} second(s).`,
  ) as RequestTimeoutError;
  timeoutError.code = "REQUEST_TIMEOUT";
  return timeoutError;
}

function isRequestTimeoutError(errorCandidate: unknown): boolean {
  return normalizeToOptionalString(getProp(errorCandidate, "code")) === "REQUEST_TIMEOUT";
}

async function getJsonWithToken(
  endpointUrl: string,
  accessToken: string,
): Promise<unknown> {
  const response = await fetch(endpointUrl, {
    method: "GET",
    headers: buildAuthHeaders(accessToken),
  });

  if (!response.ok) {
    const errorPayload = await safeReadJson(response);
    throw new Error(
      `Request failed (${response.status}) at ${endpointUrl}: ${toErrorMessage(errorPayload)}.`,
    );
  }

  return response.json();
}

function buildAuthHeaders(
  accessToken: string,
  extraHeaders: Record<string, string> = {},
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    ...extraHeaders,
  };
}

function isFolderItem(rawItem: CoreFolderItem | null | undefined): boolean {
  if (!rawItem || typeof rawItem !== "object") {
    return false;
  }
  if (rawItem.isFolder === true || rawItem.folder === true) {
    return true;
  }
  const typeText = String(rawItem.type ?? rawItem.objectType ?? "").toLowerCase();
  return typeText.includes("folder") || typeText === "directory";
}

/**
 * Validate a signed transfer URL before issuing a binary download/upload.
 * Accepts https:// in production and http://localhost / 127.0.0.1 / [::1] for
 * local development.
 */
function assertSecureTransferUrl(urlCandidate: string, contextLabel: string): string {
  const normalizedUrlCandidate = normalizeToOptionalString(urlCandidate);
  if (!normalizedUrlCandidate) {
    throw new Error(`${contextLabel} is missing.`);
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(normalizedUrlCandidate);
  } catch {
    throw new Error(`${contextLabel} is not a valid URL.`);
  }

  if (!isSecureHttpUrl(parsedUrl)) {
    throw new Error(
      `${contextLabel} must use HTTPS (HTTP is allowed only for localhost development endpoints).`,
    );
  }

  return parsedUrl.toString();
}

function isSecureHttpUrl(parsedUrl: URL): boolean {
  if (!(parsedUrl instanceof URL)) {
    return false;
  }
  if (parsedUrl.protocol === "https:") {
    return true;
  }
  if (parsedUrl.protocol !== "http:") {
    return false;
  }
  return ["localhost", "127.0.0.1", "[::1]"].includes(parsedUrl.hostname);
}

async function safeReadJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Read a response body as text for diagnostic logging. Catches the
 * "body already read" error so the caller can chain this after a
 * `safeReadJson` attempt without losing the original error.
 */
async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return await response.clone().text();
  } catch {
    return "";
  }
}
