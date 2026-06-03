import { useRef, useState } from "react";
import type { BackgroundImage, StoreyDocument } from "../types";
import { useFloorplanStore } from "../state/floorplanStore";
import { useTranslations } from "../i18n";

interface BackgroundImagePanelProps {
  document: StoreyDocument;
}

const DEFAULT_BACKGROUND_OPACITY = 0.65;

/**
 * Sidebar panel that uploads, configures and removes the storey-level
 * background image. Calibrate mode lets the user drag the image in the
 * viewport (handled by `BackgroundCalibrateTool`); Locked mode disables that
 * tool so accidental clicks don't shift a calibrated overlay.
 */
export function BackgroundImagePanel({ document: doc }: BackgroundImagePanelProps): JSX.Element {
  const t = useTranslations();
  const setBackgroundImage = useFloorplanStore((state) => state.setBackgroundImage);
  const updateBackgroundImage = useFloorplanStore((state) => state.updateBackgroundImage);
  const activeTool = useFloorplanStore((state) => state.activeTool);
  const setActiveTool = useFloorplanStore((state) => state.setActiveTool);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const background = doc.backgroundImage;

  async function onUpload(file: File): Promise<void> {
    setError(null);
    try {
      const { dataUrl, pixelWidth, pixelHeight } = await readImageFile(file);
      const bbox = doc.boundingBox;
      const baseWidth = Math.max(bbox.xMax - bbox.xMin, 1);
      const aspect = pixelHeight > 0 ? pixelHeight / pixelWidth : 1;
      const image: BackgroundImage = {
        href: dataUrl,
        origin: [bbox.xMin, bbox.yMin],
        widthWorld: baseWidth,
        heightWorld: baseWidth * aspect,
        rotationDeg: 0,
        opacity: DEFAULT_BACKGROUND_OPACITY,
        pixelWidth,
        pixelHeight,
        locked: false,
      };
      setBackgroundImage(doc.storey.expressId, image);
      setActiveTool({ kind: "background-calibrate" });
    } catch (err) {
      console.error(err);
      setError(t.background.uploadFailed);
    }
  }

  return (
    <section className="section" aria-labelledby="background-image-title">
      <h2 id="background-image-title" className="section__title">
        {t.background.title}
      </h2>
      <div className="btn-row">
        <button type="button" className="btn btn--small" onClick={() => fileInputRef.current?.click()}>
          {t.background.upload}
        </button>
        {background ? (
          <button
            type="button"
            className="btn btn--small"
            onClick={() => {
              setBackgroundImage(doc.storey.expressId, null);
              if (activeTool?.kind === "background-calibrate") setActiveTool(null);
            }}
          >
            {t.background.remove}
          </button>
        ) : null}
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        hidden
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void onUpload(file);
          event.currentTarget.value = "";
        }}
      />
      {error ? <p className="dialog__error">{error}</p> : null}
      {background ? (
        <>
          <div className="field">
            <label className="field__label" htmlFor="background-opacity">
              {t.background.opacity}
            </label>
            <input
              id="background-opacity"
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={background.opacity}
              onChange={(event) => updateBackgroundImage(doc.storey.expressId, { opacity: Number(event.currentTarget.value) })}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="background-width">
              {t.background.width}
            </label>
            <input
              id="background-width"
              type="number"
              className="input input--inline"
              step={0.5}
              value={background.widthWorld.toFixed(2)}
              onChange={(event) => {
                const nextWidth = Number(event.currentTarget.value);
                if (!Number.isFinite(nextWidth) || nextWidth <= 0) return;
                const aspect =
                  background.pixelHeight > 0 ? background.pixelHeight / background.pixelWidth : background.heightWorld / background.widthWorld;
                updateBackgroundImage(doc.storey.expressId, {
                  widthWorld: nextWidth,
                  heightWorld: nextWidth * aspect,
                });
              }}
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="background-rotation">
              {t.background.rotation}
            </label>
            <input
              id="background-rotation"
              type="number"
              className="input input--inline"
              step={1}
              value={background.rotationDeg}
              onChange={(event) => {
                const next = Number(event.currentTarget.value);
                if (Number.isFinite(next)) updateBackgroundImage(doc.storey.expressId, { rotationDeg: next });
              }}
            />
          </div>
          <div className="field field--row">
            <label className="checkbox-row" htmlFor="background-locked">
              <input
                id="background-locked"
                type="checkbox"
                checked={background.locked}
                onChange={(event) => {
                  const locked = event.currentTarget.checked;
                  updateBackgroundImage(doc.storey.expressId, { locked });
                  if (locked && activeTool?.kind === "background-calibrate") setActiveTool(null);
                  if (!locked && activeTool === null) setActiveTool({ kind: "background-calibrate" });
                }}
              />
              <span>{background.locked ? t.background.modeLocked : t.background.modeCalibrate}</span>
            </label>
          </div>
          {!background.locked ? <p className="field__hint">{t.background.calibrateHint}</p> : null}
        </>
      ) : null}
    </section>
  );
}

interface DecodedImage {
  dataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
}

/**
 * Read a `File` into a data URL and decode it once to capture the original
 * pixel dimensions (needed to preserve aspect ratio when the user resizes
 * the image in world units).
 */
async function readImageFile(file: File): Promise<DecodedImage> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.addEventListener("load", () => resolve(String(reader.result)));
    reader.addEventListener("error", () => reject(reader.error));
    reader.readAsDataURL(file);
  });
  const dimensions = await new Promise<{ width: number; height: number }>((resolve, reject) => {
    const image = new Image();
    image.addEventListener("load", () => resolve({ width: image.naturalWidth, height: image.naturalHeight }));
    image.addEventListener("error", reject);
    image.src = dataUrl;
  });
  return { dataUrl, pixelWidth: dimensions.width, pixelHeight: dimensions.height };
}
