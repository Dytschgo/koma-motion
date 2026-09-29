import { z } from 'zod';
import { hexColourSchema } from '../colour';
import { opacitySchema, positionSchema, rotationSchema, sizeSchema } from '../geometry';
import { idSchema, persistentIdSchema } from '../ids';

/**
 * Operations supported by schema version 1. The list is intentionally small;
 * docs/MOTION_MODEL.md describes the operations planned for later versions.
 */
export const TRANSITION_OPERATIONS = [
  'hold',
  'move',
  'scale',
  'rotate',
  'fadeIn',
  'fadeOut',
  'colourChange',
  'replace',
] as const;
export const transitionOperationSchema = z.enum(TRANSITION_OPERATIONS);
export type TransitionOperation = z.infer<typeof transitionOperationSchema>;

/**
 * `continuous` runs every operation across the whole duration.
 * `staged` lets objects leave first, then transforms retained objects and
 * finally lets new objects enter.
 */
export const TRANSITION_STRATEGIES = ['continuous', 'staged'] as const;
export const transitionStrategySchema = z.enum(TRANSITION_STRATEGIES);
export type TransitionStrategy = z.infer<typeof transitionStrategySchema>;

export const EASINGS = ['linear', 'easeIn', 'easeOut', 'easeInOut'] as const;
export const easingSchema = z.enum(EASINGS);
export type Easing = z.infer<typeof easingSchema>;

export const MIN_TRANSITION_DURATION_MS = 100;
export const MAX_TRANSITION_DURATION_MS = 10000;
export const DEFAULT_TRANSITION_DURATION_MS = 900;

export const elementColoursSchema = z.object({
  fill: hexColourSchema.nullable().optional(),
  stroke: hexColourSchema.nullable().optional(),
  text: hexColourSchema.optional(),
});

/**
 * The state of one element at one end of an operation. Only the properties
 * that matter for the operation are present.
 */
export const elementMotionStateSchema = z.object({
  elementId: idSchema,
  position: positionSchema.optional(),
  size: sizeSchema.optional(),
  rotation: rotationSchema.optional(),
  opacity: opacitySchema.optional(),
  colours: elementColoursSchema.optional(),
});

export const elementTransitionSchema = z.object({
  persistentId: persistentIdSchema,
  operation: transitionOperationSchema,
  /** `null` when the object does not exist in the source Koma. */
  from: elementMotionStateSchema.nullable(),
  /** `null` when the object does not exist in the target Koma. */
  to: elementMotionStateSchema.nullable(),
});

export const komaTransitionSchema = z.object({
  id: idSchema,
  fromKomaId: idSchema,
  toKomaId: idSchema,
  strategy: transitionStrategySchema,
  /** Duration in milliseconds. */
  duration: z.number().int().min(MIN_TRANSITION_DURATION_MS).max(MAX_TRANSITION_DURATION_MS),
  easing: easingSchema,
  elementTransitions: z.array(elementTransitionSchema).max(2000),
  /** Concise, visible reason for the choreography. Never private model reasoning. */
  rationale: z.string().max(1000),
});

export type ElementColours = z.infer<typeof elementColoursSchema>;
export type ElementMotionState = z.infer<typeof elementMotionStateSchema>;
export type ElementTransition = z.infer<typeof elementTransitionSchema>;
export type KomaTransition = z.infer<typeof komaTransitionSchema>;
