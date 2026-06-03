import { useState } from "react";
import { useFloorplanStore } from "../state/floorplanStore";
import { useIfcLoader } from "../ifc/hooks";
import { useTranslations } from "../i18n";
import { SaveToTrimbleModal } from "./SaveToTrimbleModal";
import { uploadToTrimble } from "../persistence/uploadToTrimble";
import type { StoreyDocument } from "../types";

/**
 * Primary actions for the workflow:
 *   1. Generate floorplans from the loaded IFC + selected types.
 *   2. Save the resulting SVG + JSON pairs back to Trimble Connect.
 *
 * Only **one** action carries the primary visual weight at a time: Generate
 * before any documents exist, Save once they do. Pressing Save opens a
 * modal where the user picks which storeys to upload — defaulting to "all"
 * but allowing per-storey opt-out. The zip-download fallback was removed:
 * "data lives in TC; download from there when needed".
 */
export function Toolbar(): JSX.Element {
  const t = useTranslations();
  const accessToken = useFloorplanStore((state) => state.accessToken);
  const coreApiBaseUrl = useFloorplanStore((state) => state.coreApiBaseUrl);
  const project = useFloorplanStore((state) => state.project);
  const selectedFile = useFloorplanStore((state) => state.selectedFile);
  const selectedTypes = useFloorplanStore((state) => state.selectedTypes);
  const storeyDocuments = useFloorplanStore((state) => state.storeyDocuments);
  const cutHeight = useFloorplanStore((state) => state.cutHeightAboveStoreyMeters);
  const setStatus = useFloorplanStore((state) => state.setStatus);
  const dirty = useFloorplanStore((state) => state.dirty);
  const loadedSource = useFloorplanStore((state) => state.loadedSource);
  const markClean = useFloorplanStore((state) => state.markClean);
  const { generateFloorplans } = useIfcLoader();
  const [busy, setBusy] = useState(false);
  const [saveModalOpen, setSaveModalOpen] = useState(false);

  const documentCount = Object.keys(storeyDocuments).length;
  const hasDocuments = documentCount > 0;
  const ifcBaseName = resolveIfcBaseName(selectedFile?.name, storeyDocuments);
  const projectRootFolderId = project?.rootFolderId ?? selectedFile?.folderId ?? null;
  const projectId = project?.id ?? null;

  async function onGenerate(): Promise<void> {
    setBusy(true);
    try {
      await generateFloorplans(cutHeight);
    } catch (err) {
      console.error(err);
      setStatus(humanError(t.errors.parseFailed, err));
    } finally {
      setBusy(false);
    }
  }

  const generateLabel = hasDocuments ? t.entityPicker.regenerate : t.entityPicker.generate;
  const generateDisabled = busy || !selectedFile || selectedTypes.length === 0;
  // Save is meaningful only when there are documents AND something has
  // changed since the last load/save AND we have the network plumbing.
  // `projectRootFolderId` is intentionally NOT a gate any more — the
  // resolver inside uploadToTrimble fetches the project root via
  // /projects/{id}, so we'd be turning a soft-fallback into a hard
  // block by checking it here.
  const uploadDisabled = busy || !hasDocuments || !dirty || !accessToken || !coreApiBaseUrl || !projectId || !ifcBaseName;
  const directReSave = Boolean(loadedSource);

  async function onSave(): Promise<void> {
    // If the active document came from a saved file, write it back
    // directly — no modal, single click. Otherwise fall back to the
    // per-storey picker as before.
    if (!directReSave) {
      setSaveModalOpen(true);
      return;
    }
    if (!accessToken || !coreApiBaseUrl || !projectId || !ifcBaseName) return;
    setBusy(true);
    setStatus(t.status.uploading);
    try {
      await uploadToTrimble({
        accessToken,
        coreApiBaseUrl,
        projectRootFolderId: projectRootFolderId ?? "",
        projectId,
        ifcBaseName,
        documents: Object.values(storeyDocuments),
        onProgress: (fraction, fileName) =>
          setStatus(`${t.status.uploading} ${(fraction * 100).toFixed(0)}% ${fileName}`),
      });
      markClean();
      setStatus(t.status.saved);
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error ? err.message : "";
      setStatus(detail ? `${t.errors.uploadFailed} ${detail}` : t.errors.uploadFailed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="section" aria-labelledby="toolbar-title">
      <h2 id="toolbar-title" className="section__title">
        {hasDocuments ? t.persistence.title : t.entityPicker.generate}
      </h2>
      <div className="toolbar-actions">
        <button
          type="button"
          className={`btn${hasDocuments ? "" : " btn--primary"}`}
          onClick={onGenerate}
          disabled={generateDisabled}
        >
          {generateLabel}
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => { void onSave(); }}
          disabled={uploadDisabled}
        >
          {t.persistence.uploadButton}
        </button>
        {!hasDocuments ? <p className="field__hint">{t.persistence.nothingToSave}</p> : null}
      </div>
      {saveModalOpen && ifcBaseName && projectRootFolderId && projectId ? (
        <SaveToTrimbleModal
          ifcBaseName={ifcBaseName}
          projectRootFolderId={projectRootFolderId}
          projectId={projectId}
          documents={Object.values(storeyDocuments)}
          onClose={() => setSaveModalOpen(false)}
        />
      ) : null}
    </section>
  );
}

/**
 * Derive the IFC base name (file name without `.ifc`) used to compose the
 * output filenames. Prefers the currently selected file; falls back to the
 * `source.fileName` recorded in any already-loaded storey document so the
 * "Save" action still works after the user re-opened a saved floorplan.
 */
function resolveIfcBaseName(
  fileName: string | undefined,
  documents: Readonly<Record<number, StoreyDocument>>,
): string | null {
  if (fileName) return fileName.replace(/\.ifc$/i, "");
  for (const document of Object.values(documents)) {
    const sourceName = document.source.fileName;
    if (sourceName) return sourceName.replace(/\.ifc$/i, "");
  }
  return null;
}

/**
 * Compose a user-readable error message: the operation-specific prefix from
 * the translation table plus the actual error message (when present).
 */
function humanError(prefix: string, err: unknown): string {
  const detail = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return detail ? `${prefix} ${detail}` : prefix;
}
