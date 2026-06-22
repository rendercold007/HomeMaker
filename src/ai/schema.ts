/**
 * Zod schemas for AI output validation.
 *
 * The AI outputs a simple rectangle-based layout (GenerationResultSchema).
 * generate.ts converts that into a full wall-graph Plan client-side so the AI
 * never has to deal with shared point IDs or cycle correctness.
 */
import { z } from 'zod';

// --- AI output schema (what the model returns) ---

export const RectRoomSchema = z.object({
  name: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number().positive(),
  h: z.number().positive(),
});

export const PlotSchema = z.object({
  widthCm: z.number().positive(),
  depthCm: z.number().positive(),
  shape: z.enum(['rectangular', 'square', 'lshape', 'irregular']),
  entrance: z.enum(['N', 'S', 'E', 'W']),
  setbacks: z.object({
    front: z.number().nonnegative(),
    rear: z.number().nonnegative(),
    left: z.number().nonnegative(),
    right: z.number().nonnegative(),
  }),
});

export const VastuConfigSchema = z.object({
  mode: z.enum(['strict', 'loose', 'off']),
});

export const GenerationResultSchema = z.object({
  id: z.string().default('plan-ai'),
  name: z.string().default('Generated Plan'),
  plot: PlotSchema,
  vastu: VastuConfigSchema,
  rooms: z.array(RectRoomSchema).min(1),
});

export type GenerationResult = z.infer<typeof GenerationResultSchema>;
