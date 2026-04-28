import { z } from "zod";
import { defaultFloorplanCanvasSettings, defaultFloorplanMetadata, defaultFloorplanSettings } from "@/lib/defaults";
import { floorplanSchema, themeSchema } from "@/lib/validation/layoutSchemas";
import * as limits from "@/lib/validation/limits";

const objectBase = z.object({
  id: z.string().min(1).max(100),
  x: z.number().min(-20_000).max(20_000),
  y: z.number().min(-20_000).max(20_000)
});

const tableObjectSchema = objectBase.extend({
  type: z.literal("table"),
  tableNumber: z.string().min(1).max(100),
  radius: z.number().min(6).max(200)
});

const rectObjectSchema = objectBase.extend({
  type: z.literal("rect"),
  width: z.number().min(6).max(10_000),
  height: z.number().min(6).max(10_000)
});

const circleObjectSchema = objectBase.extend({
  type: z.literal("circle"),
  radius: z.number().min(4).max(10_000)
});

const textObjectSchema = objectBase.extend({
  type: z.literal("text"),
  text: z.string().max(5_000),
  fontSize: z.number().min(6).max(200)
});

export const floorplanCanvasObjectSchema = z.discriminatedUnion("type", [
  tableObjectSchema,
  rectObjectSchema,
  circleObjectSchema,
  textObjectSchema
]);

export const floorplanDocumentSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  name: z.string().min(1).max(500),
  savedAt: z.string().min(1),
  metadata: z.object({
    title: z.string().max(limits.MAX_EVENT_NAME_CHARS),
    subtitle: z.string().max(2000)
  }),
  canvas: z.object({
    paperSize: floorplanSchema.shape.paperSize,
    orientation: floorplanSchema.shape.orientation,
    gridSize: z.number().int().min(4).max(200)
  }),
  objects: z.array(floorplanCanvasObjectSchema).max(5000),
  autoLayout: floorplanSchema,
  themeSnapshot: themeSchema,
  selectedClientLogoKey: z.string().max(500).nullable().optional(),
  selectedVenueLogoKey: z.string().max(500).nullable().optional()
});

export const floorplanSavePayloadSchema = z.object({
  id: z.string().uuid().optional().nullable(),
  name: z.string().min(1).max(500),
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
      gridSize: z.number().int().min(4).max(200).optional()
    })
    .optional(),
  objects: z.array(floorplanCanvasObjectSchema).max(5000),
  autoLayout: floorplanSchema.optional(),
  themeSnapshot: themeSchema.optional(),
  selectedClientLogoKey: z.string().max(500).nullable().optional(),
  selectedVenueLogoKey: z.string().max(500).nullable().optional()
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

