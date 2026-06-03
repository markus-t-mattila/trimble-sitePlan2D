import { buildStoreySvg } from "../generator/svgBuilder";
import type { StoreyDocument } from "../types";
import { slugify } from "./downloadZip";
import { devLog } from "../utils/devLog";
import {
  findOrCreateProjectFolder,
  resolveProjectRootFolderId,
  uploadFileArrayBuffer,
} from "../trimble/coreApiClient";

/**
 * Dedicated project folder name where every floorplan output is written.
 * Defined here (rather than in the UI) so the contract is part of the public
 * persistence module — downstream tooling can mirror the folder layout.
 */
export const FLOORPLAN_OUTPUT_FOLDER_NAME = "siteplan2d";

export interface UploadToTrimbleInput {
  accessToken: string;
  coreApiBaseUrl: string;
  /** Root folder of the active project. We create the output folder under it. */
  projectRootFolderId: string;
  /**
   * Project id — required for the Core API folder-create body. Without it
   * Trimble rejects the POST with a 400/422 and no useful diagnostic, so
   * the user sees "save failed" with no folder appearing.
   */
  projectId: string;
  /** Name used for the source IFC, without `.ifc`. */
  ifcBaseName: string;
  /** Storey documents to upload — one SVG + one JSON each. */
  documents: ReadonlyArray<StoreyDocument>;
  /**
   * Optional per-storey filename suffix overrides. Keyed by
   * `storey.expressId`. When set, the file name becomes
   * `{ifcBaseName-slug}-{override}` (slug-base is always forced as the
   * prefix per the spec); the override itself is slugified for safety.
   * Storeys without an entry fall back to the default suffix
   * (slugified storey name, or `storey-{expressId}` when the IFC
   * didn't ship a human-readable name).
   */
  filenameSuffixOverrides?: Record<number, string>;
  /** Optional progress callback (fraction 0..1, current file name). */
  onProgress?: (fraction: number, currentFileName: string) => void;
}

export interface UploadToTrimbleResult {
  folderId: string;
  folderCreated: boolean;
  uploadedFiles: Array<{ name: string; fileId: string | null; versionId: string | null }>;
}

const textEncoder = new TextEncoder();

/**
 * Save the per-storey SVG + JSON outputs to the active project's
 * `siteplan2d` folder. The folder is created on first use; on
 * subsequent runs (with the same IFC) Trimble Connect adds new versions to
 * the existing files because their names match.
 *
 * Filename pattern: `{ifcBaseName}-{storeyNameOrIndex}.{svg|json}` — the
 * "storey number" fallback (e.g. `Building-storey-42.svg`) is used when the
 * IFC has no human-readable storey name. Per Trimble's auto-versioning
 * behaviour the same name uploaded twice produces version 1 / version 2 of
 * the same file rather than two separate files.
 */
