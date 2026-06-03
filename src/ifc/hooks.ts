import { useCallback, useEffect, useRef } from "react";
import {
  computeStoreyObjects,
  openModel as openModelInWorker,
  closeModel as closeModelInWorker,
} from "./ifc-worker-client";
import { buildStoreyJson } from "../generator/jsonBuilder";
import { useFloorplanStore } from "../state/floorplanStore";
import { downloadIfcArrayBuffer } from "../trimble/coreApiClient";
import { en } from "../i18n/en";
import { APP_VERSION } from "../version";
import { DEFAULT_RENDER_OPTIONS, type IfcUnit, type RenderOptions, type StoreyDocument } from "../types";

type ProjectionAxis = RenderOptions["projectionAxis"];

/**
 * React hook that wires the file browser → worker → generator → store.
 *
 * The hook owns one worker handle at a time. Selecting a different IFC
 * closes the previous handle to release the parsed model from memory.
 *
 * Generation derives sensible default render values (stroke width, label
 * font size) from the source IFC's unit so the in-app preview is readable
 * regardless of whether the file is in metres or millimetres.
 */
export function useIfcLoader(): {
  generateFloorplans: (cutOffsetMeters: number) => Promise<void>;
} {
  const accessToken = useFloorplanStore((s) => s.accessToken);
  const coreApiBaseUrl = useFloorplanStore((s) => s.coreApiBaseUrl);
  const project = useFloorplanStore((s) => s.project);
  const selectedFile = useFloorplanStore((s) => s.selectedFile);
  const storeys = useFloorplanStore((s) => s.storeys);
  const selectedTypes = useFloorplanStore((s) => s.selectedTypes);
  const setStoreys = useFloorplanStore((s) => s.setStoreys);
  const setAvailableTypes = useFloorplanStore((s) => s.setAvailableTypes);
  const setStatus = useFloorplanStore((s) => s.setStatus);
  const setStoreyDocuments = useFloorplanStore((s) => s.setStoreyDocuments);
  const setRenderOptions = useFloorplanStore((s) => s.setRenderOptions);
  const resetStoreyDocuments = useFloorplanStore((s) => s.resetStoreyDocuments);

  const currentHandleRef = useRef<string | null>(null);
  const unitRef = useRef<IfcUnit>("unknown");
  const schemaRef = useRef<string | null>(null);
  const detectedUpAxisRef = useRef<ProjectionAxis>("z");

  // Whenever a new file is selected, download + parse it.
  useEffect(() => {
    if (!selectedFile || !accessToken || !coreApiBaseUrl) return;
    let cancelled = false;
    async function load(): Promise<void> {
      if (!selectedFile || !accessToken || !coreApiBaseUrl) return;
      setStatus(en.status.loadingIfc);
      const buffer = await downloadIfcArrayBuffer(
        accessToken,
        coreApiBaseUrl,
        selectedFile.fileId,
        selectedFile.versionId,
      );
      if (cancelled) return;
      if (currentHandleRef.current) {
        await closeModelInWorker(currentHandleRef.current);
        currentHandleRef.current = null;
      }
      setStatus(en.status.parsingIfc);
      const result = await openModelInWorker(buffer);
      if (cancelled) return;
      currentHandleRef.current = result.handle;
      unitRef.current = result.unit;
      schemaRef.current = result.schema;
      detectedUpAxisRef.current = result.detectedUpAxis;
      setStoreys(result.storeys);
      setAvailableTypes(result.typeCatalog.map((t) => t.ifcTypeName));
      resetStoreyDocuments();
      // Adjust the global render options so the in-app preview looks
      // sensible regardless of IFC unit (mm vs m): label and stroke sizes
      // are stored in world units, so they must scale with the unit.
      const unitScale = unitScaleMetresPerWorldUnit(result.unit);
      const fontSizeWorld = 0.25 / unitScale;
      const strokeWidthWorld = 0.05 / unitScale;
      setRenderOptions({
        fontSizeWorld,
        strokeWidthWorld,
        projectionAxis: result.detectedUpAxis,
      });
      setStatus(en.status.ready);
    }
    void load().catch((err) => {
      console.error(err);
      setStatus(en.status.error);
    });
    return () => {
      cancelled = true;
    };
  }, [accessToken, coreApiBaseUrl, resetStoreyDocuments, selectedFile, setAvailableTypes, setRenderOptions, setStatus, setStoreys]);

  const generateFloorplans = useCallback(
    async (cutOffsetMeters: number): Promise<void> => {
      const handle = currentHandleRef.current;
      if (!handle || !selectedFile || !project || selectedTypes.length === 0) return;
      setStatus(en.status.computingFootprints);
      const storeRenderOptions = useFloorplanStore.getState().renderOptions;
      const renderOptions: RenderOptions = {
        ...DEFAULT_RENDER_OPTIONS,
        ...storeRenderOptions,
        projectionAxis: detectedUpAxisRef.current,
      };
      // Collect every storey's freshly-built document into one record so
      // the store commit is a single history step — Cmd+Z then unwinds
      // the whole generation in one tap instead of one storey at a time.
      const generated: Record<number, StoreyDocument> = {};
      for (const storey of storeys) {
        const objects = await computeStoreyObjects(handle, storey.expressId, selectedTypes, cutOffsetMeters);
        const document = buildStoreyJson({
          generatorVersion: APP_VERSION,
          source: {
            fileId: selectedFile.fileId,
            versionId: selectedFile.versionId,
            fileName: selectedFile.name,
            ifcSchema: schemaRef.current,
            projectId: project.id,
            projectName: project.name,
          },
          storey,
          units: unitRef.current,
          objects,
          userAreas: [],
          cutHeightAboveStorey: cutOffsetMeters,
          renderOptions,
        });
        generated[storey.expressId] = document;
      }
      setStoreyDocuments(generated);
      setStatus(en.status.ready);
    },
    [project, selectedFile, selectedTypes, setStatus, setStoreyDocuments, storeys],
  );

  return { generateFloorplans };
}

/**
 * Convert one IFC world unit into metres. Used to scale the human-friendly
 * default font / stroke sizes (which we authored in metres) into whatever
 * unit the source file actually uses.
 */
function unitScaleMetresPerWorldUnit(unit: IfcUnit): number {
  switch (unit) {
    case "m":
      return 1;
    case "cm":
      return 0.01;
    case "mm":
      return 0.001;
    case "ft":
      return 0.3048;
    case "in":
      return 0.0254;
    case "unknown":
    default:
      return 1;
  }
}
