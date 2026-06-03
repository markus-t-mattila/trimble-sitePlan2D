import { useEffect } from "react";
import { useFloorplanStore } from "../state/floorplanStore";
import { listProjectIfcFiles } from "../trimble/coreApiClient";
import { useTranslations } from "../i18n";

/**
 * Lists every IFC file in the active Trimble Connect project and lets the
 * user pick the one to parse. The list is loaded once the access token and
 * project context become available, and reloaded whenever either changes.
 *
 * Implemented as a single-select ARIA listbox so assistive technologies
 * announce items as "selectable" rather than as toggle buttons.
 */
export function FileBrowser(): JSX.Element {
  const t = useTranslations();
  const accessToken = useFloorplanStore((s) => s.accessToken);
  const project = useFloorplanStore((s) => s.project);
  const ifcFiles = useFloorplanStore((s) => s.ifcFiles);
  const selectedFile = useFloorplanStore((s) => s.selectedFile);
  const setIfcFiles = useFloorplanStore((s) => s.setIfcFiles);
  const setSelectedFile = useFloorplanStore((s) => s.setSelectedFile);
  const setCoreApiBaseUrl = useFloorplanStore((s) => s.setCoreApiBaseUrl);

  useEffect(() => {
    if (!accessToken || !project) return;
    let cancelled = false;
    async function loadFiles(): Promise<void> {
      if (!accessToken || !project) return;
      const result = await listProjectIfcFiles(
        accessToken,
        project.id,
        project.rootFolderId,
        project.location,
      );
      if (cancelled) return;
      setIfcFiles(result.fileEntries);
      setCoreApiBaseUrl(result.coreApiBaseUrl);
    }
    void loadFiles();
    return () => {
      cancelled = true;
    };
  }, [accessToken, project, setIfcFiles, setCoreApiBaseUrl]);

  return (
    <section className="section" aria-labelledby="file-browser-title">
      <h2 id="file-browser-title" className="section__title">
        {t.fileBrowser.title}
      </h2>
      {!project ? (
        <p className="section__hint">{t.fileBrowser.noProject}</p>
      ) : ifcFiles.length === 0 ? (
        <p className="section__hint">{t.fileBrowser.empty}</p>
      ) : (
        <ul className="list" role="listbox" aria-labelledby="file-browser-title">
          {ifcFiles.map((file) => (
            <li key={`${file.fileId}:${file.versionId}`} role="presentation">
              <button
                type="button"
                role="option"
                className="list-item"
                aria-selected={selectedFile?.fileId === file.fileId}
                onClick={() => setSelectedFile(file)}
              >
                <span className="list-item__primary">{file.name}</span>
                <span className="list-item__secondary">{file.path}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
