import { create } from "zustand";
import { newId } from "../utils/id";
import {
  DEFAULT_RENDER_OPTIONS,
  type BackgroundImage,
  type IfcFileEntry,
  type ProjectContext,
  type RenderOptions,
  type SelectionTarget,
  type SiteElement,
  type SiteElementCategory,
  type StoreyDocument,
  type StoreyInfo,
  type UserArea,
  type Vec2,
} from "../types";

/**
 * Discriminated union covering every drawing/edit tool. `null` means the
 * viewer is in pan/zoom mode.
 */
export type ToolMode =
  | { kind: "area" }
  | { kind: "site"; category: SiteElementCategory }
  | { kind: "background-calibrate" };

export type AppStatus = string;

/** Wrapper for `uuid` so the store doesn't reach for the crypto module
 *  directly — the worker / test harness can swap it if needed. */
function makeId(): string {
  return newId();
}

/**
 * Number of undo steps the editor retains. 20 covers the vast majority
 * of "oops, didn't mean that" gestures without blowing memory — every
 * snapshot is a shallow copy of `storeyDocuments` + `renderOptions`,
 * not a deep clone, so 20 entries is cheap (the underlying arrays /
 * objects are shared until the next mutation creates a new one).
 */
const HISTORY_LIMIT = 20;

/** One snapshot of the document state at a point in time. */
interface HistorySnapshot {
  storeyDocuments: Record<number, StoreyDocument>;
  renderOptions: RenderOptions;
}

function snapshotOf(state: { storeyDocuments: Record<number, StoreyDocument>; renderOptions: RenderOptions }): HistorySnapshot {
  return { storeyDocuments: state.storeyDocuments, renderOptions: state.renderOptions };
}

/**
 * Push the CURRENT state onto the history past + clear the future.
 * Every mutating store action spreads the result into its `set` return
 * so a single edit always advances history by exactly one step. The
 * future is cleared because making a fresh edit invalidates any
 * redo branch — same convention as text editors.
 */
function recordHistory(state: { storeyDocuments: Record<number, StoreyDocument>; renderOptions: RenderOptions; past: HistorySnapshot[] }): {
  past: HistorySnapshot[];
  future: HistorySnapshot[];
} {
  return {
    past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
    future: [],
  };
}

