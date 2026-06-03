/// <reference lib="webworker" />

import * as Comlink from "comlink";
import type { IfcAPI } from "web-ifc";
import { getIfcApi } from "./singleton";
import { ifcTypeNameForExpressType } from "./ifcEntities";
import { readLengthUnit, readObjectAttributes } from "./attributes";
import { resolveStoreysAndContainment, type StoreyContainment } from "./storeyResolver";
import { productIdsForStoreyAndTypes, scanTypeCatalog, type TypeCount } from "./typeCatalog";
import { computeFootprint, type ProjectionAxis } from "./footprint";
import type { IfcUnit, Polygon, StoreyInfo, StoreyObject } from "../types";

/*
Web Worker that owns the IfcAPI singleton. The main thread never touches
web-ifc directly. Comlink wraps the IfcWorkerApi object so the main thread can
call methods as if they were async functions in-process.

A worker can hold multiple open models keyed by a handle string. Each handle
holds the IfcAPI modelId + its resolved containment + type catalog so
subsequent calls don't recompute them.
*/

interface OpenHandle {
  modelId: number;
  containment: StoreyContainment;
  typeCatalog: TypeCount[];
  unit: IfcUnit;
  schema: string | null;
  /** Auto-detected world up-axis so all cuts produce a top-down plan view. */
  detectedUpAxis: ProjectionAxis;
}

interface FlatMeshShape {
  geometries: {
    size: () => number;
    get: (i: number) => { geometryExpressID: number; flatTransformation: ArrayLike<number> };
  };
}

interface GeometryShape {
  GetVertexData: () => number;
  GetVertexDataSize: () => number;
  GetIndexData: () => number;
  GetIndexDataSize: () => number;
}

interface IfcApiExt {
  GetFlatMesh: (modelId: number, expressId: number) => FlatMeshShape;
  GetGeometry: (modelId: number, geometryExpressID: number) => GeometryShape;
  GetVertexArray: (ptr: number, size: number) => Float32Array;
  GetIndexArray: (ptr: number, size: number) => Uint32Array;
  GetLineType?: (modelId: number, expressId: number) => number;
}

const openHandles = new Map<string, OpenHandle>();
let modelOpenCount = 0;

async function getOrInitApi(): Promise<IfcAPI> {
  return getIfcApi();
}

function nextHandle(): string {
  return `m-${++modelOpenCount}`;
}

export interface OpenModelResult {
  handle: string;
  storeys: StoreyInfo[];
  typeCatalog: Array<{ ifcTypeName: string; totalCount: number; storeyCounts: Array<[number, number]> }>;
  unit: IfcUnit;
  schema: string | null;
  detectedUpAxis: ProjectionAxis;
}

