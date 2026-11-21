import { z } from "zod";
import { defaultFloorplanCanvasSettings, defaultFloorplanMetadata, defaultFloorplanSettings } from "@/lib/defaults";
import { floorplanSchema, themeSchema } from "@/lib/validation/layoutSchemas";
import * as limits from "@/lib/validation/limits";
import { isValidFloorplanUuid } from "@/lib/floorplans/floorplanKeys";

/** Same rule the storage layer enforces, so bad ids fail validation with a clear message. */
const floorplanIdSchema = z.string().refine(isValidFloorplanUuid, "Invalid floorplan id (expected a v1–v5 UUID).");

const objectBase = z.object({
  id: z.string().min(1).max(100),
  x: z.number().min(-20_000).max(20_000),
  y: z.number().min(-20_000).max(20_000)
});

const rotationSchema = z.number().min(-360).max(720);
const colorSchema = z.string().max(20);

const tableObjectSchema = objectBase.extend({
  type: z.literal("table"),
  tableNumber: z.string().min(1).max(100),
  radius: z.number().min(6).max(400),
  shape: z.enum(["round", "rect"]).optional(),
  seats: z.number().int().min(0).max(60).optional(),
  width: z.number().min(6).max(10_000).optional(),
  height: z.number().min(6).max(10_000).optional(),
  rotation: rotationSchema.optional(),
  seatSpan: z.number().min(30).max(360).optional(),
  seatsOneSide: z.boolean().optional(),
  label: z.string().max(200).optional(),
  fill: colorSchema.optional()
});

const rectObjectSchema = objectBase.extend({
  type: z.literal("rect"),
  width: z.number().min(6).max(10_000),
  height: z.number().min(6).max(10_000),
  rotation: rotationSchema.optional(),
  label: z.string().max(200).optional(),
  fill: colorSchema.optional(),
  exit: z.boolean().optional()
});

const circleObjectSchema = objectBase.extend({
  type: z.literal("circle"),
  radius: z.number().min(4).max(10_000),
  label: z.string().max(200).optional(),
  fill: colorSchema.optional()
});

const textObjectSchema = objectBase.extend({
  type: z.literal("text"),
  text: z.string().max(5_000),
  fontSize: z.number().min(6).max(200),
  rotation: rotationSchema.optional(),
  bold: z.boolean().optional(),
  color: colorSchema.optional()
});

const seatingObjectSchema = objectBase.extend({
  type: z.literal("seating"),
  name: z.string().max(200).optional(),
  rows: z.number().int().min(1).max(200),
  seatsPerRow: z.number().int().min(1).max(200),
  chairWidth: z.number().min(1).max(1_000),
  chairDepth: z.number().min(1).max(1_000),
  seatSpacing: z.number().min(1).max(2_000),
  rowPitch: z.number().min(1).max(2_000),
  aisles: z.array(z.number().int().min(1).max(200)).max(50).optional(),
  aisleWidth: z.number().min(0).max(5_000).optional(),
  rotation: rotationSchema.optional(),
  removed: z.array(z.string().max(20)).max(40_000).optional(),
  wheelchair: z.array(z.string().max(20)).max(40_000).optional(),
  chairPreset: z.string().max(40).optional()
});

const canvasUnitsPerMetreSchema = z.number().min(1).max(10_000).nullable().optional();

export const floorplanPrintOptionsSchema = z.object({
  legend: z.boolean(),
  guestCounts: z.boolean(),
  colorByOccupancy: z.boolean(),
  guestListPage: z.boolean(),
  scaleBar: z.boolean(),
  fixedScale: z.number().min(1).max(5000).nullable().optional()
});

export const floorplanCanvasObjectSchema = z.discriminatedUnion("type", [
  tableObjectSchema,
  rectObjectSchema,
  circleObjectSchema,
  textObjectSchema,
  seatingObjectSchema
]);

const optionalLimit = z.number().min(0).max(100_000).nullable().optional();

export const floorplanLimitsSchema = z.object({
  minAisleM: optionalLimit,
  minSeatwayM: optionalLimit,
  maxSeatsBetweenAisles: optionalLimit,
  minFrontDistanceM: optionalLimit,
  maxCapacity: optionalLimit,
  minExitWidthM: optionalLimit
});

