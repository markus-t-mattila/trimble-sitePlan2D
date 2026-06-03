import type { IfcAPI } from "web-ifc";
import { IFCBUILDINGSTOREY, IFCRELAGGREGATES, IFCRELCONTAINEDINSPATIALSTRUCTURE } from "web-ifc";
import type { StoreyInfo } from "../types";
import { readNumber, readObjectAttributes, toArrayOfIds } from "./attributes";

export interface StoreyContainment {
  storeysByExpressId: Map<number, StoreyInfo>;
  productExpressIdToStoreyExpressId: Map<number, number>;
}

/**
 * Enumerate every `IfcBuildingStorey` in the model and build the inverse map
 * from each contained product to its storey.
 *
 * IFC stores two kinds of storey membership:
 *   1. `IfcRelContainedInSpatialStructure` — physical building elements
 *      (walls, slabs, doors, windows, columns, …).
 *   2. `IfcRelAggregates` — sub-spatial structures (typically `IfcSpace`).
 *
 * Walking only the first relation is the common mistake that makes
 * `IfcSpace` instances disappear from the per-storey picker. We walk both
 * here so the entire visible storey content surfaces.
 */
export function resolveStoreysAndContainment(api: IfcAPI, modelId: number): StoreyContainment {
  const storeysByExpressId = new Map<number, StoreyInfo>();
  const productExpressIdToStoreyExpressId = new Map<number, number>();

  for (const storeyId of toArrayOfIds(api.GetLineIDsWithType(modelId, IFCBUILDINGSTOREY))) {
    const line = api.GetLine(modelId, storeyId) as Record<string, unknown>;
    const attrs = readObjectAttributes(api, modelId, storeyId);
    const elevation = readNumber(
      (line["Elevation"] ?? null) as { value: unknown } | null,
      0,
    );
    storeysByExpressId.set(storeyId, {
      expressId: storeyId,
      ifcGuid: attrs.ifcGuid,
      name: attrs.name,
      longName: attrs.longName,
      elevation,
    });
  }

  // 1. Physical elements through IfcRelContainedInSpatialStructure
  for (const relId of toArrayOfIds(api.GetLineIDsWithType(modelId, IFCRELCONTAINEDINSPATIALSTRUCTURE))) {
    const rel = api.GetLine(modelId, relId) as Record<string, unknown>;
    const relatingStructureRaw = rel["RelatingStructure"] as { value?: unknown } | undefined;
    const relatedElementsRaw = rel["RelatedElements"] as Array<{ value?: unknown }> | undefined;
    const relatingStructureId =
      relatingStructureRaw && typeof relatingStructureRaw.value === "number"
        ? (relatingStructureRaw.value as number)
        : null;
    if (relatingStructureId == null) continue;
    if (!storeysByExpressId.has(relatingStructureId)) continue;
    if (!Array.isArray(relatedElementsRaw)) continue;
    for (const item of relatedElementsRaw) {
      const productId = typeof item?.value === "number" ? (item.value as number) : null;
      if (productId == null) continue;
      productExpressIdToStoreyExpressId.set(productId, relatingStructureId);
    }
  }

  // 2. Aggregated sub-spatials (IfcSpace under the storey) — these never appear
  // in the relation above, so they need their own pass.
  for (const relId of toArrayOfIds(api.GetLineIDsWithType(modelId, IFCRELAGGREGATES))) {
    const rel = api.GetLine(modelId, relId) as Record<string, unknown>;
    const relatingObjectRaw = rel["RelatingObject"] as { value?: unknown } | undefined;
    const relatedObjectsRaw = rel["RelatedObjects"] as Array<{ value?: unknown }> | undefined;
    const relatingObjectId =
      relatingObjectRaw && typeof relatingObjectRaw.value === "number"
        ? (relatingObjectRaw.value as number)
        : null;
    if (relatingObjectId == null) continue;
    if (!storeysByExpressId.has(relatingObjectId)) continue;
    if (!Array.isArray(relatedObjectsRaw)) continue;
    for (const item of relatedObjectsRaw) {
      const productId = typeof item?.value === "number" ? (item.value as number) : null;
      if (productId == null) continue;
      productExpressIdToStoreyExpressId.set(productId, relatingObjectId);
    }
  }

  return { storeysByExpressId, productExpressIdToStoreyExpressId };
}
