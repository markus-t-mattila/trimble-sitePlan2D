import type {
  FloorplanSource,
  IfcUnit,
  RenderOptions,
  StoreyDocument,
  StoreyInfo,
  StoreyObject,
  UserArea,
} from "../types";
import { emptyBbox, extendByPoints, isEmpty as isBboxEmpty } from "../utils/bbox";
import { storeyDocumentSchema } from "./schema";

const SCHEMA_VERSION = "1.0.0";
const GENERATOR_NAME = "trimble-sitePlan2D";

export interface BuildStoreyJsonInput {
  generatorVersion: string;
  source: FloorplanSource;
  storey: StoreyInfo;
  units: IfcUnit;
  objects: StoreyObject[];
  userAreas: UserArea[];
  cutHeightAboveStorey: number;
  generatedAt?: string;
  renderOptions?: RenderOptions;
}

/*
Build a StoreyDocument from the IFC engine's per-storey output plus any user
areas. The bounding box covers IFC footprints AND user areas so the viewer
always frames everything.
*/
export function buildStoreyJson(input: BuildStoreyJsonInput): StoreyDocument {
  const bbox = emptyBbox();
  for (const obj of input.objects) {
    for (const polygon of obj.polygons) {
      for (const ring of polygon) {
        extendByPoints(bbox, ring);
      }
    }
  }
  for (const area of input.userAreas) {
    extendByPoints(bbox, area.polygon);
  }
  // If a storey is empty, the box stays at infinities; collapse to (0,0,0,0)
  // so the SVG viewBox is still well-formed.
  const safeBbox = isBboxEmpty(bbox) ? { xMin: 0, yMin: 0, xMax: 0, yMax: 0 } : bbox;

  const doc: StoreyDocument = {
    schemaVersion: SCHEMA_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    generator: { name: GENERATOR_NAME, version: input.generatorVersion },
    source: input.source,
    storey: { ...input.storey, unit: input.units },
    units: input.units,
    boundingBox: safeBbox,
    cutHeightAboveStorey: input.cutHeightAboveStorey,
    objects: input.objects,
    userAreas: input.userAreas,
    ...(input.renderOptions ? { renderOptions: input.renderOptions } : {}),
  };
  // zod parse acts as a runtime assertion so callers never see a malformed doc.
  return storeyDocumentSchema.parse(doc) as StoreyDocument;
}
