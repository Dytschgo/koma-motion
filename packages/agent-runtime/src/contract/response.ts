import {
  COORDINATE_LIMIT,
  easingSchema,
  SHAPE_KINDS,
  TEXT_ALIGNMENTS,
  transitionStrategySchema,
  VERTICAL_ALIGNMENTS,
} from '@koma-motion/core';
import { z } from 'zod';
import {
  agentElementTypeSchema,
  MAX_AGENT_ELEMENTS_PER_KOMA,
  MAX_AGENT_TEXT_LENGTH,
} from './request';

/**
 * The structured response every provider must produce.
 *
 * The schema is deliberately flat and has no optional properties: a property
 * that does not apply is `null`. That keeps it compatible with the structured
 * output features of agent CLIs and easy to explain in a prompt. It contains
 * no filesystem paths, commands or code, only data.
 */
const keySchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/);
const colourSchema = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const coordinateSchema = z.number().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT);
const extentSchema = z.number().gt(0).max(COORDINATE_LIMIT);

export const FONT_ROLES = ['heading', 'body'] as const;

export const agentElementSchema = z.object({
  persistentId: keySchema,
  name: z.string().max(120),
  type: agentElementTypeSchema,
  x: coordinateSchema,
  y: coordinateSchema,
  width: extentSchema,
  height: extentSchema,
  rotation: z.number().min(-3600).max(3600),
  opacity: z.number().min(0).max(1),
  zIndex: z.number().int().min(-10000).max(10000),
  text: z
    .string()
    .max(
      MAX_AGENT_TEXT_LENGTH,
      'A text element exceeds the 100,000-character layout safety budget. Split it across elements or Komas.',
    )
    .nullable(),
  fontRole: z.enum(FONT_ROLES).nullable(),
  fontSize: z.number().min(1).max(2000).nullable(),
  fontWeight: z.number().int().min(100).max(900).nullable(),
  textAlign: z.enum(TEXT_ALIGNMENTS).nullable(),
  verticalAlign: z.enum(VERTICAL_ALIGNMENTS).nullable(),
  textColour: colourSchema.nullable(),
  shape: z.enum(SHAPE_KINDS).nullable(),
  cornerRadius: z.number().min(0).max(10000).nullable(),
  fillColour: colourSchema.nullable(),
  strokeColour: colourSchema.nullable(),
  strokeWidth: z.number().min(0).max(1000).nullable(),
  assetId: keySchema.nullable(),
});

export const agentKomaSchema = z.object({
  key: keySchema,
  title: z.string().max(300),
  purpose: z.string().max(2000),
  speakerNotes: z.string().max(20000),
  backgroundColour: colourSchema.nullable(),
  elements: z
    .array(agentElementSchema)
    .max(
      MAX_AGENT_ELEMENTS_PER_KOMA,
      'This Koma exceeds the 2,000-element rendering safety budget. Split it across Komas.',
    ),
});

export const agentTransitionSchema = z.object({
  fromKoma: keySchema,
  toKoma: keySchema,
  strategy: transitionStrategySchema,
  durationMs: z.number().min(0).max(600000),
  easing: easingSchema,
  /** A concise, visible reason for the choreography. */
  rationale: z.string().max(1000),
});

export const agentPresentationResponseSchema = z.object({
  /** Each request replaces shape placeholders with the same persistent identity. */
  imageRequests: z
    .array(
      z.object({
        persistentId: keySchema,
        prompt: z.string().trim().min(1).max(2000),
      }),
    )
    .max(4)
    .optional(),
  presentation: z.object({
    title: z.string().max(300),
    objective: z.string().max(2000),
    audience: z.string().max(1000),
    narrative: z.string().max(10000),
  }),
  komas: z.array(agentKomaSchema).min(1),
  transitions: z.array(agentTransitionSchema),
  /** A concise, visible reason for the visual design. */
  visualRationale: z.string().max(2000),
  warnings: z.array(z.string().max(500)).max(20),
});

export type AgentElement = z.infer<typeof agentElementSchema>;
export type AgentKoma = z.infer<typeof agentKomaSchema>;
export type AgentTransition = z.infer<typeof agentTransitionSchema>;
export type AgentPresentationResponse = z.infer<typeof agentPresentationResponseSchema>;

export type JsonSchema = Readonly<Record<string, unknown>>;

/** The response contract as JSON Schema, for prompts and structured output options. */
export function getResponseJsonSchema(images = false): JsonSchema {
  const response = images
    ? agentPresentationResponseSchema.required({ imageRequests: true })
    : agentPresentationResponseSchema.omit({ imageRequests: true });
  const { $schema: _dialect, ...schema } = z.toJSONSchema(response);
  return schema;
}
