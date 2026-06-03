import * as WebIfc from "web-ifc";

/**
 * Curated list of IFC product types the entity-type picker offers.
 *
 * Coverage targets:
 *   - **Architectural**: walls, slabs, doors, windows, columns, beams,
 *     stairs, ramps, railings, coverings, roofs, openings, spaces.
 *   - **MEP / HVAC / electrical**: pipes, ducts, cable trays, flow
 *     fittings/segments/terminals, distribution control, air terminals,
 *     energy-conversion devices (chillers, boilers, pumps, fans), valves,
 *     sensors, lighting and outlets.
 *   - **Structural reinforcement**: rebar, mesh, tendons, structural
 *     surface/curve members.
 *
 * Web-ifc exports each entity type as an uppercase numeric constant
 * (`IFCWALL`, `IFCFLOWSEGMENT`, …). We resolve them lazily so a future
 * web-ifc release that drops or renames a constant degrades to an empty
 * picker entry rather than a runtime error.
 */

interface EntityDef {
  name: string;
  id: number;
}

const NAMES: ReadonlyArray<string> = [
  // Building elements
  "IfcWall",
  "IfcWallStandardCase",
  "IfcCurtainWall",
  "IfcSlab",
  "IfcRoof",
  "IfcColumn",
  "IfcBeam",
  "IfcDoor",
  "IfcWindow",
  "IfcStair",
  "IfcStairFlight",
  "IfcRamp",
  "IfcRampFlight",
  "IfcRailing",
  "IfcCovering",
  "IfcMember",
  "IfcPlate",
  "IfcFooting",
  "IfcPile",
  "IfcOpeningElement",
  "IfcSpace",
  "IfcChimney",
  "IfcShadingDevice",
  "IfcBuildingElementProxy",

  // Furnishings
  "IfcFurnishingElement",
  "IfcFurniture",
  "IfcSystemFurnitureElement",

  // Sanitary / MEP terminals
  "IfcSanitaryTerminal",
  "IfcAirTerminal",
  "IfcAirTerminalBox",
  "IfcWasteTerminal",
  "IfcFireSuppressionTerminal",

  // MEP — generic distribution / flow
  "IfcDistributionElement",
  "IfcDistributionFlowElement",
  "IfcDistributionControlElement",
  "IfcDistributionChamberElement",
  "IfcDistributionPort",
  "IfcFlowSegment",
  "IfcFlowFitting",
  "IfcFlowTerminal",
  "IfcFlowController",
  "IfcFlowMovingDevice",
  "IfcFlowStorageDevice",
  "IfcFlowTreatmentDevice",

  // Pipes + ducts + cables
  "IfcPipeSegment",
  "IfcPipeFitting",
  "IfcDuctSegment",
  "IfcDuctFitting",
  "IfcDuctSilencer",
  "IfcCableSegment",
  "IfcCableFitting",
  "IfcCableCarrierSegment",
  "IfcCableCarrierFitting",
  "IfcJunctionBox",

  // Energy conversion + controls
  "IfcEnergyConversionDevice",
  "IfcChiller",
  "IfcBoiler",
  "IfcCondenser",
  "IfcCoolingTower",
  "IfcEvaporator",
  "IfcHeatExchanger",
  "IfcPump",
  "IfcFan",
  "IfcCompressor",
  "IfcValve",
  "IfcDamper",
  "IfcFilter",
  "IfcTank",

  // Electrical
  "IfcLightFixture",
  "IfcOutlet",
  "IfcSwitchingDevice",
  "IfcElectricAppliance",
  "IfcElectricGenerator",
  "IfcElectricMotor",
  "IfcElectricFlowStorageDevice",
  "IfcMotorConnection",
  "IfcTransformer",
  "IfcProtectiveDevice",
  "IfcProtectiveDeviceTrippingUnit",

  // Sensing & alarms
  "IfcSensor",
  "IfcAlarm",
  "IfcController",
  "IfcActuator",

  // Communication
  "IfcCommunicationsAppliance",
  "IfcAudioVisualAppliance",

  // Structural / reinforcement
  "IfcReinforcingBar",
  "IfcReinforcingMesh",
  "IfcTendon",
  "IfcTendonAnchor",
  "IfcStructuralCurveMember",
  "IfcStructuralSurfaceMember",
];

function constantId(name: string): number | undefined {
  const map = WebIfc as unknown as Record<string, unknown>;
  const upper = name.toUpperCase();
  const value = map[upper];
  return typeof value === "number" ? value : undefined;
}

export const IfcEntities: ReadonlyArray<EntityDef> = NAMES.flatMap((name) => {
  const id = constantId(name);
  if (id === undefined) return [];
  return [{ name, id }];
});

export function ifcTypeNameForExpressType(expressType: number): string | null {
  for (const def of IfcEntities) {
    if (def.id === expressType) return def.name;
  }
  return null;
}
