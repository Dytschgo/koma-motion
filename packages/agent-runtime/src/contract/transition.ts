import {
  aspectRatioSchema,
  EASINGS,
  easingSchema,
  err,
  getCanvasSize,
  MAX_TRANSITION_DURATION_MS,
  MIN_TRANSITION_DURATION_MS,
  ok,
  persistentIdSchema,
  systemInstructionsSchema,
  TRANSITION_STRATEGIES,
  transitionOperationSchema,
  transitionStrategySchema,
  type Koma,
  type KomaProject,
  type Result,
} from '@koma-motion/core';
import { diffKomas } from '@koma-motion/motion-engine';
import { z } from 'zod';
import { agentError, type AgentError } from './errors';
import type { JsonSchema } from './response';

/**
 * Regenerating one transition. The application derives what happens to each
 * object from the two Komas; the provider only chooses how the motion is
 * timed and explains it. It cannot change either Koma.
 */
const MAX_ENDPOINT_TEXT_LENGTH = 200;

const endpointSchema = z.object({
  /** 1-based position in the presentation. */
  number: z.number().int().min(1),
  title: z.string(),
  purpose: z.string(),
  elements: z.array(
    z.object({
      persistentId: persistentIdSchema,
      type: z.string(),
      name: z.string(),
      text: z.string().nullable(),
    }),
  ),
});

export const transitionRegenerationRequestSchema = z.object({
  systemInstructions: systemInstructionsSchema.default(''),
  presentation: z.object({
    title: z.string(),
    objective: z.string(),
    audience: z.string(),
  }),
  canvas: z.object({
    aspectRatio: aspectRatioSchema,
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  source: endpointSchema,
  target: endpointSchema,
  /** The operations the application derived from the current Komas, per object. */
  motion: z.array(
    z.object({
      persistentId: persistentIdSchema,
      operations: z.array(transitionOperationSchema),
    }),
  ),
  /** The settings the transition has now. */
  current: z.object({
    strategy: transitionStrategySchema,
    durationMs: z.number(),
    easing: easingSchema,
    rationale: z.string(),
  }),
  allowedTransitionStrategies: z.array(transitionStrategySchema).min(1),
  allowedEasings: z.array(easingSchema).min(1),
  durationRangeMs: z.object({ min: z.number(), max: z.number() }),
});
export type TransitionRegenerationRequest = z.infer<typeof transitionRegenerationRequestSchema>;

/**
 * The structured response of a provider for one transition. Like the
 * presentation response it is flat, has no optional properties and contains
 * data only.
 */
export const agentTransitionSettingsSchema = z.object({
  strategy: transitionStrategySchema,
  durationMs: z.number().min(MIN_TRANSITION_DURATION_MS).max(MAX_TRANSITION_DURATION_MS),
  easing: easingSchema,
  /** A concise, visible reason for the choreography. */
  rationale: z.string().trim().min(1).max(1000),
});
export type AgentTransitionSettings = z.infer<typeof agentTransitionSettingsSchema>;

/** The transition response contract as JSON Schema, for prompts and structured output options. */
export function getTransitionResponseJsonSchema(): JsonSchema {
  const { $schema: _dialect, ...schema } = z.toJSONSchema(agentTransitionSettingsSchema);
  return schema;
}

function describeEndpoint(koma: Koma, index: number): z.infer<typeof endpointSchema> {
  return {
    number: index + 1,
    title: koma.title,
    purpose: koma.purpose,
    elements: koma.elements.map((element) => ({
      persistentId: element.persistentId,
      type: element.type,
      name: element.name,
      text:
        element.type === 'text' ? element.content.text.slice(0, MAX_ENDPOINT_TEXT_LENGTH) : null,
    })),
  };
}

/**
 * Builds the request that regenerates the transition `transitionId`. Fails
 * when the transition does not connect two neighbouring Komas that can be
 * compared: then no provider can help, and the reason is returned instead.
 */
export function buildTransitionRegenerationRequest(
  project: KomaProject,
  transitionId: string,
): Result<TransitionRegenerationRequest, AgentError> {
  const { presentation } = project;
  const transition = presentation.transitions.find((candidate) => candidate.id === transitionId);
  if (transition === undefined) {
    return err(agentError('invalidRequest', 'This transition no longer exists.'));
  }
  const fromIndex = presentation.komas.findIndex((koma) => koma.id === transition.fromKomaId);
  const from = presentation.komas[fromIndex];
  const to = presentation.komas[fromIndex + 1];
  if (from === undefined || to?.id !== transition.toKomaId) {
    return err(
      agentError(
        'invalidRequest',
        'This transition does not connect two neighbouring Komas, so it cannot be regenerated.',
      ),
    );
  }
  const diff = diffKomas(from, to);
  if (!diff.ok) {
    return err(
      agentError(
        'invalidRequest',
        `The Komas "${from.title}" and "${to.title}" cannot be compared. Correct them first: ${diff.error.map((issue) => issue.message).join(' ')}`,
      ),
    );
  }
  const motion = new Map<string, z.infer<typeof transitionOperationSchema>[]>();
  for (const operation of diff.value.elementTransitions) {
    motion.set(operation.persistentId, [
      ...(motion.get(operation.persistentId) ?? []),
      operation.operation,
    ]);
  }
  return ok({
    systemInstructions: project.systemInstructions,
    presentation: {
      title: presentation.title,
      objective: presentation.objective,
      audience: presentation.audience,
    },
    canvas: {
      aspectRatio: presentation.aspectRatio,
      ...getCanvasSize(presentation.aspectRatio),
    },
    source: describeEndpoint(from, fromIndex),
    target: describeEndpoint(to, fromIndex + 1),
    motion: [...motion.entries()].map(([persistentId, operations]) => ({
      persistentId,
      operations,
    })),
    current: {
      strategy: transition.strategy,
      durationMs: transition.duration,
      easing: transition.easing,
      rationale: transition.rationale,
    },
    allowedTransitionStrategies: [...TRANSITION_STRATEGIES],
    allowedEasings: [...EASINGS],
    durationRangeMs: { min: MIN_TRANSITION_DURATION_MS, max: MAX_TRANSITION_DURATION_MS },
  });
}
