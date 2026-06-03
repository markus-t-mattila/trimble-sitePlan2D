import JSZip from "jszip";
import { buildStoreySvg } from "../generator/svgBuilder";
import type { StoreyDocument } from "../types";

const MAX_SLUG_LENGTH = 80;

export interface DownloadZipInput {
  ifcBaseName: string;
  documents: ReadonlyArray<StoreyDocument>;
}

/**
 * Bundle every storey document for one IFC into a single zip and trigger a
 * browser download. Each storey contributes one `.svg` + one `.json` with
 * matching filenames (slugified base + storey identifier), mirroring the
 * layout used by the Trimble Connect upload flow.
 *
 * No UI surface today: the in-app Save path uploads to Trimble Connect via
 * {@link uploadToTrimble} rather than producing a local download. This helper
 * is retained as a public export for scripted / programmatic use (the
 * `slugify` companion below is consumed by several callers); intentionally
 * unwired from the React tree.
 */
export async function downloadZip(input: DownloadZipInput): Promise<Blob> {
  const zip = new JSZip();
  for (const doc of input.documents) {
    const baseName = `${slugify(input.ifcBaseName)}-${slugify(doc.storey.name || `storey-${doc.storey.expressId}`)}`;
    zip.file(`${baseName}.svg`, buildStoreySvg(doc));
    zip.file(`${baseName}.json`, JSON.stringify(doc, null, 2));
  }
  const blob = await zip.generateAsync({ type: "blob" });
  triggerDownload(blob, `${slugify(input.ifcBaseName)}-floorplan.zip`);
  return blob;
}

function triggerDownload(blob: Blob, fileName: string): void {
  if (typeof document === "undefined") return;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/**
 * Normalise a string into a URL/filename-safe slug. Non-word characters
 * collapse to a single hyphen, leading/trailing hyphens are trimmed, and the
 * result is lowercased and length-capped so we never produce filenames the
 * Trimble Core API would reject.
 */
export function slugify(value: string): string {
  return value
    .trim()
    .replace(/[^\w\d\-_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase()
    .slice(0, MAX_SLUG_LENGTH);
}