export interface FloorplanState {
  accessToken: string | null;
  coreApiBaseUrl: string | null;
  project: ProjectContext | null;
  ifcFiles: IfcFileEntry[];
  selectedFile: IfcFileEntry | null;
  storeys: StoreyInfo[];
  selectedStoreyExpressId: number | null;
  availableTypes: string[];
  selectedTypes: string[];
  storeyDocuments: Record<number, StoreyDocument>;
  renderOptions: RenderOptions;
  cutHeightAboveStoreyMeters: number;
  activeTool: ToolMode | null;
  status: AppStatus;
  /**
   * Currently-selected element. Promoted to the store so sidebar lists
   * (Placed elements, User areas) can write to it, with the canvas
   * highlight following along — selection always belongs to the
   * document as a whole, not to whichever component opened the picker.
   */
  selection: SelectionTarget | null;
  /** Whether the canvas is in vertex/body drag-edit mode for the active
   *  selection. Sidebar lists flip this when the user clicks a row's
   *  "Edit" button so the canvas drops straight into the editor for
   *  that element. */
  editing: boolean;
  /**
   * Clipboard for copy/paste. Holds a snapshot of either a user area or
   * a site element along with its full geometry + style. Cmd/Ctrl+C
   * copies the current selection in; Cmd/Ctrl+V pastes a new element
   * with a fresh id, name suffixed with `(N)`, and the position offset
   * so it doesn't overlap the source.
   */
  clipboard:
    | { kind: "userArea"; area: UserArea }
    | { kind: "siteElement"; element: SiteElement }
    | null;
  /** Monotonic counter used to suffix pasted copies' names so two pastes
   *  of the same source don't collide on the area-name uniqueness check. */
  clipboardPasteCounter: number;
  setSelection: (target: SelectionTarget | null) => void;
  setEditing: (on: boolean) => void;
  /**
   * `true` whenever the currently-loaded document state is ahead of
   * whatever is on disk. Cleared on `markClean()` (called after a
   * successful save) and on `setLoadedSource()` (called after a
   * download). Every mutating store action sets it.
   */
  dirty: boolean;
  /**
   * Identity of the saved file the active document was downloaded from,
   * if any. Set by SavedFloorplans after loadStoreyDocument; consumed
   * by the Save button so re-saving an opened file lands at the same
   * fileId without prompting for a name. When null, Save opens the
   * full per-storey picker modal as before.
   */
  loadedSource:
    | { folderId: string; jsonFileId: string; jsonName: string; svgFileId: string | null }
    | null;
  markClean: () => void;
  setLoadedSource: (
    source:
      | { folderId: string; jsonFileId: string; jsonName: string; svgFileId: string | null }
      | null,
  ) => void;
  copySelection: () => void;
  /** Paste the clipboard onto the active storey. The caller passes an
   *  optional world-units offset (default 1.5 m diagonal) — usually the
   *  cursor position relative to the source. */
  pasteClipboard: (offsetWorld?: [number, number]) => void;
  /**
   * Undo / redo history. Capped at {@link HISTORY_LIMIT}. Every
   * mutating action pushes the pre-mutation snapshot onto `past` and
   * clears `future`. `undo` pops the latest past, moves the current
   * state to the front of `future`, and restores from the popped
   * snapshot. `redo` is the mirror image.
   */
  past: HistorySnapshot[];
  future: HistorySnapshot[];
  undo: () => void;
  redo: () => void;
  setAccessToken: (token: string) => void;
  setCoreApiBaseUrl: (url: string) => void;
  setProject: (project: ProjectContext | null) => void;
  setIfcFiles: (files: IfcFileEntry[]) => void;
  setSelectedFile: (file: IfcFileEntry | null) => void;
  setStoreys: (storeys: StoreyInfo[]) => void;
  setSelectedStorey: (storeyExpressId: number | null) => void;
  setAvailableTypes: (types: string[]) => void;
  setSelectedTypes: (types: string[]) => void;
  setStoreyDocument: (storeyExpressId: number, doc: StoreyDocument) => void;
  /**
   * Bulk-replace many storey documents in one history step. The
   * single-doc {@link setStoreyDocument} pushes one undo snapshot per
   * call, which makes generation of a 10-storey building leave 10
   * intermediate entries on the undo stack; this action takes one
   * snapshot and merges every supplied record at once so Cmd+Z walks
   * the whole batch back together.
   */
  setStoreyDocuments: (records: Record<number, StoreyDocument>) => void;
  resetStoreyDocuments: () => void;
  upsertUserArea: (storeyExpressId: number, area: UserArea) => void;
  deleteUserArea: (storeyExpressId: number, areaId: string) => void;
  renameUserArea: (storeyExpressId: number, areaId: string, newName: string) => boolean;
  changeUserAreaKind: (storeyExpressId: number, areaId: string, kind: "work" | "takt" | "other") => void;
  updateUserAreaStyle: (
    storeyExpressId: number,
    areaId: string,
    partial: Partial<Pick<UserArea,
      | "strokeWidthWorld"
      | "labelVisible"
      | "labelFontSizeWorld"
      | "strokeColor"
      | "fillColor"
      | "labelColor"
      | "labelPosition"
    >>,
  ) => void;
  /**
   * Replace the full vertex list of one user area. Used by the in-canvas
   * drag-edit affordances (move vertex, translate whole shape, insert
   * vertex on edge click).
   */
  updateUserAreaPolygon: (storeyExpressId: number, areaId: string, polygon: Vec2[]) => void;
  setObjectStyle: (
    ifcGuid: string,
    style: { fillColor?: string; strokeColor?: string; fillVisible?: boolean } | null,
  ) => void;
  upsertSiteElement: (storeyExpressId: number, element: SiteElement) => void;
  deleteSiteElement: (storeyExpressId: number, elementId: string) => void;
  renameSiteElement: (storeyExpressId: number, elementId: string, newName: string) => void;
  updateSiteElement: (
    storeyExpressId: number,
    elementId: string,
    partial: Partial<Pick<SiteElement,
      | "name"
      | "strokeWidthWorld"
      | "strokeColor"
      | "fillColor"
      | "labelVisible"
      | "labelFontSizeWorld"
      | "labelColor"
      | "labelPosition"
      | "iconVisible"
      | "iconScale"
    >>,
  ) => void;
  updateSiteElementGeometry: (
    storeyExpressId: number,
    elementId: string,
    partial: {
      position?: [number, number];
      rotationDeg?: number;
      sizeWorld?: number;
      radiusWorld?: number;
      widthWorld?: number;
    },
  ) => void;
  /**
   * Replace the vertex list of a polygon or polyline site element. No-ops
   * for point elements (their position is moved through
   * `updateSiteElementGeometry`).
   */
  updateSiteElementVertices: (storeyExpressId: number, elementId: string, vertices: Vec2[]) => void;
  setBackgroundImage: (storeyExpressId: number, image: BackgroundImage | null) => void;
  updateBackgroundImage: (storeyExpressId: number, partial: Partial<BackgroundImage>) => void;
  setRenderOptions: (partial: Partial<RenderOptions>) => void;
  setCutHeightAboveStorey: (meters: number) => void;
  loadStoreyDocument: (doc: StoreyDocument) => void;
  setActiveTool: (tool: ToolMode | null) => void;
  setStatus: (status: AppStatus) => void;
}