export async function uploadToTrimble(input: UploadToTrimbleInput): Promise<UploadToTrimbleResult> {
  // Resolve the project's true root folder via the Core API before creating
  // anything. If the workspace API already surfaced `rootFolderId` (the
  // common path), the resolver is a no-op pass-through. If it didn't,
  // `projectRootFolderId` may point at the IFC's own folder, and creating
  // `siteplan2d` there would nest the output a level too deep.
  // Mirrors trimble-sitedrive's `getRootFolderId` cache behaviour.
  const rootFolderId = await resolveProjectRootFolderId(
    input.accessToken,
    input.coreApiBaseUrl,
    input.projectId,
    input.projectRootFolderId,
  );
  // Diagnostic logging: surfaces the resolved root + folder + per-file
  // results so a failed save in Trimble Connect is debuggable without a
  // network capture. Routed through `devLog` (gated on
  // `import.meta.env.DEV`) so production builds don't leak project
  // topology to anyone with the devtools open.
  devLog(
    `[sitePlan2D] uploadToTrimble: project=${input.projectId} root=${rootFolderId} docs=${input.documents.length}`,
  );

  const { folderId, created } = await findOrCreateProjectFolder(
    input.accessToken,
    input.coreApiBaseUrl,
    rootFolderId,
    FLOORPLAN_OUTPUT_FOLDER_NAME,
    input.projectId,
  );
  devLog(
    `[sitePlan2D] uploadToTrimble: folder ${FLOORPLAN_OUTPUT_FOLDER_NAME} -> ${folderId} (${created ? "created" : "existing"})`,
  );

  const outputs = buildOutputDescriptors(input.ifcBaseName, input.documents, input.filenameSuffixOverrides);
  const uploadedFiles: UploadToTrimbleResult["uploadedFiles"] = [];
  for (let index = 0; index < outputs.length; index += 1) {
    const item = outputs[index];
    if (!item) continue;
    input.onProgress?.(index / outputs.length, item.name);
    devLog(`[sitePlan2D] uploadToTrimble: uploading ${item.name} (${item.payload.byteLength} bytes)`);
    const result = await uploadFileArrayBuffer(input.accessToken, input.coreApiBaseUrl, {
      folderId,
      fileName: item.name,
      contentType: item.contentType,
      content: item.payload,
    });
    devLog(
      `[sitePlan2D] uploadToTrimble: uploaded ${item.name} -> fileId=${result.fileId ?? "?"} versionId=${result.versionId ?? "?"}`,
    );
    uploadedFiles.push({ name: item.name, fileId: result.fileId, versionId: result.versionId });
  }
  input.onProgress?.(1, "");
  return { folderId, folderCreated: created, uploadedFiles };
}

interface UploadDescriptor {
  name: string;
  payload: ArrayBuffer;
  contentType: string;
}

/**
 * Build the (filename, payload, content-type) tuples for one IFC's outputs.
 * Exposed for testing — the function is pure and depends only on its inputs.
 */
export function buildOutputDescriptors(
  ifcBaseName: string,
  documents: ReadonlyArray<StoreyDocument>,
  filenameSuffixOverrides: Record<number, string> = {},
): UploadDescriptor[] {
  const slugBase = slugify(ifcBaseName) || "ifc";
  const outputs: UploadDescriptor[] = [];
  for (const doc of documents) {
    const storeyToken = resolveStoreyToken(doc, filenameSuffixOverrides);
    const baseName = `${slugBase}-${storeyToken}`;
    const svgString = buildStoreySvg(doc);
    const jsonString = JSON.stringify(doc, null, 2);
    outputs.push({ name: `${baseName}.svg`, payload: stringToArrayBuffer(svgString), contentType: "image/svg+xml" });
    outputs.push({ name: `${baseName}.json`, payload: stringToArrayBuffer(jsonString), contentType: "application/json" });
  }
  return outputs;
}

/**
 * Resolve the suffix portion of a storey output filename. Order of
 * preference: user override → slugified storey name → `storey-{id}`
 * fallback. The override is slugified too so a free-text input can't
 * smuggle path separators or other unsafe characters into the filename.
 */
export function resolveStoreyToken(
  doc: StoreyDocument,
  filenameSuffixOverrides: Record<number, string> = {},
): string {
  const override = filenameSuffixOverrides[doc.storey.expressId];
  if (override) {
    const slugged = slugify(override);
    if (slugged) return slugged;
  }
  return defaultStoreyToken(doc);
}

/**
 * The default suffix used when the user hasn't supplied an override —
 * slugified storey name, or `storey-{expressId}` when the IFC didn't
 * carry a name. Exported so the Save modal can pre-populate its input
 * with exactly what would land on disk.
 */
export function defaultStoreyToken(doc: StoreyDocument): string {
  const fromName = slugify(doc.storey.name ?? "");
  if (fromName) return fromName;
  return `storey-${doc.storey.expressId}`;
}

function stringToArrayBuffer(value: string): ArrayBuffer {
  const view = textEncoder.encode(value);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength);
}
