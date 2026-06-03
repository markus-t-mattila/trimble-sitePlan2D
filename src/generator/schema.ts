import { z } from "zod";
import { isValidBackgroundImageHref, isValidColor } from "../utils/colorValidation";

/*
On-disk schema for the per-storey JSON. Validates anything we WRITE and
anything we READ BACK (e.g. when re-opening a previously generated JSON to
re-render in the viewer or to append more user areas).

Schema version follows semver. Bump major on any breaking change.
*/

const vec2Schema = z.tuple([z.number(), z.number()]);
const ringSchema = z.array(vec2Schema).min(3);
const polygonSchema = z.array(ringSchema).min(1);

// Every colour field flowing into the renderer must pass this gate.
// See utils/colorValidation.ts for the attack chain this defends.
const colorSchema = z.string().refine(isValidColor, {
  message: "invalid colour token (allowed: #rgb/#rrggbb/#rrggbbaa, rgb(), rgba(), transparent, currentColor, basic names)",
});

const backgroundHrefSchema = z.string().refine(isValidBackgroundImageHref, {
  message: "background image must be a data:image/(png|jpeg|webp|gif);base64 URL",
});

export const ifcUnitSchema = z.enum(["m", "mm", "cm", "ft", "in", "unknown"]);

export const storeyObjectSchema = z.object({
  ifcGuid: z.string().min(1),
  ifcType: z.string().min(1),
  name: z.string(),
  longName: z.string().nullable(),
  polygons: z.array(polygonSchema),
});

const labelPositionSchema = z.enum(["center", "above", "below", "left", "right"]);

export const userAreaSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  kind: z.enum(["work", "takt", "other"]),
  polygon: z.array(vec2Schema).min(3),
  createdAt: z.string().datetime({ offset: true }),
  strokeWidthWorld: z.number().positive().optional(),
  labelVisible: z.boolean().optional(),
  labelFontSizeWorld: z.number().positive().optional(),
  strokeColor: colorSchema.optional(),
  fillColor: colorSchema.optional(),
  labelColor: colorSchema.optional(),
  labelPosition: labelPositionSchema.optional(),
});

export const siteElementCategorySchema = z.enum([
  "driving-route",
  "fence",
  "gate",
  "crane",
  "site-cabin",
  "waste-container",
  "elevator",
  "entrance",
  "electrical-cabinet",
  "demolition-area",
  "first-aid",
  "parking",
  "loading-area",
  "direction-arrow",
  "text-label",
]);

export const siteElementGeometrySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("polygon"), vertices: z.array(vec2Schema).min(3) }),
  z.object({
    kind: z.literal("polyline"),
    vertices: z.array(vec2Schema).min(2),
    widthWorld: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal("point"),
    position: vec2Schema,
    rotationDeg: z.number(),
    sizeWorld: z.number().positive().optional(),
    radiusWorld: z.number().positive().optional(),
  }),
  z.object({
    kind: z.literal("text"),
    position: vec2Schema,
    rotationDeg: z.number(),
    sizeWorld: z.number().positive(),
  }),
]);

export const siteElementSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  category: siteElementCategorySchema,
  geometry: siteElementGeometrySchema,
  createdAt: z.string().datetime({ offset: true }),
  strokeWidthWorld: z.number().positive().optional(),
  strokeColor: z.string().optional(),
  fillColor: z.string().optional(),
  labelVisible: z.boolean().optional(),
  labelFontSizeWorld: z.number().positive().optional(),
  labelColor: z.string().optional(),
  labelPosition: labelPositionSchema.optional(),
  iconVisible: z.boolean().optional(),
  iconScale: z.number().positive().optional(),
});

export const backgroundImageSchema = z.object({
  href: backgroundHrefSchema,
  origin: vec2Schema,
  widthWorld: z.number().positive(),
  heightWorld: z.number().positive(),
  rotationDeg: z.number(),
  opacity: z.number().min(0).max(1),
  pixelWidth: z.number().int().nonnegative(),
  pixelHeight: z.number().int().nonnegative(),
  locked: z.boolean(),
});

export const storeyDocumentSchema = z.object({
  schemaVersion: z.literal("1.0.0"),
  generatedAt: z.string().datetime({ offset: true }),
  generator: z.object({ name: z.string(), version: z.string() }),
  source: z.object({
    fileId: z.string(),
    versionId: z.string(),
    fileName: z.string(),
    ifcSchema: z.string().nullable(),
    projectId: z.string(),
    projectName: z.string(),
  }),
  storey: z.object({
    expressId: z.number().int().nonnegative(),
    ifcGuid: z.string().min(1),
    name: z.string(),
    longName: z.string().nullable(),
    elevation: z.number(),
    unit: ifcUnitSchema,
  }),
  units: ifcUnitSchema,
  boundingBox: z.object({
    xMin: z.number(),
    yMin: z.number(),
    xMax: z.number(),
    yMax: z.number(),
  }),
  cutHeightAboveStorey: z.number(),
  objects: z.array(storeyObjectSchema),
  userAreas: z.array(userAreaSchema),
  siteElements: z.array(siteElementSchema).optional(),
  backgroundImage: backgroundImageSchema.optional(),
  renderOptions: z
    .object({
      labelSource: z.enum(["none", "name", "longName"]),
      userAreaLabelSource: z.enum(["none", "name"]),
      fontSizeWorld: z.number().positive(),
      fillStyle: z.enum(["none", "perType", "single", "byName"]),
      singleFillColor: colorSchema,
      strokeWidthWorld: z.number().positive().default(0.05),
      typeStyles: z.record(z.object({ fillColor: colorSchema.optional(), strokeColor: colorSchema.optional() })),
      objectStyles: z
        .record(
          z.object({
            fillColor: colorSchema.optional(),
            strokeColor: colorSchema.optional(),
            fillVisible: z.boolean().optional(),
          }),
        )
        .default({}),
      projectionAxis: z.enum(["x", "y", "z"]).default("z"),
    })
    .optional(),
});

export type StoreyDocumentValidated = z.infer<typeof storeyDocumentSchema>;