const ifcWorkerApi = {
  async ping(): Promise<"pong"> {
    return "pong";
  },

  async openModel(buffer: ArrayBuffer): Promise<OpenModelResult> {
    const api = await getOrInitApi();
    const uint8 = new Uint8Array(buffer);
    const modelId = api.OpenModel(uint8, { COORDINATE_TO_ORIGIN: false });
    const containment = resolveStoreysAndContainment(api, modelId);
    const typeCatalog = scanTypeCatalog(api, modelId, containment);
    const unit = readLengthUnit(api, modelId);
    const schema = safeReadSchema(api, modelId);
    const detectedUpAxis = detectUpAxis(api, modelId, containment);
    const handle = nextHandle();
    openHandles.set(handle, { modelId, containment, typeCatalog, unit, schema, detectedUpAxis });
    return {
      handle,
      storeys: Array.from(containment.storeysByExpressId.values()).sort((a, b) => a.elevation - b.elevation),
      typeCatalog: typeCatalog.map((t) => ({
        ifcTypeName: t.ifcTypeName,
        totalCount: t.totalCount,
        storeyCounts: Array.from(t.countByStorey.entries()),
      })),
      unit,
      schema,
      detectedUpAxis,
    };
  },

  async computeStoreyObjects(
    handle: string,
    storeyExpressId: number,
    ifcTypeNames: string[],
    cutOffset: number,
    onProgress?: (fraction: number) => void,
  ): Promise<StoreyObject[]> {
    const open = openHandles.get(handle);
    if (!open) throw new Error(`Unknown model handle: ${handle}`);
    const api = await getOrInitApi();
    const storey = open.containment.storeysByExpressId.get(storeyExpressId);
    if (!storey) throw new Error(`Unknown storey expressId: ${storeyExpressId}`);
    // Always render top-down: cut at constant `up-axis` value =
    // storey.elevation + cutOffset, then project to the other two world axes.
    const cutPosition = storey.elevation + cutOffset;
    const typeSet = new Set(ifcTypeNames);
    const products = productIdsForStoreyAndTypes(api, open.modelId, open.containment, storeyExpressId, typeSet);

    const results: StoreyObject[] = [];
    let processed = 0;
    const total = products.size;
    for (const [productExpressId, fallbackTypeName] of products) {
      const polygons = await computeProductFootprint(api, open.modelId, productExpressId, cutPosition, open.detectedUpAxis);
      if (polygons.length === 0) {
        processed++;
        onProgress?.(processed / Math.max(1, total));
        continue;
      }
      const attrs = readObjectAttributes(api, open.modelId, productExpressId);
      const expressType = (api as unknown as IfcApiExt).GetLineType?.(open.modelId, productExpressId);
      const ifcType =
        expressType !== undefined ? ifcTypeNameForExpressType(expressType) ?? fallbackTypeName : fallbackTypeName;
      results.push({
        ifcGuid: attrs.ifcGuid,
        ifcType,
        name: attrs.name,
        longName: attrs.longName,
        polygons,
      });
      processed++;
      onProgress?.(processed / Math.max(1, total));
    }
    return results;
  },

  async closeModel(handle: string): Promise<void> {
    const open = openHandles.get(handle);
    if (!open) return;
    const api = await getOrInitApi();
    api.CloseModel(open.modelId);
    openHandles.delete(handle);
  },
};

async function computeProductFootprint(
  api: IfcAPI,
  modelId: number,
  expressId: number,
  cutPosition: number,
  upAxis: ProjectionAxis,
): Promise<Polygon[]> {
  const apiExt = api as unknown as IfcApiExt;
  let flatMesh: FlatMeshShape;
  try {
    flatMesh = apiExt.GetFlatMesh(modelId, expressId);
  } catch {
    return [];
  }
  const polygons: Polygon[] = [];
  const geomCount = flatMesh.geometries.size();
  for (let i = 0; i < geomCount; i++) {
    const meshGeom = flatMesh.geometries.get(i);
    const geom = apiExt.GetGeometry(modelId, meshGeom.geometryExpressID);
    const vertexData = apiExt.GetVertexArray(geom.GetVertexData(), geom.GetVertexDataSize());
    const indexData = apiExt.GetIndexArray(geom.GetIndexData(), geom.GetIndexDataSize());
    const result = computeFootprint({
      mesh: { vertexFloats: vertexData, vertexStride: 6, indices: indexData },
      placement: meshGeom.flatTransformation,
      cutPosition,
      upAxis,
    });
    for (const polygon of result) polygons.push(polygon);
  }
  return polygons;
}

/**
 * Standard IFC convention puts Z up. We translate web-ifc's Three.js-style
 * vertex output back into the IFC frame inside `computeFootprint`, so the
 * worker can safely return `"z"` here and the sectioner / cursor overlay
 * will all line up with what BIM tooling shows. This function is kept as a
 * named export so a future "non-standard convention" override can plug in.
 */
function detectUpAxis(_api: IfcAPI, _modelId: number, _containment: StoreyContainment): ProjectionAxis {
  return "z";
}

function safeReadSchema(api: IfcAPI, modelId: number): string | null {
  const apiExt = api as unknown as { GetModelSchema?: (modelId: number) => string };
  try {
    const raw = apiExt.GetModelSchema?.(modelId);
    return raw ? String(raw) : null;
  } catch {
    return null;
  }
}

export type IfcWorkerApi = typeof ifcWorkerApi;

Comlink.expose(ifcWorkerApi);