export const useFloorplanStore = create<FloorplanState>((set) => ({
  accessToken: null,
  coreApiBaseUrl: null,
  project: null,
  ifcFiles: [],
  selectedFile: null,
  storeys: [],
  selectedStoreyExpressId: null,
  availableTypes: [],
  selectedTypes: [],
  storeyDocuments: {},
  renderOptions: DEFAULT_RENDER_OPTIONS,
  cutHeightAboveStoreyMeters: 1.2,
  activeTool: null,
  status: "",
  selection: null,
  editing: false,
  clipboard: null,
  // dirty/loadedSource for the save flow. `dirty` is true whenever the
  // current document state hasn't been written back; the Toolbar's Save
  // button reads this. `loadedSource` is set when the user opens a
  // saved floorplan from the SavedFloorplans panel — re-saving then
  // takes the no-modal "direct over the same file" path.
  dirty: false,
  loadedSource: null,
  past: [],
  future: [],
  markClean: () => set({ dirty: false }),
  setLoadedSource: (source) => set({ loadedSource: source, dirty: false }),
  undo: () =>
    set((state) => {
      if (state.past.length === 0) return state;
      const previous = state.past[state.past.length - 1]!;
      return {
        past: state.past.slice(0, -1),
        future: [snapshotOf(state), ...state.future],
        storeyDocuments: previous.storeyDocuments,
        renderOptions: previous.renderOptions,
        // `dirty` stays true — we've moved away from the last save
        // regardless of direction. The Save button still surfaces the
        // change as something to write back.
        dirty: true,
      };
    }),
  redo: () =>
    set((state) => {
      if (state.future.length === 0) return state;
      const next = state.future[0]!;
      return {
        past: [...state.past, snapshotOf(state)].slice(-HISTORY_LIMIT),
        future: state.future.slice(1),
        storeyDocuments: next.storeyDocuments,
        renderOptions: next.renderOptions,
        dirty: true,
      };
    }),
  setSelection: (target) => set({ selection: target, editing: false }),
  setEditing: (on) => set({ editing: on }),
  copySelection: () =>
    set((state) => {
      // Resolve the actually-selected document object (user area or site
      // element). IFC selections are read-only and intentionally skipped.
      if (!state.selection || state.selection.kind === "ifc") return state;
      const doc =
        state.selectedStoreyExpressId != null
          ? state.storeyDocuments[state.selectedStoreyExpressId]
          : undefined;
      if (!doc) return state;
      if (state.selection.kind === "userArea") {
        const area = doc.userAreas.find((candidate) => candidate.id === state.selection!.id);
        if (!area) return state;
        return { clipboard: { kind: "userArea", area } };
      }
      const element = (doc.siteElements ?? []).find((candidate) => candidate.id === state.selection!.id);
      if (!element) return state;
      return { clipboard: { kind: "siteElement", element } };
    }),
  pasteClipboard: (offsetWorld) =>
    set((state) => {
      const clipboard = state.clipboard;
      if (!clipboard) return state;
      const storeyExpressId = state.selectedStoreyExpressId;
      if (storeyExpressId == null) return state;
      const doc = state.storeyDocuments[storeyExpressId];
      if (!doc) return state;
      const dx = offsetWorld?.[0] ?? 1.5;
      const dy = offsetWorld?.[1] ?? 1.5;
      const fresh = state.clipboardPasteCounter + 1;
      if (clipboard.kind === "userArea") {
        // Names must be unique per-area; tag pasted copies with a counter
        // so two paste actions don't collide. The user can rename later.
        const newArea: UserArea = {
          ...clipboard.area,
          id: makeId(),
          name: `${clipboard.area.name} (${fresh})`,
          polygon: clipboard.area.polygon.map((v) => [v[0] + dx, v[1] + dy] as Vec2),
          createdAt: new Date().toISOString(),
        };
        const next: StoreyDocument = { ...doc, userAreas: [...doc.userAreas, newArea] };
        return {
          storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next },
          clipboardPasteCounter: fresh,
          selection: { kind: "userArea", id: newArea.id },
        };
      }
      const src = clipboard.element;
      const newId = makeId();
      const srcGeometry = src.geometry;
      const newGeometry: SiteElement["geometry"] =
        srcGeometry.kind === "polygon"
          ? { kind: "polygon", vertices: srcGeometry.vertices.map((v) => [v[0] + dx, v[1] + dy] as Vec2) }
          : srcGeometry.kind === "polyline"
            ? {
                kind: "polyline",
                vertices: srcGeometry.vertices.map((v) => [v[0] + dx, v[1] + dy] as Vec2),
                ...(srcGeometry.widthWorld !== undefined ? { widthWorld: srcGeometry.widthWorld } : {}),
              }
            : srcGeometry.kind === "point"
              ? {
                  kind: "point",
                  position: [srcGeometry.position[0] + dx, srcGeometry.position[1] + dy] as Vec2,
                  rotationDeg: srcGeometry.rotationDeg,
                  ...(srcGeometry.sizeWorld !== undefined ? { sizeWorld: srcGeometry.sizeWorld } : {}),
                  ...(srcGeometry.radiusWorld !== undefined ? { radiusWorld: srcGeometry.radiusWorld } : {}),
                }
              : {
                  kind: "text",
                  position: [srcGeometry.position[0] + dx, srcGeometry.position[1] + dy] as Vec2,
                  rotationDeg: srcGeometry.rotationDeg,
                  sizeWorld: srcGeometry.sizeWorld,
                };
      const newElement: SiteElement = {
        ...src,
        id: newId,
        name: `${src.name} (${fresh})`,
        geometry: newGeometry,
        createdAt: new Date().toISOString(),
      };
      const next: StoreyDocument = {
        ...doc,
        siteElements: [...(doc.siteElements ?? []), newElement],
      };
      return {
        storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next },
        clipboardPasteCounter: fresh,
        selection: { kind: "siteElement", id: newId },
      };
    }),
  clipboardPasteCounter: 0,
  setAccessToken: (token) => set({ accessToken: token }),
  setCoreApiBaseUrl: (url) => set({ coreApiBaseUrl: url }),
  setProject: (project) => set({ project }),
  setIfcFiles: (files) => set({ ifcFiles: files }),
  setSelectedFile: (file) => set({ selectedFile: file }),
  setStoreys: (storeys) => set({ storeys, selectedStoreyExpressId: storeys[0]?.expressId ?? null }),
  setSelectedStorey: (storeyExpressId) => set({ selectedStoreyExpressId: storeyExpressId }),
  setAvailableTypes: (types) => set({ availableTypes: types }),
  setSelectedTypes: (types) => set({ selectedTypes: types }),
  setStoreyDocument: (storeyExpressId, doc) =>
    set((state) => ({
      ...recordHistory(state),
      dirty: true,
      storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: doc },
    })),
  setStoreyDocuments: (records) =>
    set((state) => ({
      ...recordHistory(state),
      dirty: true,
      storeyDocuments: { ...state.storeyDocuments, ...records },
    })),
  resetStoreyDocuments: () => set({ storeyDocuments: {}, dirty: false, loadedSource: null, past: [], future: [] }),
  upsertUserArea: (storeyExpressId, area) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const filtered = existing.userAreas.filter((a) => a.id !== area.id);
      const next = { ...existing, userAreas: [...filtered, area] };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  deleteUserArea: (storeyExpressId, areaId) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const next = { ...existing, userAreas: existing.userAreas.filter((a) => a.id !== areaId) };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  renameUserArea: (storeyExpressId, areaId, newName) => {
    let didRename = false;
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const trimmed = newName.trim();
      if (!trimmed) return state;
      const lower = trimmed.toLowerCase();
      const collides = existing.userAreas.some((area) => area.id !== areaId && area.name.trim().toLowerCase() === lower);
      if (collides) return state;
      const next = {
        ...existing,
        userAreas: existing.userAreas.map((area) => (area.id === areaId ? { ...area, name: trimmed } : area)),
      };
      didRename = true;
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    });
    return didRename;
  },
  changeUserAreaKind: (storeyExpressId, areaId, kind) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const next = {
        ...existing,
        userAreas: existing.userAreas.map((area) => (area.id === areaId ? { ...area, kind } : area)),
      };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  updateUserAreaStyle: (storeyExpressId, areaId, partial) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const next = {
        ...existing,
        userAreas: existing.userAreas.map((area) =>
          area.id === areaId ? { ...area, ...partial } : area,
        ),
      };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  updateUserAreaPolygon: (storeyExpressId, areaId, polygon) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      if (polygon.length < 3) return state;
      const next = {
        ...existing,
        userAreas: existing.userAreas.map((area) =>
          area.id === areaId ? { ...area, polygon } : area,
        ),
      };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  // Merge semantics — pass null to clear the entry entirely; passing a
  // partial style merges on top of whatever is already stored for that
  // ifcGuid so a caller can flip e.g. only `fillVisible` without nuking
  // the existing `fillColor`. The signature has always advertised a
  // partial; this matches that contract.
  setObjectStyle: (ifcGuid, style) =>
    set((state) => {
      const currentMap = state.renderOptions.objectStyles ?? {};
      const nextMap = { ...currentMap };
      if (style === null) {
        delete nextMap[ifcGuid];
      } else {
        nextMap[ifcGuid] = { ...(currentMap[ifcGuid] ?? {}), ...style };
      }
      const nextOptions: RenderOptions = { ...state.renderOptions, objectStyles: nextMap };
      const updatedDocs: Record<number, StoreyDocument> = {};
      for (const [key, doc] of Object.entries(state.storeyDocuments)) {
        updatedDocs[Number(key)] = { ...doc, renderOptions: nextOptions };
      }
      return { ...recordHistory(state), dirty: true, renderOptions: nextOptions, storeyDocuments: updatedDocs };
    }),
  upsertSiteElement: (storeyExpressId, element) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const currentElements = existing.siteElements ?? [];
      const filtered = currentElements.filter((candidate) => candidate.id !== element.id);
      const next: StoreyDocument = { ...existing, siteElements: [...filtered, element] };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  deleteSiteElement: (storeyExpressId, elementId) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const currentElements = existing.siteElements ?? [];
      const next: StoreyDocument = {
        ...existing,
        siteElements: currentElements.filter((candidate) => candidate.id !== elementId),
      };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  renameSiteElement: (storeyExpressId, elementId, newName) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const trimmed = newName.trim();
      if (!trimmed) return state;
      const currentElements = existing.siteElements ?? [];
      const next: StoreyDocument = {
        ...existing,
        siteElements: currentElements.map((candidate) =>
          candidate.id === elementId ? { ...candidate, name: trimmed } : candidate,
        ),
      };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  updateSiteElement: (storeyExpressId, elementId, partial) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const currentElements = existing.siteElements ?? [];
      const next: StoreyDocument = {
        ...existing,
        siteElements: currentElements.map((candidate) =>
          candidate.id === elementId ? { ...candidate, ...partial } : candidate,
        ),
      };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  updateSiteElementVertices: (storeyExpressId, elementId, vertices) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const currentElements = existing.siteElements ?? [];
      const next: StoreyDocument = {
        ...existing,
        siteElements: currentElements.map((candidate) => {
          if (candidate.id !== elementId) return candidate;
          if (candidate.geometry.kind === "polygon") {
            if (vertices.length < 3) return candidate;
            return { ...candidate, geometry: { ...candidate.geometry, vertices } };
          }
          if (candidate.geometry.kind === "polyline") {
            if (vertices.length < 2) return candidate;
            return { ...candidate, geometry: { ...candidate.geometry, vertices } };
          }
          return candidate;
        }),
      };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  updateSiteElementGeometry: (storeyExpressId, elementId, partial) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      const currentElements = existing.siteElements ?? [];
      const next: StoreyDocument = {
        ...existing,
        siteElements: currentElements.map((candidate) => {
          if (candidate.id !== elementId) return candidate;
          if (candidate.geometry.kind === "point") {
            return {
              ...candidate,
              geometry: {
                ...candidate.geometry,
                ...(partial.position ? { position: partial.position } : {}),
                ...(partial.rotationDeg !== undefined ? { rotationDeg: partial.rotationDeg } : {}),
                ...(partial.sizeWorld !== undefined ? { sizeWorld: partial.sizeWorld } : {}),
                ...(partial.radiusWorld !== undefined ? { radiusWorld: partial.radiusWorld } : {}),
              },
            };
          }
          if (candidate.geometry.kind === "polyline" && partial.widthWorld !== undefined) {
            return {
              ...candidate,
              geometry: {
                ...candidate.geometry,
                widthWorld: partial.widthWorld,
              },
            };
          }
          if (candidate.geometry.kind === "text") {
            // Text labels share the point-like move/rotate/resize
            // affordances exposed by EditOverlay, but their geometry
            // discriminant is "text" — without this branch the drag
            // handlers in EditOverlay silently no-op and the label
            // stays put on commit.
            return {
              ...candidate,
              geometry: {
                ...candidate.geometry,
                ...(partial.position ? { position: partial.position } : {}),
                ...(partial.rotationDeg !== undefined ? { rotationDeg: partial.rotationDeg } : {}),
                ...(partial.sizeWorld !== undefined ? { sizeWorld: partial.sizeWorld } : {}),
              },
            };
          }
          return candidate;
        }),
      };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  setBackgroundImage: (storeyExpressId, image) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing) return state;
      if (image === null) {
        const copy: StoreyDocument = { ...existing };
        delete copy.backgroundImage;
        return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: copy } };
      }
      const next: StoreyDocument = { ...existing, backgroundImage: image };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  updateBackgroundImage: (storeyExpressId, partial) =>
    set((state) => {
      const existing = state.storeyDocuments[storeyExpressId];
      if (!existing || !existing.backgroundImage) return state;
      const merged: BackgroundImage = { ...existing.backgroundImage, ...partial };
      const next: StoreyDocument = { ...existing, backgroundImage: merged };
      return { ...recordHistory(state), dirty: true, storeyDocuments: { ...state.storeyDocuments, [storeyExpressId]: next } };
    }),
  setRenderOptions: (partial) =>
    set((state) => {
      const next = { ...state.renderOptions, ...partial };
      const updatedDocs: Record<number, StoreyDocument> = {};
      for (const [key, doc] of Object.entries(state.storeyDocuments)) {
        updatedDocs[Number(key)] = { ...doc, renderOptions: next };
      }
      return { ...recordHistory(state), dirty: true, renderOptions: next, storeyDocuments: updatedDocs };
    }),
  setCutHeightAboveStorey: (meters) => set({ cutHeightAboveStoreyMeters: meters }),
  setActiveTool: (tool) => set({ activeTool: tool }),
  loadStoreyDocument: (doc) =>
    set((state) => {
      const storeyEntry = {
        expressId: doc.storey.expressId,
        ifcGuid: doc.storey.ifcGuid,
        name: doc.storey.name,
        longName: doc.storey.longName,
        elevation: doc.storey.elevation,
      };
      const mergedStoreys = [...state.storeys.filter((existing) => existing.expressId !== doc.storey.expressId), storeyEntry].sort(
        (a, b) => a.elevation - b.elevation,
      );
      const docWithOptions: StoreyDocument = doc.renderOptions
        ? doc
        : { ...doc, renderOptions: state.renderOptions };
      return {
        storeys: mergedStoreys,
        selectedStoreyExpressId: doc.storey.expressId,
        storeyDocuments: { ...state.storeyDocuments, [doc.storey.expressId]: docWithOptions },
        // Loading a document is the new "clean" baseline. The caller
        // (SavedFloorplans.open) follows up with setLoadedSource so the
        // direct re-save flow can find the matching file id. We also
        // reset the undo/redo history because undoing "past" the
        // load would put us back in a meaningless mixed state.
        dirty: false,
        past: [],
        future: [],
      };
    }),
  setStatus: (status) => set({ status }),
}));
