import type { IfcAPI } from "web-ifc";
import type { IfcUnit } from "../types";

/*
Helpers around IfcAPI.GetLine attribute access. web-ifc returns attribute
objects of the shape `{ value: T }` (e.g. `Name: { value: "Wall-1" }`); we
normalize them to plain JS strings/numbers.
*/

type WebIfcAttr = { value: unknown } | null | undefined;

export function readString(attr: WebIfcAttr): string {
  if (attr && typeof attr === "object" && "value" in attr) {
    const v = (attr as { value: unknown }).value;
    if (v == null) return "";
    return String(v);
  }
  return "";
}

export function readOptionalString(attr: WebIfcAttr): string | null {
  if (attr && typeof attr === "object" && "value" in attr) {
    const v = (attr as { value: unknown }).value;
    if (v == null) return null;
    const s = String(v);
    return s.length > 0 ? s : null;
  }
  return null;
}

export function readNumber(attr: WebIfcAttr, fallback = 0): number {
  if (attr && typeof attr === "object" && "value" in attr) {
    const v = (attr as { value: unknown }).value;
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.length > 0) {
      const parsed = Number(v);
      if (Number.isFinite(parsed)) return parsed;
    }
  }
  return fallback;
}

export interface IfcObjectAttributes {
  ifcGuid: string;
  name: string;
  longName: string | null;
}

export function readObjectAttributes(api: IfcAPI, modelId: number, expressId: number): IfcObjectAttributes {
  const line = api.GetLine(modelId, expressId) as Record<string, WebIfcAttr>;
  return {
    ifcGuid: readString(line["GlobalId"]),
    name: readString(line["Name"]),
    longName: readOptionalString(line["LongName"] ?? line["ObjectType"] ?? null),
  };
}

/*
Read project length unit. Walks IfcProject -> UnitsInContext -> Units, finds
the IfcSIUnit / IfcConversionBasedUnit with UnitType = LENGTHUNIT, and
normalizes to one of our IfcUnit values.
*/
export function readLengthUnit(api: IfcAPI, modelId: number): IfcUnit {
  const projects = api.GetLineIDsWithType(modelId, /* IFCPROJECT */ 103090709) as { size: () => number; get: (i: number) => number } | unknown;
  const ids = toArrayOfIds(projects);
  if (ids.length === 0) return "unknown";
  const projectLine = api.GetLine(modelId, ids[0]!, true) as Record<string, unknown>;
  const unitsCtx = projectLine["UnitsInContext"] as Record<string, unknown> | undefined;
  const unitsList = unitsCtx?.["Units"] as Array<Record<string, unknown>> | undefined;
  if (!unitsList) return "unknown";
  for (const unit of unitsList) {
    const unitType = readString(unit["UnitType"] as WebIfcAttr);
    if (unitType !== "LENGTHUNIT") continue;
    const name = readString(unit["Name"] as WebIfcAttr).toUpperCase();
    const prefix = readString(unit["Prefix"] as WebIfcAttr).toUpperCase();
    if (name === "METRE" || name === "METER") {
      if (prefix === "MILLI") return "mm";
      if (prefix === "CENTI") return "cm";
      return "m";
    }
    if (name === "FOOT") return "ft";
    if (name === "INCH") return "in";
  }
  return "unknown";
}

function toArrayOfIds(input: unknown): number[] {
  if (!input) return [];
  if (Array.isArray(input)) return input as number[];
  const obj = input as { size?: () => number; get?: (i: number) => number };
  if (typeof obj.size === "function" && typeof obj.get === "function") {
    const out: number[] = [];
    const n = obj.size();
    for (let i = 0; i < n; i++) out.push(obj.get(i));
    return out;
  }
  return [];
}

export { toArrayOfIds };
