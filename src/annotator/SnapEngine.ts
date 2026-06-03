import RBush from "rbush";
import type { StoreyDocument, UserArea, Vec2 } from "../types";

/*
Snap targets:
  - vertices of IFC objects on this storey
  - line segments (edges) of IFC objects on this storey
  - vertices of any existing user areas
  - segments of any existing user areas
  - vertices and segments of every drawn site element on the storey:
      polygon  → closed ring (last connects to first)
      polyline → open chain  (last does NOT connect to first; a fence
                  the user drew with 4 corners snaps to those 4
                  corners and the 3 segments between them, never to
                  the phantom segment from last → first)
      point    → the single position is offered as a vertex snap

The user picks a query point in world coordinates and a radius in world
coordinates (the caller converts pixel radius -> world units via the active
SVG viewport transform). We return the nearest candidate, or null if nothing
is within the radius.

Vertex snaps beat edge snaps when both are inside the radius.
*/

export type SnapKind = "ifc-vertex" | "ifc-edge" | "user-vertex" | "user-edge";

export interface SnapResult {
  kind: SnapKind;
  point: Vec2;
  distance: number;
  sourceId?: string;
}

interface VertexIndexEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  x: number;
  y: number;
  kind: SnapKind;
  sourceId?: string;
}

interface EdgeIndexEntry {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  ax: number;
  ay: number;
  bx: number;
  by: number;
  kind: SnapKind;
  sourceId?: string;
}

class VertexTree extends RBush<VertexIndexEntry> {}
class EdgeTree extends RBush<EdgeIndexEntry> {}

/**
 * R-tree backed nearest-snap engine shared by the polygon, polyline,
 * point and text tools. Construct one instance per storey via
 * {@link SnapEngine.fromStorey}; rebuild it via {@link SnapEngine.rebuild}
 * whenever the underlying `StoreyDocument` mutates (vertex drag,
 * polygon insert, site element delete, …) so the spatial index stays
 * in sync with what the user sees.
 */
export class SnapEngine {
  private readonly vertexTree = new VertexTree();
  private readonly edgeTree = new EdgeTree();

  static fromStorey(doc: StoreyDocument, includeUserAreas: boolean = true): SnapEngine {
    const engine = new SnapEngine();
    engine.indexDoc(doc, includeUserAreas);
    return engine;
  }

  /**
   * Index just one user area's polygon. Useful when the caller knows
   * exactly which area changed and wants to skip the full rebuild.
   */
  indexUserArea(area: UserArea): void {
    this.indexRing(area.polygon, "user-vertex", "user-edge", area.id);
  }

  /**
   * Drop both R-trees and re-index from scratch against the supplied
   * document. Call after any mutation (insert / delete / vertex drag)
   * so subsequent {@link findNearest} calls see the current geometry.
   */
  rebuild(doc: StoreyDocument): void {
    this.vertexTree.clear();
    this.edgeTree.clear();
    this.indexDoc(doc, true);
  }

  /**
   * Walk every snap source (IFC + user areas + every site element) and
   * push its vertices / edges into the R-tree. Polygons close (wrap
   * last → first); polylines stay open; points contribute just the
   * single position as a vertex.
   */
  private indexDoc(doc: StoreyDocument, includeUserAreas: boolean): void {
    for (const obj of doc.objects) {
      for (const polygon of obj.polygons) {
        for (const ring of polygon) {
          this.indexRing(ring, "ifc-vertex", "ifc-edge", obj.ifcGuid);
        }
      }
    }
    if (includeUserAreas) {
      for (const area of doc.userAreas) {
        this.indexRing(area.polygon, "user-vertex", "user-edge", area.id);
      }
    }
    for (const element of doc.siteElements ?? []) {
      if (element.geometry.kind === "polygon") {
        this.indexRing(element.geometry.vertices, "user-vertex", "user-edge", element.id);
        continue;
      }
      if (element.geometry.kind === "polyline") {
        this.indexChain(element.geometry.vertices, "user-vertex", "user-edge", element.id);
        continue;
      }
      // Point: a single vertex with no edges. The position itself is
      // the only snap candidate the element offers.
      this.indexVertex(element.geometry.position, "user-vertex", element.id);
    }
  }