const theatreSettingsSchema = z.object({
  totalSeats: z.number().int().min(1).max(10_000).optional(),
  seatsPerRow: z.number().int().min(1).max(200).optional(),
  aisles: z.number().int().min(0).max(20).optional(),
  aisleWidthM: z.number().min(0).max(20).optional(),
  splitAtAisles: z.boolean().optional(),
  crossAisleEvery: z.number().int().min(0).max(200).optional(),
  chairPreset: z.string().max(40).optional(),
  seatwayM: z.number().min(0).max(5).optional(),
  frontDistanceM: z.number().min(0).max(100).optional(),
  facing: z.enum(["up", "down", "left", "right"]).optional(),
  maxRun: z.number().int().min(1).max(200).optional()
});

/** Banqueting floorplan fields plus optional stagger direction for standalone floorplan auto-layout. */
export const autoLayoutFloorplanDocSchema = floorplanSchema.extend({
  staggerAxis: z.enum(["horizontal", "vertical"]).optional(),
  tableCount: z.number().int().min(1).max(400).optional(),
  tableStyle: z.enum(["round", "cabaret", "long"]).optional(),
  roundSize: z.enum(["6ft", "5ft"]).optional(),
  seatsPerTable: z.number().int().min(1).max(60).optional(),
  topTable: z.boolean().optional(),
  useGuestNumbers: z.boolean().optional(),
  generator: z.enum(["tables", "theatre"]).optional(),
  theatre: theatreSettingsSchema.optional()
});

export const floorplanDocumentSchema = z.object({
  version: z.literal(1),
  id: floorplanIdSchema,
  // Older saves could store a blank name; load them as untitled rather than refusing them.
  name: z
    .string()
    .max(500)
    .transform((value) => value.trim() || "Untitled floorplan"),
  savedAt: z.string().min(1),
  metadata: z.object({
    title: z.string().max(limits.MAX_EVENT_NAME_CHARS),
    subtitle: z.string().max(2000)
  }),
  canvas: z.object({
    paperSize: floorplanSchema.shape.paperSize,
    orientation: floorplanSchema.shape.orientation,
    gridSize: z.number().int().min(4).max(200),
    unitsPerMetre: canvasUnitsPerMetreSchema
  }),
  objects: z.array(floorplanCanvasObjectSchema).max(5000),
  autoLayout: autoLayoutFloorplanDocSchema,
  themeSnapshot: themeSchema,
  selectedClientLogoKey: z.string().max(500).nullable().optional(),
  selectedVenueLogoKey: z.string().max(500).nullable().optional(),
  projectId: z.string().max(200).nullable().optional(),
  print: floorplanPrintOptionsSchema.optional(),
  limits: floorplanLimitsSchema.optional()
});

export const floorplanSavePayloadSchema = z.object({
  id: floorplanIdSchema.optional().nullable(),
  name: z.string().trim().min(1, "Give the floorplan a name.").max(500),
  metadata: z
    .object({
      title: z.string().max(limits.MAX_EVENT_NAME_CHARS).optional(),
      subtitle: z.string().max(2000).optional()
    })
    .optional(),
  canvas: z
    .object({
      paperSize: floorplanSchema.shape.paperSize.optional(),
      orientation: floorplanSchema.shape.orientation.optional(),
      gridSize: z.number().int().min(4).max(200).optional(),
      unitsPerMetre: canvasUnitsPerMetreSchema
    })
    .optional(),
  objects: z.array(floorplanCanvasObjectSchema).max(5000),
  autoLayout: autoLayoutFloorplanDocSchema.optional(),
  themeSnapshot: themeSchema.optional(),
  selectedClientLogoKey: z.string().max(500).nullable().optional(),
  selectedVenueLogoKey: z.string().max(500).nullable().optional(),
  projectId: z.string().max(200).nullable().optional(),
  print: floorplanPrintOptionsSchema.optional(),
  limits: floorplanLimitsSchema.optional()
});

export function withFloorplanSaveDefaults(raw: z.infer<typeof floorplanSavePayloadSchema>) {
  return {
    ...raw,
    metadata: {
      ...defaultFloorplanMetadata,
      ...(raw.metadata ?? {})
    },
    canvas: {
      ...defaultFloorplanCanvasSettings,
      ...(raw.canvas ?? {})
    },
    autoLayout: {
      ...defaultFloorplanSettings,
      ...(raw.autoLayout ?? {})
    },
    themeSnapshot: raw.themeSnapshot
  };
}

