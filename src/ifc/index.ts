export { computeStoreyObjects, closeModel, openModel, pingWorker } from "./ifc-worker-client";
export type { OpenModelResult } from "./ifc-worker";
export { computeFootprint } from "./footprint";
export type { MeshFlat } from "./footprint";
export { intersectTriangleWithHorizontalPlane } from "./footprint/sectioner";
export type { Segment2D } from "./footprint/sectioner";
export { chainSegmentsIntoRings, unionPolygons } from "./footprint/polygonOps";
export { IfcEntities, ifcTypeNameForExpressType } from "./ifcEntities";
