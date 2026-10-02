import { modelNameSchema, providerIdSchema } from '@koma-motion/core';
import { z } from 'zod';
import { agentErrorSchema, type AgentError } from '../contract/errors';
import type {
  BrandProfileAnalysisContext,
  BrandProfileAnalysisRequest,
  BrandProfileAnalysisResponse,
} from '../contract/brandProfileAnalysis';
import type { PresentationGenerationRequest } from '../contract/request';
import type { TransitionRegenerationRequest } from '../contract/transition';
import type { AgentPrompt } from '../prompts/presentationGeneration';
import type {
  BrandKitAnalysisContext,
  BrandKitAnalysisRequest,
  BrandKitAnalysisResponse,
} from '../contract/brandKitAnalysis';

/** One model a provider offers by name. */
export const providerModelSchema = z.object({
  id: modelNameSchema,
  label: z.string().min(1).max(80),
  /** `alias` names a family and resolves to its latest model; `id` is an exact model. */
  kind: z.enum(['alias', 'id']),
});
export type ProviderModel = z.infer<typeof providerModelSchema>;

/**
 * Where the model choices of a provider come from.
 *
 * - `none`: the provider has no model choice, or offers no list.
 * - `curated`: a list shipped with Koma Motion from the provider's
 *   documentation. It is not read from the account and may contain models
 *   that a sign-in cannot use.
 * - `cli`: the provider's CLI can list the models of the signed-in account
 *   on request (`listModels`). `models` holds a fallback until then.
 */
export const modelCatalogSchema = z.object({
  source: z.enum(['none', 'curated', 'cli']),
  models: z.array(providerModelSchema).max(50),
  /** A sentence that explains the list to the user. */
  note: z.string().max(300),
});
export type ModelCatalog = z.infer<typeof modelCatalogSchema>;

/** The answer of a provider that listed the models of the signed-in account. */
export const providerModelListingSchema = z.discriminatedUnion('status', [
  z.object({
    status: z.literal('listed'),
    models: z.array(modelNameSchema).max(50),
    defaultModel: modelNameSchema.nullable(),
    checkedAt: z.iso.datetime(),
  }),
  z.object({ status: z.literal('unsupported') }),
  z.object({
    status: z.literal('failed'),
    /** A sentence that can be shown to the user as it is. */
    message: z.string().max(300),
  }),
]);
export type ProviderModelListing = z.infer<typeof providerModelListingSchema>;

export const providerMetadataSchema = z.object({
  id: providerIdSchema,
  displayName: z.string(),
  description: z.string(),
  /** `builtIn` providers are part of Koma Motion, `cli` providers start a local program. */
  kind: z.enum(['builtIn', 'cli']),
  /** Whether using the provider sends the request to an online service. */
  usesExternalService: z.boolean(),
  supportsModelSelection: z.boolean(),
  defaultModel: modelNameSchema.nullable(),
  modelCatalog: modelCatalogSchema,
  /** Whether a model id typed by the user may be passed to the provider. */
  acceptsCustomModel: z.boolean(),
  /** Whether the provider reports what it writes while it works. */
  streamsOutput: z.boolean(),
});
export type ProviderMetadata = z.infer<typeof providerMetadataSchema>;

export const providerDetectionResultSchema = z.object({
  providerId: providerIdSchema,
  availability: z.enum(['available', 'unavailable', 'error']),
  version: z.string().nullable(),
  /** A sentence that can be shown to the user as it is. */
  message: z.string(),
  checkedAt: z.iso.datetime(),
});
export type ProviderDetectionResult = z.infer<typeof providerDetectionResultSchema>;

/**
 * Technical facts about one attempt. Pattern redaction of error output cannot
 * guarantee removal of every secret, prompt or environment value from
 * arbitrary stderr.
 */
export const attemptDiagnosticsSchema = z.object({
  attempt: z.number().int(),
  kind: z.enum(['generation', 'repair']),
  durationMs: z.number(),
  exitCode: z.number().nullable(),
  outputLength: z.number(),
  /** Redacted and truncated excerpt of the error output of the provider. */
  errorOutput: z.string(),
  outcome: z.enum(['completed', 'failed', 'rejected']),
});
export type AttemptDiagnostics = z.infer<typeof attemptDiagnosticsSchema>;

export const executionDiagnosticsSchema = z.object({
  providerId: z.string(),
  startedAt: z.iso.datetime(),
  finishedAt: z.iso.datetime(),
  durationMs: z.number(),
  promptTemplate: z.string(),
  attempts: z.array(attemptDiagnosticsSchema),
});
export type ExecutionDiagnostics = z.infer<typeof executionDiagnosticsSchema>;

