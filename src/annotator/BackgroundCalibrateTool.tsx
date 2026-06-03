import { useEffect, type RefObject } from "react";
import type { StoreyDocument } from "../types";
import { useFloorplanStore } from "../state/floorplanStore";
import { useWorldPointer } from "./useWorldPointer";

interface BackgroundCalibrateToolProps {
  document: StoreyDocument;
  svgRef: RefObject<SVGSVGElement | null>;
}

/**
 * Active when the user is calibrating the background image. Drag-translates
 * the image's `origin` in world units; pan/zoom remains available on the
 * rest of the viewport because we capture the pointer only after a press
 * starts inside the image group.
 *
 * Scaling is performed numerically through `BackgroundImagePanel` so a
 * supervisor with the site's measured length can punch in the exact value;
 * dragging is the fast first pass.
 */
export function BackgroundCalibrateTool({ document: doc, svgRef }: BackgroundCalibrateToolProps): JSX.Element | null {
  const updateBackgroundImage = useFloorplanStore((state) => state.updateBackgroundImage);
  const background = doc.backgroundImage;
  const yFlipOffset = doc.boundingBox.yMin + doc.boundingBox.yMax;
  const clientToWorld = useWorldPointer(svgRef, yFlipOffset);

  useEffect(() => {
    if (!background || background.locked) return;
    const svgElement = svgRef.current;
    if (!svgElement) return;
    const container = svgElement.parentElement;
    if (!container) return;
    let dragging = false;
    let pressWorld: [number, number] | null = null;
    let startOrigin: [number, number] | null = null;
    let currentOrigin: [number, number] | null = null;
    let pointerId: number | null = null;

    function patchImageDom(originX: number, originY: number, img: SVGImageElement): void {
      // The `<image>` group sits inside the floorplan flip group, so the
      // image's own `transform` is `translate(centerX centerY) rotate(...)
      // scale(1 -1) translate(-centerX -centerY)`. When we drag, only the
      // origin (top-left in world units) changes — same width/height/
      // rotation. So we update the `x` + `y` attrs AND rewrite the
      // transform with the new centre.
      const currentBackground =
        useFloorplanStore.getState().storeyDocuments[doc.storey.expressId]?.backgroundImage;
      if (!currentBackground) return;
      const cx = originX + currentBackground.widthWorld / 2;
      const cy = originY + currentBackground.heightWorld / 2;
      img.setAttribute("x", String(originX));
      img.setAttribute("y", String(originY));
      const parent = img.parentElement;
      if (parent) {
        // Mirror the transform svgBuilder emits so the DOM patch and
        // the next full re-render produce the same visual result.
        img.setAttribute(
          "transform",
          `translate(${cx} ${cy}) rotate(${-currentBackground.rotationDeg}) scale(1 -1) translate(${-cx} ${-cy})`,
        );
      }
    }

    function onPointerDown(event: PointerEvent): void {
      const target = event.target as Element | null;
      if (!(target instanceof Element)) return;
      const insideImage = target.closest("image[data-background]") !== null;
      if (!insideImage) return;
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      const currentBackground =
        useFloorplanStore.getState().storeyDocuments[doc.storey.expressId]?.backgroundImage;
      if (!currentBackground) return;
      // Lock the gesture so it survives the cursor leaving the canvas,
      // and remember the press-down state so pointermove can compute an
      // absolute delta without depending on per-frame deltas (which
      // accumulate floating-point drift over a long drag).
      dragging = true;
      pressWorld = [world[0], world[1]];
      startOrigin = [currentBackground.origin[0], currentBackground.origin[1]];
      currentOrigin = [currentBackground.origin[0], currentBackground.origin[1]];
      pointerId = event.pointerId;
      container?.setPointerCapture(event.pointerId);
      event.stopPropagation();
    }

    function onPointerMove(event: PointerEvent): void {
      if (!dragging || !pressWorld || !startOrigin) return;
      const world = clientToWorld(event.clientX, event.clientY);
      if (!world) return;
      // Delta from press-down, NOT from previous frame. With per-frame
      // deltas the drag accumulates rounding errors over time AND can
      // skid badly when a frame is dropped; absolute deltas are exact.
      const dx = world[0] - pressWorld[0];
      const dy = world[1] - pressWorld[1];
      const nextOriginX = startOrigin[0] + dx;
      const nextOriginY = startOrigin[1] + dy;
      currentOrigin = [nextOriginX, nextOriginY];
      // Live-patch the rendered <image> instead of writing through the
      // store on every move. Going through the store re-rebuilds the
      // entire SVG (innerHTML = svgBuilder(doc)), which on a large IFC
      // is too slow for 60fps drag — that's the lag the user reported.
      const img = svgElement!.querySelector<SVGImageElement>("image[data-background]");
      if (img) patchImageDom(nextOriginX, nextOriginY, img);
    }

    function onPointerUp(): void {
      if (!dragging) return;
      dragging = false;
      if (pointerId !== null && container?.hasPointerCapture(pointerId)) {
        container.releasePointerCapture(pointerId);
      }
      pointerId = null;
      // ONE store write at the end of the drag — clean for undo/redo
      // (a long drag is a single step, same convention as the
      // EditOverlay path).
      if (currentOrigin) {
        updateBackgroundImage(doc.storey.expressId, { origin: currentOrigin });
      }
      pressWorld = null;
      startOrigin = null;
      currentOrigin = null;
    }

    container.addEventListener("pointerdown", onPointerDown);
    container.addEventListener("pointermove", onPointerMove);
    container.addEventListener("pointerup", onPointerUp);
    container.addEventListener("pointercancel", onPointerUp);
    return () => {
      container.removeEventListener("pointerdown", onPointerDown);
      container.removeEventListener("pointermove", onPointerMove);
      container.removeEventListener("pointerup", onPointerUp);
      container.removeEventListener("pointercancel", onPointerUp);
    };
  }, [background, clientToWorld, doc.storey.expressId, svgRef, updateBackgroundImage]);

  return null;
}
