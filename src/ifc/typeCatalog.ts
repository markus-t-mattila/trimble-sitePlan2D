import type { IfcAPI } from "web-ifc";
import { IfcEntities } from "./ifcEntities";
import { toArrayOfIds } from "./attributes";
import type { StoreyContainment } from "./storeyResolver";

export interface TypeCount {
  ifcTypeName: string;
  ifcTypeId: number;
  totalCount: number;
  countByStorey: Map<number, number>;
}

/*
For every "interesting" IFC product type in the model, count how many
instances exist in total and how many appear in each storey. The interesting
types list is curated for floorplan use; everything else (psets, materials,
non-product entities) is skipped.
*/
export function scanTypeCatalog(
  api: IfcAPI,
  modelId: number,
  containment: StoreyContainment,
): TypeCount[] {
  const result: TypeCount[] = [];
  for (const typeDef of IfcEntities) {
    const ids = toArrayOfIds(api.GetLineIDsWithType(modelId, typeDef.id));
    if (ids.length === 0) continue;
    const countByStorey = new Map<number, number>();
    for (const productId of ids) {
      const storeyId = containment.productExpressIdToStoreyExpressId.get(productId);
      if (storeyId == null) continue;
      countByStorey.set(storeyId, (countByStorey.get(storeyId) ?? 0) + 1);
    }
    if (countByStorey.size === 0) continue;
    result.push({
      ifcTypeName: typeDef.name,
      ifcTypeId: typeDef.id,
      totalCount: ids.length,
      countByStorey,
    });
  }
  result.sort((a, b) => a.ifcTypeName.localeCompare(b.ifcTypeName));
  return result;
}

export function productIdsForStoreyAndTypes(
  api: IfcAPI,
  modelId: number,
  containment: StoreyContainment,
  storeyExpressId: number,
  ifcTypeNames: ReadonlySet<string>,
): Map<number, string> {
  const lookup = new Map<number, string>();
  for (const typeDef of IfcEntities) {
    if (!ifcTypeNames.has(typeDef.name)) continue;
    for (const productId of toArrayOfIds(api.GetLineIDsWithType(modelId, typeDef.id))) {
      if (containment.productExpressIdToStoreyExpressId.get(productId) !== storeyExpressId) continue;
      lookup.set(productId, typeDef.name);
    }
  }
  return lookup;
}