export const EXECUTION_PHASES = [
  'preparing',
  'detecting',
  'generating',
  'validating',
  'repairing',
  'converting',
  'succeeded',
  'failed',
  'cancelled',
  'timedOut',
] as const;

export const executionStatusEventSchema = z.object({
  executionId: z.string(),
  phase: z.enum(EXECUTION_PHASES),
  /** A sentence that can be shown to the user as it is. */
  message: z.string(),
  timestamp: z.iso.datetime(),
});
export type ExecutionPhase = (typeof EXECUTION_PHASES)[number];

/** Longest text in one output event. Longer output is split into several events. */
export const MAX_OUTPUT_EVENT_LENGTH = 4000;

/**
 * Text a provider wrote for the person while it works, for example the
 * visible part of Claude's answer. Never reasoning, tool input or error output.
 */
export const executionOutputEventSchema = z.object({
  executionId: z.string(),
  /** 1 for the first attempt, 2 for the repair attempt. */
  attempt: z.number().int().min(1).max(2),
  text: z.string().min(1).max(MAX_OUTPUT_EVENT_LENGTH),
});
export type ExecutionOutputEvent = z.infer<typeof executionOutputEventSchema>;
export type ExecutionStatusEvent = z.infer<typeof executionStatusEventSchema>;

export { agentErrorSchema };

export interface AgentExecutionContext {
  readonly executionId: string;
  /** 1 for the first attempt, 2 for the repair attempt. */
  readonly attempt: number;
  /** The rendered prompt. Providers that start an agent send this to it. */
  readonly prompt: AgentPrompt;
  /** `null` lets the provider use its default model. */
  readonly model: string | null;
  /**
   * Aborted when the user cancels or the execution times out. Providers must
   * stop their work and release their resources when this happens.
   */
  readonly signal: AbortSignal;
  /** Reports progress that is worth showing to the user. */
  reportProgress(message: string): void;
  /**
   * Reports text written for the user while the provider works. Only
   * providers whose metadata says `streamsOutput` call it.
   */
  reportOutput?(text: string): void;
}

/** Raw, untrusted output of a provider. The runtime extracts and validates it. */
export interface ProviderOutput {
  readonly rawText: string;
  /**
   * Structured data, when the provider has a native structured output
   * feature. The runtime size-checks it and prefers this envelope only when
   * the text is empty, has no object, or is the same JSON value. Providers
   * pass the text unchanged in `rawText`: replacing it with a copy of the
   * structured output would hide a disagreement.
   */
  readonly structured?: unknown;
}

export interface ProviderAttemptDetails {
  readonly exitCode: number | null;
  readonly errorOutput: string;
}

export type ProviderExecutionResult =
  | { readonly ok: true; readonly output: ProviderOutput; readonly details: ProviderAttemptDetails }
  | { readonly ok: false; readonly error: AgentError; readonly details: ProviderAttemptDetails };

/**
 * A source of presentation proposals.
 *
 * Differences to a plain "generate" interface, and the reasons for them:
 *
 * - `generatePresentation` returns raw output instead of a presentation. The
 *   runtime validates every provider the same way, so no provider can skip
 *   validation.
 * - Cancellation uses the `AbortSignal` in the context instead of a separate
 *   `cancel(executionId)` method. A provider cannot forget to implement it,
 *   and timeouts use the same mechanism.
 */
export interface AgentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly metadata: ProviderMetadata;

  detect(): Promise<ProviderDetectionResult>;

  /**
   * Lists the models the signed-in account can use, when the provider's CLI
   * offers such a list. Only providers whose catalog source is `cli` have it.
   */
  listModels?(signal: AbortSignal): Promise<ProviderModelListing>;

  /** Optional dedicated visual analysis capability. Never generates or changes a presentation. */
  analyzeBrandKit?(
    request: BrandKitAnalysisRequest,
    context: BrandKitAnalysisContext,
  ): Promise<BrandKitAnalysisResponse>;

  /**
   * Optional analysis of several reference files into a Brand Kit and
   * matching project instructions. Never generates or changes a presentation.
   */
  analyzeBrandProfile?(
    request: BrandProfileAnalysisRequest,
    context: BrandProfileAnalysisContext,
  ): Promise<BrandProfileAnalysisResponse>;

  generatePresentation(
    request: PresentationGenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult>;

  /**
   * Proposes new settings for one transition. The output is validated like
   * presentation output, against the transition contract in the prompt.
   */
  generateTransition(
    request: TransitionRegenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult>;
}