  /**
   * Query for the closest snap candidate to `(x, y)` within `radius`,
   * all in world units. Returns `null` when nothing is within the
   * radius. When both a vertex and an edge are inside the radius the
   * vertex wins the tiebreak so corners feel "sticky" — see the
   * `radius * 0.5` short-circuit below.
   */
  findNearest(x: number, y: number, radius: number): SnapResult | null {
    const bbox = { minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius };
    const vertexCandidates = this.vertexTree.search(bbox);
    let best: SnapResult | null = null;
    for (const v of vertexCandidates) {
      const dx = v.x - x;
      const dy = v.y - y;
      const dist = Math.hypot(dx, dy);
      if (dist > radius) continue;
      if (!best || dist < best.distance) {
        best = { kind: v.kind, point: [v.x, v.y], distance: dist, ...(v.sourceId ? { sourceId: v.sourceId } : {}) };
      }
    }
    if (best && best.distance < radius * 0.5) return best;

    const edgeCandidates = this.edgeTree.search(bbox);
    for (const e of edgeCandidates) {
      const projected = projectPointOntoSegment(x, y, e.ax, e.ay, e.bx, e.by);
      const dist = Math.hypot(projected[0] - x, projected[1] - y);
      if (dist > radius) continue;
      if (!best || dist < best.distance) {
        best = { kind: e.kind, point: projected, distance: dist, ...(e.sourceId ? { sourceId: e.sourceId } : {}) };
      }
    }
    return best;
  }

  private indexRing(ring: ReadonlyArray<Vec2>, vertexKind: SnapKind, edgeKind: SnapKind, sourceId?: string): void {
    if (ring.length < 2) return;
    for (let i = 0; i < ring.length; i++) {
      const point = ring[i];
      if (!point) continue;
      this.indexVertex(point, vertexKind, sourceId);
      const next = ring[(i + 1) % ring.length];
      if (!next) continue;
      this.indexEdge(point, next, edgeKind, sourceId);
    }
  }

  /**
   * Open-chain variant of indexRing: drops the implicit last → first
   * edge so a polyline doesn't offer a phantom snap target on the
   * "fake closure" segment a closed-ring index would emit.
   */
  private indexChain(chain: ReadonlyArray<Vec2>, vertexKind: SnapKind, edgeKind: SnapKind, sourceId?: string): void {
    if (chain.length < 1) return;
    for (let i = 0; i < chain.length; i++) {
      const point = chain[i];
      if (!point) continue;
      this.indexVertex(point, vertexKind, sourceId);
      if (i + 1 >= chain.length) continue;
      const next = chain[i + 1];
      if (!next) continue;
      this.indexEdge(point, next, edgeKind, sourceId);
    }
  }

  private indexVertex(point: Vec2, kind: SnapKind, sourceId?: string): void {
    const entry: VertexIndexEntry = {
      minX: point[0],
      minY: point[1],
      maxX: point[0],
      maxY: point[1],
      x: point[0],
      y: point[1],
      kind,
    };
    if (sourceId !== undefined) entry.sourceId = sourceId;
    this.vertexTree.insert(entry);
  }

  private indexEdge(a: Vec2, b: Vec2, kind: SnapKind, sourceId?: string): void {
    const entry: EdgeIndexEntry = {
      minX: Math.min(a[0], b[0]),
      minY: Math.min(a[1], b[1]),
      maxX: Math.max(a[0], b[0]),
      maxY: Math.max(a[1], b[1]),
      ax: a[0],
      ay: a[1],
      bx: b[0],
      by: b[1],
      kind,
    };
    if (sourceId !== undefined) entry.sourceId = sourceId;
    this.edgeTree.insert(entry);
  }
}

export function projectPointOntoSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): Vec2 {
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return [ax, ay];
  let t = ((px - ax) * dx + (py - ay) * dy) / lenSq;
  if (t < 0) t = 0;
  else if (t > 1) t = 1;
  return [ax + t * dx, ay + t * dy];
}
