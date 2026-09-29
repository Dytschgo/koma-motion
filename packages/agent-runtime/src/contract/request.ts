import { brandKitContextSchema, toBrandKitContext } from '@koma-motion/brand-kit';
import {
  aspectRatioSchema,
  easingSchema,
  EASINGS,
  getCanvasSize,
  idSchema,
  persistentIdSchema,
  TRANSITION_OPERATIONS,
  TRANSITION_STRATEGIES,
  transitionOperationSchema,
  transitionStrategySchema,
  type KomaProject,
} from '@koma-motion/core';
import { z } from 'zod';

/**
 * Element types agents may produce. Groups exist in the document model but
 * are not offered to agents in this version.
 */
export const AGENT_ELEMENT_TYPES = ['text', 'shape', 'image'] as const;
export const agentElementTypeSchema = z.enum(AGENT_ELEMENT_TYPES);
export type AgentElementType = z.infer<typeof agentElementTypeSchema>;

export const MAX_USER_REQUEST_LENGTH = 4000;
export const MAX_REQUESTED_KOMAS = 12;
export const MAX_AGENT_ELEMENTS_PER_KOMA = 40;
export const MAX_AGENT_TEXT_LENGTH = 600;

export const generationConstraintsSchema = z.object({
  maxKomas: z.number().int().min(1).max(MAX_REQUESTED_KOMAS),
  maxElementsPerKoma: z.number().int().min(1).max(MAX_AGENT_ELEMENTS_PER_KOMA),
  maxTextLength: z.number().int().min(1).max(5000),
});

/** A compact description of the presentation that already exists in the project. */
export const existingPresentationContextSchema = z.object({
  title: z.string(),
  objective: z.string(),
  audience: z.string(),
  narrative: z.string(),
  komas: z.array(
    z.object({
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
    }),
  ),
});

export const presentationGenerationRequestSchema = z.object({
  userRequest: z.string().trim().min(1).max(MAX_USER_REQUEST_LENGTH),
  objective: z.string().max(2000).nullable(),
  audience: z.string().max(1000).nullable(),
  brandKit: brandKitContextSchema,
  requestedKomaCount: z.number().int().min(1).max(MAX_REQUESTED_KOMAS).nullable(),
  existingPresentation: existingPresentationContextSchema.nullable(),
  canvas: z.object({
    aspectRatio: aspectRatioSchema,
    width: z.number().positive(),
    height: z.number().positive(),
  }),
  allowedElementTypes: z.array(agentElementTypeSchema).min(1),
  allowedTransitionOperations: z.array(transitionOperationSchema),
  allowedTransitionStrategies: z.array(transitionStrategySchema).min(1),
  allowedEasings: z.array(easingSchema).min(1),
  /** The only assets an agent may refer to. Agents never see or define paths. */
  availableAssets: z.array(z.object({ id: idSchema, name: z.string().max(260) })),
  constraints: generationConstraintsSchema,
});

export type GenerationConstraints = z.infer<typeof generationConstraintsSchema>;
export type ExistingPresentationContext = z.infer<typeof existingPresentationContextSchema>;
export type PresentationGenerationRequest = z.infer<typeof presentationGenerationRequestSchema>;

/** What a person enters in the chat panel. */
export const generationInputSchema = z.object({
  userRequest: z.string().trim().min(1).max(MAX_USER_REQUEST_LENGTH),
  objective: z.string().max(2000).nullable(),
  audience: z.string().max(1000).nullable(),
  requestedKomaCount: z.number().int().min(1).max(MAX_REQUESTED_KOMAS).nullable(),
});
export type GenerationInput = z.infer<typeof generationInputSchema>;

function summariseExistingPresentation(project: KomaProject): ExistingPresentationContext | null {
  const { presentation } = project;
  if (presentation.komas.length === 0) {
    return null;
  }
  return {
    title: presentation.title,
    objective: presentation.objective,
    audience: presentation.audience,
    narrative: presentation.narrative,
    komas: presentation.komas.map((koma) => ({
      title: koma.title,
      purpose: koma.purpose,
      elements: koma.elements.map((element) => ({
        persistentId: element.persistentId,
        type: element.type,
        name: element.name,
        text: element.type === 'text' ? element.content.text.slice(0, 200) : null,
      })),
    })),
  };
}

/**
 * Builds the structured request for a provider from the project and the chat
 * input. The Brand Kit is always part of the request.
 */
export function buildGenerationRequest(
  project: KomaProject,
  input: GenerationInput,
): PresentationGenerationRequest {
  const canvas = getCanvasSize(project.presentation.aspectRatio);
  const availableAssets = project.assets
    .filter((asset) => asset.embeddedData !== null)
    .map((asset) => ({ id: asset.id, name: asset.name }));
  return {
    userRequest: input.userRequest.trim(),
    objective: input.objective,
    audience: input.audience,
    brandKit: toBrandKitContext(project.brandKit, project.assets),
    requestedKomaCount: input.requestedKomaCount,
    existingPresentation: summariseExistingPresentation(project),
    canvas: { aspectRatio: project.presentation.aspectRatio, ...canvas },
    allowedElementTypes: availableAssets.length > 0 ? [...AGENT_ELEMENT_TYPES] : ['text', 'shape'],
    allowedTransitionOperations: [...TRANSITION_OPERATIONS],
    allowedTransitionStrategies: [...TRANSITION_STRATEGIES],
    allowedEasings: [...EASINGS],
    availableAssets,
    constraints: {
      maxKomas: MAX_REQUESTED_KOMAS,
      maxElementsPerKoma: MAX_AGENT_ELEMENTS_PER_KOMA,
      maxTextLength: MAX_AGENT_TEXT_LENGTH,
    },
  };
}
