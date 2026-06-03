import {
  downloadFileArrayBuffer,
  findOrCreateProjectFolder,
  listProjectFolderItems,
  resolveProjectRootFolderId,
  type FolderListing,
} from "../trimble/coreApiClient";
import { storeyDocumentSchema } from "../generator/schema";
import type { StoreyDocument } from "../types";
import { FLOORPLAN_OUTPUT_FOLDER_NAME } from "./uploadToTrimble";
import { devLog } from "../utils/devLog";

/**
 * Listing entry for the "Saved floorplans" UI. Holds the JSON file the user
 * picks to re-open, plus the matching SVG (when one is present) so a future
 * implementation can warn about out-of-sync pairs.
 */
export interface SavedFloorplanEntry {
  jsonFileId: string;
  jsonVersionId: string;
  jsonName: string;
  /** Matching SVG file, when one with the corresponding base name exists. */
  svgFileId: string | null;
  svgVersionId: string | null;
}

export interface SavedFloorplansListing {
  folderId: string;
  entries: SavedFloorplanEntry[];
}

/**
 * Return every saved floorplan in the active project. JSON files in the
 * `siteplan2d` folder are the source of truth — each one is one
 * row in the listing.
 *
 * The folder is auto-created on first call so the panel always opens to a
 * predictable state (even when no upload has happened yet).
 */
export async function listSavedFloorplans(
  accessToken: string,
  coreApiBaseUrl: string,
  projectRootFolderId: string,
  projectId: string,
): Promise<SavedFloorplansListing> {
  // Re-resolve the root via /projects/{id} so the siteplan2d
  // folder consistently sits at the project root, even when the
  // workspace API didn't surface `rootFolderId` (then the caller has
  // fallen back to the IFC's folder).
  const rootFolderId = await resolveProjectRootFolderId(
    accessToken,
    coreApiBaseUrl,
    projectId,
    projectRootFolderId || null,
  );
  devLog(
    `[sitePlan2D] listSavedFloorplans: project=${projectId} root=${rootFolderId}`,
  );
  const folder = await findOrCreateProjectFolder(
    accessToken,
    coreApiBaseUrl,
    rootFolderId,
    FLOORPLAN_OUTPUT_FOLDER_NAME,
    projectId,
  );
  devLog(
    `[sitePlan2D] listSavedFloorplans: folder ${FLOORPLAN_OUTPUT_FOLDER_NAME} -> ${folder.folderId} (${folder.created ? "created" : "existing"})`,
  );
  const listing = await listProjectFolderItems(accessToken, coreApiBaseUrl, folder.folderId);
  const entries = zipMatchingPairs(listing);
  devLog(
    `[sitePlan2D] listSavedFloorplans: ${listing.files.length} file(s), ${entries.length} json/svg pair(s)`,
  );
  return { folderId: folder.folderId, entries };
}

/**
 * Hard size cap on JSON we ingest. A 25 MB floorplan JSON is already very
 * large (tens of thousands of objects); anything bigger is treated as a
 * pathological or malicious input and refused before parsing. This blocks
 * the "give the parser an enormous nested object" DoS class without
 * relying on the engine's call-stack to give up gracefully.
 */
const MAX_SAVED_FLOORPLAN_BYTES = 25 * 1024 * 1024;

/**
 * Download and validate one saved floorplan. The JSON is parsed against the
 * `StoreyDocument` zod schema so the rest of the app can trust its shape.
 *
 * Throws a typed error message (not the raw zod issue) on validation
 * failure — callers surface this to the user via the status bar.
 */
export async function downloadSavedFloorplan(
  accessToken: string,
  coreApiBaseUrl: string,
  entry: SavedFloorplanEntry,
): Promise<StoreyDocument> {
  const buffer = await downloadFileArrayBuffer(
    accessToken,
    coreApiBaseUrl,
    entry.jsonFileId,
    entry.jsonVersionId,
  );
  if (buffer.byteLength > MAX_SAVED_FLOORPLAN_BYTES) {
    throw new Error(
      `Saved floorplan JSON exceeds maximum allowed size (${buffer.byteLength} > ${MAX_SAVED_FLOORPLAN_BYTES} bytes).`,
    );
  }
  const text = new TextDecoder("utf-8").decode(buffer);
  let rawJson: unknown;
  try {
    rawJson = JSON.parse(text);
  } catch (parseError) {
    throw new Error(
      `Saved floorplan ${entry.jsonName} is not valid JSON: ${(parseError as Error).message}`,
    );
  }
  const parsed = storeyDocumentSchema.safeParse(rawJson);
  if (!parsed.success) {
    throw new Error(
      `Saved floorplan ${entry.jsonName} failed schema validation: ${parsed.error.issues[0]?.message ?? "unknown reason"}`,
    );
  }
  return parsed.data as StoreyDocument;
}

/**
 * Pair every .json file with its sibling .svg (matching base name). Files
 * that don't have a sibling are still listed; the SVG fields are then null.
 */
function zipMatchingPairs(listing: FolderListing): SavedFloorplanEntry[] {
  const svgByBase = new Map<string, { fileId: string; versionId: string }>();
  for (const file of listing.files) {
    if (file.name.toLowerCase().endsWith(".svg")) {
      svgByBase.set(file.name.slice(0, -4).toLowerCase(), { fileId: file.fileId, versionId: file.versionId });
    }
  }
  const entries: SavedFloorplanEntry[] = [];
  for (const file of listing.files) {
    if (!file.name.toLowerCase().endsWith(".json")) continue;
    const base = file.name.slice(0, -5).toLowerCase();
    const svg = svgByBase.get(base);
    entries.push({
      jsonFileId: file.fileId,
      jsonVersionId: file.versionId,
      jsonName: file.name,
      svgFileId: svg?.fileId ?? null,
      svgVersionId: svg?.versionId ?? null,
    });
  }
  return entries;
}
