import { useCallback, useEffect, useState } from "react";
import { useFloorplanStore } from "../state/floorplanStore";
import { downloadSavedFloorplan, listSavedFloorplans, type SavedFloorplanEntry } from "../persistence/loadFromTrimble";
import { useTranslations } from "../i18n";

/**
 * Sidebar panel that lists every saved floorplan in the project's
 * `siteplan2d` folder and lets the user re-open one. Re-opening
 * loads the JSON into the same store the IFC flow uses, so the viewer,
 * annotator, and save flow all work without modification.
 */
export function SavedFloorplans(): JSX.Element | null {
  const t = useTranslations();
  const accessToken = useFloorplanStore((state) => state.accessToken);
  const coreApiBaseUrl = useFloorplanStore((state) => state.coreApiBaseUrl);
  const project = useFloorplanStore((state) => state.project);
  const setStatus = useFloorplanStore((state) => state.setStatus);
  const loadDocument = useFloorplanStore((state) => state.loadStoreyDocument);
  const setLoadedSource = useFloorplanStore((state) => state.setLoadedSource);
  const [entries, setEntries] = useState<SavedFloorplanEntry[] | null>(null);
  const [folderId, setFolderId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<void> => {
    // Only `project.id` is required — `rootFolderId` is resolved via
    // `GET /projects/{id}` inside listSavedFloorplans when the workspace
    // doesn't surface it (which is most of the time in practice). The
    // earlier gate that required workspace-supplied rootFolderId was
    // why Refresh silently did nothing for projects where Workspace
    // returned `null` for that field.
    if (!accessToken || !coreApiBaseUrl || !project?.id) return;
    setBusy(true);
    setError(null);
    try {
      const listing = await listSavedFloorplans(
        accessToken,
        coreApiBaseUrl,
        project.rootFolderId ?? "",
        project.id,
      );
      setEntries(listing.entries);
      setFolderId(listing.folderId);
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [accessToken, coreApiBaseUrl, project?.rootFolderId, project?.id]);

  // Auto-load once when both the token and the project context become known.
  useEffect(() => {
    if (entries !== null) return;
    if (!accessToken || !coreApiBaseUrl || !project?.id) return;
    void refresh();
  }, [accessToken, coreApiBaseUrl, entries, project?.id, refresh]);

  async function open(entry: SavedFloorplanEntry): Promise<void> {
    if (!accessToken || !coreApiBaseUrl) return;
    setBusy(true);
    setError(null);
    try {
      const doc = await downloadSavedFloorplan(accessToken, coreApiBaseUrl, entry);
      loadDocument(doc);
      // Tell the store where this came from so the Toolbar's Save can
      // overwrite the file directly (same fileId, new version) instead
      // of re-prompting for a name.
      setLoadedSource({
        folderId: folderId ?? "",
        jsonFileId: entry.jsonFileId,
        jsonName: entry.jsonName,
        svgFileId: entry.svgFileId,
      });
      setStatus(t.savedFloorplans.loaded);
    } catch (err) {
      console.error(err);
      setError(t.savedFloorplans.loadFailed);
    } finally {
      setBusy(false);
    }
  }

  if (!project) return null;
  return (
    <section className="section" aria-labelledby="saved-floorplans-title">
      <h2 id="saved-floorplans-title" className="section__title">
        {t.savedFloorplans.title}
      </h2>
      <div className="btn-row">
        <button type="button" className="btn btn--small" onClick={refresh} disabled={busy}>
          {t.savedFloorplans.refresh}
        </button>
      </div>
      {error ? <p className="field__hint status-error">{error}</p> : null}
      {entries === null ? (
        <p className="section__hint">{busy ? "…" : ""}</p>
      ) : entries.length === 0 ? (
        <p className="section__hint">{t.savedFloorplans.empty}</p>
      ) : (
        <ul className="list">
          {entries.map((entry) => (
            <li key={entry.jsonFileId}>
              <button
                type="button"
                className="list-item"
                disabled={busy}
                onClick={() => void open(entry)}
              >
                <span className="list-item__primary">{entry.jsonName}</span>
                <span className="list-item__secondary">
                  {entry.svgFileId ? t.savedFloorplans.bothFormats : t.savedFloorplans.jsonOnly}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
