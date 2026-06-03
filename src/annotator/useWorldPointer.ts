import { useCallback, type RefObject } from "react";
import type { Vec2 } from "../types";

/**
 * Shared helper used by every drawing tool. Converts a pointer event's
 * client coordinate to the IFC-world XY by inverting the SVG's current
 * screen CTM and undoing the storey-level Y flip.
 *
 * @param svgRef        Ref to the rendered SVG canvas element.
 * @param yFlipOffset   `bbox.yMin + bbox.yMax`; the offset used by the
 *                      outer transform that flipped the Y axis.
 * @returns             A stable `clientToWorld` callback.
 */
export function useWorldPointer(
  svgRef: RefObject<SVGSVGElement | null>,
  yFlipOffset: number,
): (clientX: number, clientY: number) => Vec2 | null {
  return useCallback(
    (clientX, clientY) => {
      const svgElement = svgRef.current;
      if (!svgElement) return null;
      const ctm = svgElement.getScreenCTM();
      if (!ctm) return null;
      const inverse = ctm.inverse();
      const point = svgElement.createSVGPoint();
      point.x = clientX;
      point.y = clientY;
      const transformed = point.matrixTransform(inverse);
      return [transformed.x, yFlipOffset - transformed.y];
    },
    [svgRef, yFlipOffset],
  );
}
