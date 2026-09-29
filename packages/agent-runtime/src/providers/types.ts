import { modelNameSchema, providerIdSchema } from '@koma-motion/core';
import { z } from 'zod';
import { agentErrorSchema, type AgentError } from '../contract/errors';
import type { PresentationGenerationRequest } from '../contract/request';
import type { AgentPrompt } from '../prompts/presentationGeneration';

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
}

/** Raw, untrusted output of a provider. The runtime extracts and validates it. */
export interface ProviderOutput {
  readonly rawText: string;
  /**
   * Structured data, when the provider has a native structured output
   * feature. The runtime size-checks it and prefers this envelope only when
   * the text is empty, has no object, or is the same JSON value.
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

  generatePresentation(
    request: PresentationGenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult>;
}
