import { brandKitContextSchema, toBrandKitContext } from '@koma-motion/brand-kit';
import {
  aspectRatioSchema,
  exceedsUtf8ByteLength,
  MAX_ELEMENTS_PER_KOMA,
  MAX_ELEMENT_TEXT_LENGTH,
  easingSchema,
  EASINGS,
  getCanvasSize,
  idSchema,
  komaSchema,
  persistentIdSchema,
  TRANSITION_OPERATIONS,
  TRANSITION_STRATEGIES,
  transitionOperationSchema,
  transitionStrategySchema,
  systemInstructionsSchema,
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

/** IPC/prompt memory safety boundary; not a writing-length product rule. */
export const MAX_USER_REQUEST_BYTES = 1024 * 1024;
export const userRequestSchema = z
  .string()
  .refine(
    (text) => !exceedsUtf8ByteLength(text, MAX_USER_REQUEST_BYTES),
    'The request exceeds the 1 MiB input safety boundary. Reduce the pasted material and try again. Your text has been kept.',
  )
  .pipe(z.string().trim().min(1));
export const MAX_AGENT_ELEMENTS_PER_KOMA = MAX_ELEMENTS_PER_KOMA;
export const MAX_AGENT_TEXT_LENGTH = MAX_ELEMENT_TEXT_LENGTH;

export const MAX_REFERENCE_FILES = 5;
export const MAX_REFERENCE_TEXT_LENGTH = 100_000;
export const MAX_TOTAL_REFERENCE_TEXT_LENGTH = 200_000;
export const referenceTextSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(180),
    format: z.enum(['txt', 'md', 'pdf']),
    text: z.string().trim().min(1).max(MAX_REFERENCE_TEXT_LENGTH),
    truncated: z.boolean(),
  })
  .strict();
export type ReferenceText = z.infer<typeof referenceTextSchema>;
export const referenceTextsSchema = z
  .array(referenceTextSchema)
  .max(MAX_REFERENCE_FILES)
  .refine(
    (references) =>
      references.reduce((total, reference) => total + reference.text.length, 0) <=
      MAX_TOTAL_REFERENCE_TEXT_LENGTH,
    'The combined reference text exceeds the safety limit.',
  );

export const generationConstraintsSchema = z.object({
  maxKomas: z.number().int().min(1).nullable(),
  maxElementsPerKoma: z.number().int().min(1).max(MAX_AGENT_ELEMENTS_PER_KOMA),
  maxTextLength: z.number().int().min(1).max(MAX_AGENT_TEXT_LENGTH),
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
  /** Explicit selected-Koma proposal context; absent for whole-presentation generation. */
  targetKoma: komaSchema.optional(),
  userRequest: userRequestSchema,
  systemInstructions: systemInstructionsSchema.default(''),
  objective: z.string().max(2000).nullable(),
  audience: z.string().max(1000).nullable(),
  brandKit: brandKitContextSchema,
  requestedKomaCount: z.number().int().min(1).nullable(),
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
  imageGenerationEnabled: z.boolean().optional(),
  imageProvider: z.enum(['codex', 'grok']).optional(),
  references: referenceTextsSchema.optional(),
  constraints: generationConstraintsSchema,
});

export type GenerationConstraints = z.infer<typeof generationConstraintsSchema>;
export type ExistingPresentationContext = z.infer<typeof existingPresentationContextSchema>;
export type PresentationGenerationRequest = z.infer<typeof presentationGenerationRequestSchema>;

/** What a person enters in the chat panel. */
export const generationInputSchema = z.object({
  targetKomaId: idSchema.optional(),
  userRequest: userRequestSchema,
  objective: z.string().max(2000).nullable(),
  audience: z.string().max(1000).nullable(),
  requestedKomaCount: z.number().int().min(1).nullable(),
  references: referenceTextsSchema.optional(),
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
  const targetKoma =
    input.targetKomaId === undefined
      ? undefined
      : project.presentation.komas.find((koma) => koma.id === input.targetKomaId);
  if (input.targetKomaId !== undefined && targetKoma === undefined) {
    throw new Error(
      'The selected Koma no longer exists. Select a current Koma and generate again.',
    );
  }
  const canvas = getCanvasSize(project.presentation.aspectRatio);
  const availableAssets = project.assets
    .filter((asset) => asset.embeddedData !== null)
    .map((asset) => ({ id: asset.id, name: asset.name }));
  return {
    ...(targetKoma === undefined ? {} : { targetKoma }),
    userRequest: input.userRequest.trim(),
    systemInstructions: project.systemInstructions,
    objective: input.objective,
    audience: input.audience,
    brandKit: toBrandKitContext(project.brandKit, project.assets),
    requestedKomaCount: targetKoma === undefined ? input.requestedKomaCount : 1,
    imageGenerationEnabled: ['codex', 'grok'].includes(
      project.agentConfiguration.imageGeneration ?? 'off',
    ),
    ...(project.agentConfiguration.imageGeneration === 'codex' ||
    project.agentConfiguration.imageGeneration === 'grok'
      ? { imageProvider: project.agentConfiguration.imageGeneration }
      : {}),
    existingPresentation: summariseExistingPresentation(project),
    canvas: { aspectRatio: project.presentation.aspectRatio, ...canvas },
    allowedElementTypes: availableAssets.length > 0 ? [...AGENT_ELEMENT_TYPES] : ['text', 'shape'],
    allowedTransitionOperations: [...TRANSITION_OPERATIONS],
    allowedTransitionStrategies: [...TRANSITION_STRATEGIES],
    allowedEasings: [...EASINGS],
    availableAssets,
    references: input.references ?? [],
    constraints: {
      maxKomas: targetKoma === undefined ? null : 1,
      maxElementsPerKoma: MAX_AGENT_ELEMENTS_PER_KOMA,
      maxTextLength: MAX_AGENT_TEXT_LENGTH,
    },
  };
}
