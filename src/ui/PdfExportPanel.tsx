import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";
import {
  exportStoreyToPdf,
  PAPER_SIZES,
  type PaperSize,
  type PdfOrientation,
} from "../pdf/exportPdf";
import { buildStoreySvg } from "../generator/svgBuilder";
import { applyPrintCssOverrides } from "../pdf/exportPdf";
import { buildPdfAnnotations } from "../pdf/pdfAnnotations";
import { computeRenderingBbox, extendToAspect, withMargin } from "../utils/bbox";
import { slugify } from "../persistence/downloadZip";
import { FLOORPLAN_OUTPUT_FOLDER_NAME } from "../persistence/uploadToTrimble";
import { devLog } from "../utils/devLog";
import {
  findOrCreateProjectFolder,
  resolveProjectRootFolderId,
  uploadFileArrayBuffer,
} from "../trimble/coreApiClient";
import type { StoreyDocument } from "../types";

interface CropBbox {
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

const MIN_CROP_SPAN_WORLD = 0.01;
const MAX_CROP_SPAN_WORLD = 1_000_000;
// Multiplier per wheel notch / per +/− button press. 1.15× per step gives
// roughly 7 wheel notches per 2× zoom — comfortable on a Mac touchpad
// where two-finger scroll generates many small deltaY events.
const ZOOM_STEP = 1.15;

const DEFAULT_PAPER: PaperSize = "A3";
const DEFAULT_ORIENTATION: PdfOrientation = "landscape";
const DEFAULT_MARGIN_MM = 12;
const MARGIN_STEP_MM = 1;
const MARGIN_MIN_MM = 0;
const MARGIN_MAX_MM = 60;

/**
 * Sidebar button + modal that drives PDF export.
 *
 * The button is always visible. The modal opens a live preview of how the
 * active storey will render on the chosen paper size + orientation +
 * margin; pressing "Export" always uploads the PDF to Trimble Connect — the
 * design intent is "data lives in TC; download from there when needed".
 */
export function PdfExportPanel(): JSX.Element | null {
  const t = useTranslations();
  const selectedStoreyExpressId = useFloorplanStore((state) => state.selectedStoreyExpressId);
  const storeyDocuments = useFloorplanStore((state) => state.storeyDocuments);
  const activeDoc = selectedStoreyExpressId != null ? storeyDocuments[selectedStoreyExpressId] : undefined;
  const [open, setOpen] = useState(false);

  if (!activeDoc) return null;
  return (
    <section className="section" aria-labelledby="pdf-export-title">
      <h2 id="pdf-export-title" className="section__title">
        {t.pdf.title}
      </h2>
      <button type="button" className="btn" onClick={() => setOpen(true)}>
        {t.pdf.openModal}
      </button>
      {open ? <PdfExportModal doc={activeDoc} onClose={() => setOpen(false)} /> : null}
    </section>
  );
}

interface PdfExportModalProps {
  doc: StoreyDocument;
  onClose: () => void;
}

function PdfExportModal({ doc, onClose }: PdfExportModalProps): JSX.Element {
  const t = useTranslations();
  const accessToken = useFloorplanStore((state) => state.accessToken);
  const coreApiBaseUrl = useFloorplanStore((state) => state.coreApiBaseUrl);
  const project = useFloorplanStore((state) => state.project);
  const setStatus = useFloorplanStore((state) => state.setStatus);

  const [paperSize, setPaperSize] = useState<PaperSize>(DEFAULT_PAPER);
  const [orientation, setOrientation] = useState<PdfOrientation>(DEFAULT_ORIENTATION);
  const [marginMm, setMarginMm] = useState<number>(DEFAULT_MARGIN_MM);
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  // Default on — supervisors expect a scale + coordinate reference on
  // every printed plan. The user can disable it for one-off exports
  // where the annotation card would distract from the content.
  const [includeAnnotations, setIncludeAnnotations] = useState(true);
  // Crop state: `null` = print the storey's full rendering bbox (IFC +
  // user content). A bbox value = print only that window. The user toggles
  // the mode via the "Custom crop" checkbox; once on, the bbox initialises
  // to the current default and is then mutated by drag-to-pan + scroll-to-
  // zoom inside the preview.
  const [cropBbox, setCropBbox] = useState<CropBbox | null>(null);

  const defaultName = `${slugify(doc.source.fileName.replace(/\.ifc$/i, "")) || "ifc"}-${slugify(doc.storey.name || `storey-${doc.storey.expressId}`)}.pdf`;
  const effectiveName = (fileName.trim() || defaultName).replace(/[^\w\d.\-_]+/g, "-");

  // The preview SVG is identical to what the PDF exporter rasterises. We embed it
  // inside a paper-shaped frame so the user can see exactly how it'll sit.
  const previewSvg = useMemo(() => buildStoreySvg(doc), [doc]);
  const sheet = computeSheet(paperSize, orientation);
  // Aspect ratio of the printable area (paper minus the user's margins).
  // We normalise both the full-content bbox and the user's crop to this
  // aspect so (a) the SVG fills the printable area without letterboxing
  // and (b) the annotation card at the viewBox bottom-right sits at the
  // printable area's bottom-right — not at a content corner that may
  // be inset by whitespace.
  const usableAspect = useMemo(() => {
    const w = sheet.widthMm - 2 * marginMm;
    const h = sheet.heightMm - 2 * marginMm;
    return w > 0 && h > 0 ? w / h : 1;
  }, [sheet, marginMm]);
  // Default bbox covers IFC + every drawn user object, then expands the
  // shorter dimension to match the printable aspect.
  const fullBbox = useMemo(
    () => extendToAspect(withMargin(computeRenderingBbox(doc), 0.05), usableAspect),
    [doc, usableAspect],
  );
  const previewBbox: CropBbox = cropBbox ?? fullBbox;
  // When paper size or margin changes, re-normalise the user's crop to
  // the new aspect so the card stays pinned to the page corner. Without
  // this the cropBbox's aspect drifts away from usableAspect and the
  // SVG letterboxes again.
  useEffect(() => {
    setCropBbox((current) => (current ? extendToAspect(current, usableAspect) : current));
  }, [usableAspect]);
  // Stable setter reference — otherwise PdfPreview's effect re-runs on
  // every state change, tearing down and re-attaching its pointer/wheel
  // listeners mid-gesture (macOS in particular sometimes drops the
  // capture if listeners are swapped while a drag is in flight).
  const handleCropChange = useCallback((next: CropBbox) => setCropBbox(next), []);
  const zoomCrop = useCallback((factor: number) => {
    setCropBbox((current) => {
      if (!current) return current;
      const cx = (current.xMin + current.xMax) / 2;
      const cy = (current.yMin + current.yMax) / 2;
      const halfW = (current.xMax - current.xMin) * factor * 0.5;
      const halfH = (current.yMax - current.yMin) * factor * 0.5;
      if (halfW * 2 < MIN_CROP_SPAN_WORLD || halfW * 2 > MAX_CROP_SPAN_WORLD) return current;
      return { xMin: cx - halfW, xMax: cx + halfW, yMin: cy - halfH, yMax: cy + halfH };
    });
  }, []);

  async function onExport(): Promise<void> {
    if (!accessToken || !coreApiBaseUrl || !project?.id) {
      // rootFolderId is no longer required — the Core API resolver looks
      // it up from /projects/{id}. We only need the id + a token + a host.
      setStatus(t.pdf.failed);
      return;
    }
    setBusy(true);
    setStatus(t.status.uploading);
    try {
      const bytes = await exportStoreyToPdf({
        doc,
        paperSize,
        orientation,
        marginMm,
        includeAnnotations,
        // Pass the effective bbox unconditionally (it's already aspect-
        // matched to the printable area) so the PDF reproduces the
        // preview to the pixel.
        cropBbox: previewBbox,
      });
      devLog(`[sitePlan2D] PDF export: built ${bytes.byteLength} bytes`);
      const rootFolderId = await resolveProjectRootFolderId(
        accessToken,
        coreApiBaseUrl,
        project.id,
        project.rootFolderId,
      );
      const folder = await findOrCreateProjectFolder(
        accessToken,
        coreApiBaseUrl,
        rootFolderId,
        FLOORPLAN_OUTPUT_FOLDER_NAME,
        project.id,
      );
      devLog(`[sitePlan2D] PDF export: folder ${folder.folderId} (${folder.created ? "created" : "existing"})`);
      const finalName = effectiveName.endsWith(".pdf") ? effectiveName : `${effectiveName}.pdf`;
      const upload = await uploadFileArrayBuffer(accessToken, coreApiBaseUrl, {
        folderId: folder.folderId,
        fileName: finalName,
        contentType: "application/pdf",
        content: bytes,
      });
      devLog(
        `[sitePlan2D] PDF export: uploaded ${finalName} -> fileId=${upload.fileId ?? "?"} versionId=${upload.versionId ?? "?"}`,
      );
      setStatus(t.pdf.saved);
      onClose();
    } catch (err) {
      console.error("[sitePlan2D] PDF export failed:", err);
      const detail = err instanceof Error ? err.message : String(err);
      setStatus(detail ? `${t.errors.pdfExportFailed} ${detail}` : t.pdf.failed);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="dialog" role="dialog" aria-modal="true">
      <div className="dialog__panel dialog__panel--wide">
        <h3 className="dialog__title">{t.pdf.title}</h3>
        <div className="pdf-modal">
          <div className="pdf-modal__preview" aria-label={t.pdf.preview}>
            <PdfPreview
              svgMarkup={previewSvg}
              previewBbox={previewBbox}
              paperWidthMm={sheet.widthMm}
              paperHeightMm={sheet.heightMm}
              marginMm={marginMm}
              cropEnabled={cropBbox !== null}
              onCropChange={handleCropChange}
              doc={doc}
              includeAnnotations={includeAnnotations}
              printableWidthMm={Math.max(1, sheet.widthMm - 2 * marginMm)}
            />
            <p className="pdf-modal__paper-label">
              {paperSize} · {sheet.widthMm.toFixed(0)} × {sheet.heightMm.toFixed(0)} mm
            </p>
          </div>
          <div className="pdf-modal__controls">
            <div className="field">
              <label className="field__label" htmlFor="pdf-paper-size">
                {t.pdf.paperSize}
              </label>
              <select
                id="pdf-paper-size"
                className="select"
                value={paperSize}
                onChange={(event) => setPaperSize(event.currentTarget.value as PaperSize)}
              >
                {Object.keys(PAPER_SIZES).map((key) => (
                  <option key={key} value={key}>
                    {key}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pdf-orientation">
                {t.pdf.orientation}
              </label>
              <select
                id="pdf-orientation"
                className="select"
                value={orientation}
                onChange={(event) => setOrientation(event.currentTarget.value as PdfOrientation)}
              >
                <option value="portrait">{t.pdf.orientationPortrait}</option>
                <option value="landscape">{t.pdf.orientationLandscape}</option>
              </select>
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pdf-margin">
                {t.pdf.marginMm}
              </label>
              <input
                id="pdf-margin"
                type="number"
                className="input input--inline"
                value={marginMm}
                step={MARGIN_STEP_MM}
                min={MARGIN_MIN_MM}
                max={MARGIN_MAX_MM}
                onChange={(event) => {
                  const next = Number(event.currentTarget.value);
                  if (Number.isFinite(next) && next >= MARGIN_MIN_MM && next <= MARGIN_MAX_MM) setMarginMm(next);
                }}
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="pdf-file-name">
                {t.pdf.fileNameLabel}
              </label>
              <input
                id="pdf-file-name"
                type="text"
                className="input"
                value={fileName}
                placeholder={defaultName}
                onChange={(event) => setFileName(event.currentTarget.value)}
              />
            </div>
            <div className="field">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={cropBbox !== null}
                  onChange={(event) => {
                    if (event.currentTarget.checked) {
                      // Seed the crop bbox from the current full-content
                      // view so toggling the checkbox doesn't immediately
                      // shift the preview — the user adjusts from there.
                      setCropBbox({ ...fullBbox });
                    } else {
                      setCropBbox(null);
                    }
                  }}
                />
                <span>{t.pdf.customCrop}</span>
              </label>
              {cropBbox !== null ? (
                <>
                  <p className="field__hint">{t.pdf.customCropHint}</p>
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => zoomCrop(1 / ZOOM_STEP)}
                      aria-label="Zoom in"
                    >
                      +
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => zoomCrop(ZOOM_STEP)}
                      aria-label="Zoom out"
                    >
                      −
                    </button>
                    <button
                      type="button"
                      className="btn btn--small"
                      onClick={() => setCropBbox({ ...fullBbox })}
                    >
                      {t.pdf.resetCrop}
                    </button>
                  </div>
                </>
              ) : null}
            </div>
            <div className="field">
              <label className="checkbox-row">
                <input
                  type="checkbox"
                  checked={includeAnnotations}
                  onChange={(event) => setIncludeAnnotations(event.currentTarget.checked)}
                />
                <span>{t.pdf.includeAnnotations}</span>
              </label>
            </div>
            <p className="field__hint">{t.pdf.alwaysSavesToTrimble}</p>
          </div>
        </div>
        <div className="btn-row btn-row--end">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            {t.areas.cancel}
          </button>
          <button type="button" className="btn btn--primary" onClick={onExport} disabled={busy}>
            {t.pdf.exportButton}
          </button>
        </div>
      </div>
    </div>
  );
}

interface PdfPreviewProps {
  svgMarkup: string;
  previewBbox: CropBbox;
  paperWidthMm: number;
  paperHeightMm: number;
  marginMm: number;
  /** When true, drag-to-pan and scroll-to-zoom mutate `previewBbox` via
   *  `onCropChange`. When false the preview is static (default flow). */
  cropEnabled: boolean;
  onCropChange: (next: CropBbox) => void;
  /** Document we annotate against. Needed so the preview matches the PDF
   *  (same axes + scale bar drawn from the same numbers). */
  doc: StoreyDocument;
  /** When false, the axes + scale-bar card is omitted from both the
   *  preview and the PDF — matches the user-facing toggle. */
  includeAnnotations: boolean;
  /** Printable area width in mm, needed by the annotation builder so
   *  the card sizes itself in absolute mm regardless of paper format. */
  printableWidthMm: number;
}


/**
 * Schematic preview of how the storey will sit on the chosen paper. Outer
 * box = the page; the dashed inner box is the printable area after margins;
 * the embedded SVG is the actual floorplan scaled to fit.
 *
 * When `cropEnabled` is true the user can drag inside the usable area to
 * pan and scroll to zoom — both mutate the supplied `previewBbox` via
 * `onCropChange`, and the PDF exporter receives the very same bbox so
 * the printed area matches the preview to the pixel.
 */
function PdfPreview({
  svgMarkup,
  previewBbox,
  paperWidthMm,
  paperHeightMm,
  marginMm,
  cropEnabled,
  onCropChange,
  doc,
  includeAnnotations,
  printableWidthMm,
}: PdfPreviewProps): JSX.Element {
  const paperAspect = paperHeightMm / paperWidthMm;
  const marginX = (marginMm / paperWidthMm) * 100;
  const marginY = (marginMm / paperHeightMm) * 100;
  const usableX = 100 - marginX * 2;
  const usableY = 100 - marginY * 2;

  const vbWidth = previewBbox.xMax - previewBbox.xMin || 1;
  const vbHeight = previewBbox.yMax - previewBbox.yMin || 1;
  const viewBox = `${previewBbox.xMin} ${previewBbox.yMin} ${vbWidth} ${vbHeight}`;
  // PDF-only annotation overlay (axes + coordinates + scale bar). Computed
  // from the SAME viewBox the SVG below is rendered with, so the preview
  // shows pixel-for-pixel what the PDF will produce. Skipped entirely
  // when the user has toggled the annotation switch off.
  const annotationFragment = includeAnnotations
    ? buildPdfAnnotations(
        doc,
        {
          xMin: previewBbox.xMin,
          yMin: previewBbox.yMin,
          width: vbWidth,
          height: vbHeight,
        },
        printableWidthMm,
      )
    : "";

  // Pan/zoom interaction state. We keep the latest bbox in a ref so the
  // wheel listener (which we have to register as `passive: false` so we
  // can preventDefault) reads the fresh value without going through React
  // state.
  const usableRef = useRef<HTMLDivElement | null>(null);
  const bboxRef = useRef<CropBbox>(previewBbox);
  useEffect(() => {
    bboxRef.current = previewBbox;
  }, [previewBbox]);
  const dragRef = useRef<{ startClientX: number; startClientY: number; startBbox: CropBbox } | null>(null);

  // Pan: pointerdown captures the cursor, pointermove translates the
  // bbox in world units proportionally to the cursor delta vs the
  // usable-area DOM dimensions.
  useEffect(() => {
    if (!cropEnabled) return;
    const element = usableRef.current;
    if (!element) return;

    function onPointerDown(event: PointerEvent): void {
      if (event.button !== 0) return;
      element!.setPointerCapture(event.pointerId);
      dragRef.current = {
        startClientX: event.clientX,
        startClientY: event.clientY,
        startBbox: { ...bboxRef.current },
      };
    }
    function onPointerMove(event: PointerEvent): void {
      const drag = dragRef.current;
      if (!drag) return;
      const rect = element!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const worldPerPxX = (drag.startBbox.xMax - drag.startBbox.xMin) / rect.width;
      const worldPerPxY = (drag.startBbox.yMax - drag.startBbox.yMin) / rect.height;
      // The bbox is BOTH the SVG viewBox numbers AND (because the
      // floorplan flip is value-preserving) the world Y-up bounds. To
      // make content follow the cursor naturally, shifting BOTH axes
      // requires the viewBox to slide in the OPPOSITE direction to the
      // drag — moving the window LEFT/UP so the fixed content appears
      // to move RIGHT/DOWN under it. Hence minus on both deltas.
      const dx = (event.clientX - drag.startClientX) * worldPerPxX;
      const dy = (event.clientY - drag.startClientY) * worldPerPxY;
      const next: CropBbox = {
        xMin: drag.startBbox.xMin - dx,
        xMax: drag.startBbox.xMax - dx,
        yMin: drag.startBbox.yMin - dy,
        yMax: drag.startBbox.yMax - dy,
      };
      onCropChange(next);
    }
    function onPointerUp(event: PointerEvent): void {
      if (element!.hasPointerCapture(event.pointerId)) {
        element!.releasePointerCapture(event.pointerId);
      }
      dragRef.current = null;
    }
    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      const rect = element!.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;
      const bbox = bboxRef.current;
      // Zoom around the cursor: compute the viewBox coord under the
      // cursor, then keep that coord under the cursor in the new bbox.
      // All math is in pure viewBox terms (svg Y-down), which matches
      // the bbox's role as the SVG's viewBox attribute. Pixel
      // fraction 0 = top of preview = bbox.yMin (svg-top);
      // fraction 1 = bottom = bbox.yMax (svg-bottom).
      const cursorFracX = (event.clientX - rect.left) / rect.width;
      const cursorFracY = (event.clientY - rect.top) / rect.height;
      const cursorSvgX = bbox.xMin + cursorFracX * (bbox.xMax - bbox.xMin);
      const cursorSvgY = bbox.yMin + cursorFracY * (bbox.yMax - bbox.yMin);
      const scale = event.deltaY < 0 ? 1 / ZOOM_STEP : ZOOM_STEP;
      const newWidth = (bbox.xMax - bbox.xMin) * scale;
      const newHeight = (bbox.yMax - bbox.yMin) * scale;
      if (newWidth < MIN_CROP_SPAN_WORLD || newWidth > MAX_CROP_SPAN_WORLD) return;
      if (newHeight < MIN_CROP_SPAN_WORLD || newHeight > MAX_CROP_SPAN_WORLD) return;
      const next: CropBbox = {
        xMin: cursorSvgX - cursorFracX * newWidth,
        xMax: cursorSvgX + (1 - cursorFracX) * newWidth,
        yMin: cursorSvgY - cursorFracY * newHeight,
        yMax: cursorSvgY + (1 - cursorFracY) * newHeight,
      };
      onCropChange(next);
    }
    element.addEventListener("pointerdown", onPointerDown);
    element.addEventListener("pointermove", onPointerMove);
    element.addEventListener("pointerup", onPointerUp);
    element.addEventListener("pointercancel", onPointerUp);
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => {
      element.removeEventListener("pointerdown", onPointerDown);
      element.removeEventListener("pointermove", onPointerMove);
      element.removeEventListener("pointerup", onPointerUp);
      element.removeEventListener("pointercancel", onPointerUp);
      element.removeEventListener("wheel", onWheel);
    };
  }, [cropEnabled, onCropChange]);

  return (
    <div
      className="pdf-preview"
      style={{ ["--pdf-preview-aspect" as string]: String(paperAspect), position: "relative" }}
    >
      <div
        className={`pdf-preview__usable${cropEnabled ? " pdf-preview__usable--crop" : ""}`}
        style={{
          left: `${marginX}%`,
          top: `${marginY}%`,
          width: `${usableX}%`,
          height: `${usableY}%`,
        }}
      >
        <div
          className="pdf-preview__inner"
          // When crop mode is active we route all pointer/wheel events to
          // the overlay div above instead of letting the SVG (and every
          // painted shape inside it) potentially swallow them.
          style={cropEnabled ? { pointerEvents: "none" } : undefined}
          dangerouslySetInnerHTML={{
            // Replace the SVG's existing viewBox (svgBuilder always emits
            // one) in place — appending a second viewBox attribute would
            // be silently dropped by most parsers because the first match
            // wins. THAT was the bug behind "only the annotation card
            // moved when the user dragged" — the SVG itself stayed
            // pinned to the full-content viewBox.
            // Apply the SAME print-CSS overrides the PDF exporter applies
            // before rasterising. Without this the preview keeps
            // `vector-effect: non-scaling-stroke` (pixel-thin lines on
            // screen) but the PDF drops it (lines scale with the
            // viewBox), so the PDF looks dramatically thicker than the
            // preview. WYSIWYG requires both sides to use the same rules.
            __html: applyPrintCssOverrides(svgMarkup)
              .replace(/\sviewBox="[^"]*"/, ` viewBox="${viewBox}"`)
              .replace(/<svg(?![^>]*\spreserveAspectRatio)/, '<svg preserveAspectRatio="xMidYMid meet"')
              .replace(/<\/svg>\s*$/, `${annotationFragment}</svg>`),
          }}
        />
      </div>
      {cropEnabled ? (
        // Crop overlay is a SIBLING of the usable area, not a child —
        // that way it sits at the top of `.pdf-preview`'s stacking order
        // regardless of what the SVG inside does with its own z-index /
        // flex layout. Positioned to cover the same printable rectangle
        // (margins included so the user can pan from anywhere on the
        // page). A *barely* visible background colour is set explicitly
        // because some browsers skip painting fully-transparent absolute
        // elements, which can drop pointermove events.
        <div
          ref={usableRef}
          className="pdf-preview__crop-overlay"
          style={{
            position: "absolute",
            left: `${marginX}%`,
            top: `${marginY}%`,
            width: `${usableX}%`,
            height: `${usableY}%`,
            cursor: "grab",
            touchAction: "none",
            backgroundColor: "rgba(255, 255, 255, 0.001)",
            zIndex: 2,
          }}
          aria-label="Crop: drag to pan, scroll to zoom"
        />
      ) : null}
    </div>
  );
}

function computeSheet(paperSize: PaperSize, orientation: PdfOrientation): { widthMm: number; heightMm: number } {
  const base = PAPER_SIZES[paperSize];
  const widthMm = orientation === "landscape" ? Math.max(base.widthMm, base.heightMm) : Math.min(base.widthMm, base.heightMm);
  const heightMm = orientation === "landscape" ? Math.min(base.widthMm, base.heightMm) : Math.max(base.widthMm, base.heightMm);
  return { widthMm, heightMm };
}
