import { useMemo, useState } from "react";
import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";
import { defaultStoreyToken, uploadToTrimble } from "../persistence/uploadToTrimble";
import { slugify } from "../persistence/downloadZip";
import type { StoreyDocument } from "../types";

interface SaveToTrimbleModalProps {
  ifcBaseName: string;
  projectRootFolderId: string;
  projectId: string;
  documents: ReadonlyArray<StoreyDocument>;
  onClose: () => void;
}

/**
 * Per-storey upload picker.
 *
 * Each storey that has a generated document is listed with a checkbox; only
 * the storeys the user ticks are uploaded. The list is pre-checked because
 * the most common case is "save everything"; supervisors tend to deselect
 * the storeys they don't want, not the other way round.
 *
 * Each `StoreyDocument` already carries only the user areas drawn on its
 * own storey (the store keys user areas by `expressId` — there is no
 * cross-storey leakage). The list below shows the count next to each row
 * so the user can see at a glance which storeys carry work / takt zones.
 */
export function SaveToTrimbleModal({
  ifcBaseName,
  projectRootFolderId,
  projectId,
  documents,
  onClose,
}: SaveToTrimbleModalProps): JSX.Element {
  const t = useTranslations();
  const accessToken = useFloorplanStore((state) => state.accessToken);
  const coreApiBaseUrl = useFloorplanStore((state) => state.coreApiBaseUrl);
  const setStatus = useFloorplanStore((state) => state.setStatus);
  const markClean = useFloorplanStore((state) => state.markClean);
  const ordered = useMemo(
    () => [...documents].sort((a, b) => a.storey.elevation - b.storey.elevation),
    [documents],
  );
  const [selectedIds, setSelectedIds] = useState<Set<number>>(() => new Set(ordered.map((doc) => doc.storey.expressId)));
  // Per-storey filename suffix overrides. Empty string OR missing entry
  // means "use the default" (slugified storey name). The IFC base name
  // is forced as the prefix downstream — the user only controls the
  // part after the model name.
  const [suffixOverrides, setSuffixOverrides] = useState<Record<number, string>>(() => {
    const seeded: Record<number, string> = {};
    for (const doc of ordered) seeded[doc.storey.expressId] = defaultStoreyToken(doc);
    return seeded;
  });
  const [busy, setBusy] = useState(false);

  const slugBase = useMemo(() => slugify(ifcBaseName) || "ifc", [ifcBaseName]);

  function toggle(expressId: number, on: boolean): void {
    setSelectedIds((previous) => {
      const next = new Set(previous);
      if (on) next.add(expressId);
      else next.delete(expressId);
      return next;
    });
  }

  function setAll(on: boolean): void {
    if (on) setSelectedIds(new Set(ordered.map((doc) => doc.storey.expressId)));
    else setSelectedIds(new Set());
  }

  async function onSave(): Promise<void> {
    if (!accessToken || !coreApiBaseUrl || selectedIds.size === 0) return;
    setBusy(true);
    setStatus(t.status.uploading);
    try {
      const docsToUpload = ordered.filter((doc) => selectedIds.has(doc.storey.expressId));
      // Strip empty / default-equivalent overrides so we don't send the
      // identity transformation through. The downstream `resolveStoreyToken`
      // already falls back to the default — keeping the override map
      // small makes debug logs and PR diffs cleaner.
      const effectiveOverrides: Record<number, string> = {};
      for (const doc of docsToUpload) {
        const raw = suffixOverrides[doc.storey.expressId];
        if (!raw) continue;
        const trimmed = raw.trim();
        if (!trimmed) continue;
        if (slugify(trimmed) === defaultStoreyToken(doc)) continue;
        effectiveOverrides[doc.storey.expressId] = trimmed;
      }
      await uploadToTrimble({
        accessToken,
        coreApiBaseUrl,
        projectRootFolderId,
        projectId,
        ifcBaseName,
        documents: docsToUpload,
        filenameSuffixOverrides: effectiveOverrides,
        onProgress: (fraction, fileName) =>
          setStatus(`${t.status.uploading} ${(fraction * 100).toFixed(0)}% ${fileName}`),
      });
      markClean();
      setStatus(t.status.saved);
      onClose();
    } catch (err) {
      console.error(err);
      const detail = err instanceof Error ? err.message : "";
      setStatus(detail ? `${t.errors.uploadFailed} ${detail}` : t.errors.uploadFailed);
    } finally {
      setBusy(false);
    }
  }

  const noneSelected = selectedIds.size === 0;

  return (
    <div className="dialog" role="dialog" aria-modal="true">
      <div className="dialog__panel dialog__panel--wide">
        <h3 className="dialog__title">{t.persistence.modalTitle}</h3>
        <p className="field__hint">{t.persistence.modalHint}</p>
        <p className="field__hint">{t.persistence.fileNameSuffixHint}</p>
        <div className="btn-row">
          <button type="button" className="btn btn--small" onClick={() => setAll(true)} disabled={busy}>
            {t.entityPicker.selectAll}
          </button>
          <button type="button" className="btn btn--small" onClick={() => setAll(false)} disabled={busy}>
            {t.entityPicker.clearAll}
          </button>
        </div>
        <ul className="list">
          {ordered.map((doc) => {
            const checked = selectedIds.has(doc.storey.expressId);
            const areaCount = doc.userAreas.length;
            const objectCount = doc.objects.length;
            const suffix = suffixOverrides[doc.storey.expressId] ?? defaultStoreyToken(doc);
            const previewSuffix = slugify(suffix) || defaultStoreyToken(doc);
            return (
              <li key={doc.storey.expressId}>
                <label className="storey-row">
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={busy}
                    onChange={(event) => toggle(doc.storey.expressId, event.currentTarget.checked)}
                  />
                  <span className="storey-row__primary">
                    {doc.storey.name || `Storey ${doc.storey.expressId}`}
                  </span>
                  <span className="storey-row__meta">
                    {t.storeyList.elevation}: {doc.storey.elevation.toFixed(3)} {doc.units}
                  </span>
                  <span className="storey-row__meta">
                    {t.persistence.statsObjects}: {objectCount} · {t.persistence.statsAreas}: {areaCount}
                  </span>
                </label>
                <div className="storey-row__filename">
                  <span className="storey-row__filename-prefix" aria-hidden="true">{slugBase}-</span>
                  <input
                    type="text"
                    className="input input--inline"
                    value={suffix}
                    disabled={busy || !checked}
                    aria-label={t.persistence.fileNameSuffixLabel}
                    onChange={(event) =>
                      setSuffixOverrides((previous) => ({
                        ...previous,
                        [doc.storey.expressId]: event.currentTarget.value,
                      }))
                    }
                  />
                  <span className="storey-row__filename-preview" aria-live="polite">
                    → {slugBase}-{previewSuffix}.svg / .json
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
        <div className="btn-row btn-row--end">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t.areas.cancel}
          </button>
          <button type="button" className="btn btn--primary" onClick={onSave} disabled={busy || noneSelected}>
            {t.persistence.uploadSelected.replace("{n}", String(selectedIds.size))}
          </button>
        </div>
      </div>
    </div>
  );
}
