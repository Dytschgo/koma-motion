import { agentError, type AgentError } from '../contract/errors';
import {
  presentationGenerationRequestSchema,
  type PresentationGenerationRequest,
} from '../contract/request';
import { getResponseJsonSchema, type AgentPresentationResponse } from '../contract/response';
import {
  presentationGenerationPromptV4,
  presentationRepairPromptV4,
  type AgentPrompt,
} from '../prompts/presentationGeneration';
import type { ProviderRegistry } from '../providers/registry';
import type {
  AgentProvider,
  AttemptDiagnostics,
  ExecutionDiagnostics,
  ExecutionPhase,
  ExecutionStatusEvent,
  ProviderExecutionResult,
} from '../providers/types';
import { resolveProviderOutput } from '../validation/extract';
import { validateAgentResponse } from '../validation/validateResponse';

export const DEFAULT_TIMEOUT_MS = null;
/** Node timers overflow above this value; reject invalid opt-in deadlines. */
export const MAX_TIMEOUT_MS = 2_147_483_647;
/** One generation attempt plus at most one repair attempt. */
export const MAX_ATTEMPTS = 2;

export interface GenerationExecution {
  readonly executionId: string;
  readonly providerId: string;
  readonly request: PresentationGenerationRequest;
  readonly timeoutMs?: number | null;
  readonly model?: string | null;
  readonly onStatus?: (event: ExecutionStatusEvent) => void;
}

export type PresentationGenerationResult =
  | {
      readonly status: 'succeeded';
      readonly executionId: string;
      readonly providerId: string;
      readonly response: AgentPresentationResponse;
      /** Sentences that can be shown to the user as they are. */
      readonly warnings: readonly string[];
      /** Whether the response was only accepted after the repair attempt. */
      readonly repaired: boolean;
      readonly diagnostics: ExecutionDiagnostics;
    }
  | {
      readonly status: 'failed' | 'cancelled' | 'timedOut';
      readonly executionId: string;
      readonly providerId: string;
      readonly error: AgentError;
      readonly diagnostics: ExecutionDiagnostics;
    };

type StopReason = 'cancelled' | 'timedOut';

interface RunningExecution {
  readonly controller: AbortController;
  stopReason: StopReason | null;
}

const STOP_ERRORS: Readonly<Record<StopReason, (timeoutMs: number | null) => AgentError>> = {
  cancelled: () => agentError('cancelled', 'The generation was stopped.'),
  timedOut: (timeoutMs) =>
    agentError(
      'timedOut',
      `The provider did not finish within ${String(Math.round((timeoutMs ?? 0) / 1000))} seconds and was stopped.`,
    ),
};

/** Settles with `promise`, or with `null` as soon as `signal` is aborted. */
function untilAborted<T>(promise: Promise<T>, signal: AbortSignal): Promise<T | null> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      resolve(null);
      return;
    }
    const onAbort = (): void => {
      resolve(null);
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error('The provider failed'));
      },
    );
  });
}

/**
 * Runs generation requests: detection, execution with timeout and
 * cancellation, validation of the untrusted output and one bounded repair
 * attempt. It reports every phase through status events.
 */
export class GenerationRunner {
  readonly #registry: ProviderRegistry;
  readonly #now: () => Date;
  readonly #running = new Map<string, RunningExecution>();

  constructor(options: { readonly registry: ProviderRegistry; readonly now?: () => Date }) {
    this.#registry = options.registry;
    this.#now = options.now ?? (() => new Date());
  }

  isRunning(executionId: string): boolean {
    return this.#running.has(executionId);
  }

  /** Stops a running execution. Returns `false` when there is nothing to stop. */
  cancel(executionId: string): boolean {
    const execution = this.#running.get(executionId);
    if (execution === undefined) {
      return false;
    }
    execution.stopReason ??= 'cancelled';
    execution.controller.abort();
    return true;
  }

  cancelAll(): void {
    for (const executionId of this.#running.keys()) {
      this.cancel(executionId);
    }
  }

  async execute(execution: GenerationExecution): Promise<PresentationGenerationResult> {
    const { executionId, providerId } = execution;
    const timeoutMs = execution.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const startedAt = this.#now();
    const attempts: AttemptDiagnostics[] = [];
    let promptTemplate = '';

    const report = (phase: ExecutionPhase, message: string): void => {
      execution.onStatus?.({
        executionId,
        phase,
        message,
        timestamp: this.#now().toISOString(),
      });
    };
    const diagnostics = (): ExecutionDiagnostics => {
      const finishedAt = this.#now();
      return {
        providerId,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        promptTemplate,
        attempts,
      };
    };
    const fail = (error: AgentError): PresentationGenerationResult => {
      const status =
        error.code === 'cancelled'
          ? 'cancelled'
          : error.code === 'timedOut'
            ? 'timedOut'
            : 'failed';
      report(status, error.message);
      return { status, executionId, providerId, error, diagnostics: diagnostics() };
    };

    if (this.#running.has(executionId)) {
      return fail(agentError('internalError', 'This generation is already running.'));
    }

    if (
      timeoutMs !== null &&
      (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > MAX_TIMEOUT_MS)
    ) {
      return fail(
        agentError(
          'invalidRequest',
          'The optional timeout exceeds the JavaScript timer range. Disable the timeout or choose a shorter interval.',
        ),
      );
    }
    report('preparing', 'Preparing the request');
    const request = presentationGenerationRequestSchema.safeParse(execution.request);
    if (!request.success) {
      return fail(
        agentError(
          'invalidRequest',
          'The request could not be sent because it is not valid.',
          request.error.issues.map((issue) => ({
            code: 'schema',
            path: issue.path.join('.'),
            message: issue.message,
          })),
        ),
      );
    }

    const provider = this.#registry.get(providerId);
    if (provider === undefined) {
      return fail(agentError('providerNotFound', `The provider "${providerId}" does not exist.`));
    }

    const running: RunningExecution = { controller: new AbortController(), stopReason: null };
    this.#running.set(executionId, running);
    const timer =
      timeoutMs === null
        ? undefined
        : setTimeout(() => {
            running.stopReason ??= 'timedOut';
            running.controller.abort();
          }, timeoutMs);

    try {
      return await this.#run(provider, request.data, execution, running, {
        attempts,
        report,
        fail,
        diagnostics,
        timeoutMs,
        setPromptTemplate: (value) => {
          promptTemplate = value;
        },
      });
    } catch {
      // Provider errors may contain anything. Only a neutral message leaves the runtime.
      return fail(
        agentError('internalError', `${provider.displayName} stopped with an unexpected error.`),
      );
    } finally {
      clearTimeout(timer);
      this.#running.delete(executionId);
    }
  }

  async #run(
    provider: AgentProvider,
    request: PresentationGenerationRequest,
    execution: GenerationExecution,
    running: RunningExecution,
    tools: {
      readonly attempts: AttemptDiagnostics[];
      readonly report: (phase: ExecutionPhase, message: string) => void;
      readonly fail: (error: AgentError) => PresentationGenerationResult;
      readonly diagnostics: () => ExecutionDiagnostics;
      readonly timeoutMs: number | null;
      readonly setPromptTemplate: (value: string) => void;
    },
  ): Promise<PresentationGenerationResult> {
    const { attempts, report, fail, timeoutMs } = tools;
    const { signal } = running.controller;
    const stopped = (): AgentError | null =>
      running.stopReason === null ? null : STOP_ERRORS[running.stopReason](timeoutMs);

    report('detecting', `Checking ${provider.displayName}`);
    const detection = await untilAborted(provider.detect(), signal);
    if (detection === null) {
      return fail(stopped() ?? agentError('cancelled', 'The generation was stopped.'));
    }
    if (detection.availability !== 'available') {
      return fail(agentError('providerUnavailable', detection.message));
    }

    const responseJsonSchema = getResponseJsonSchema();
    let prompt: AgentPrompt = presentationGenerationPromptV4.render({
      request,
      responseJsonSchema,
    });
    tools.setPromptTemplate(`${prompt.templateId}@${String(prompt.templateVersion)}`);
    let lastError = agentError('internalError', 'The provider was not started.');

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      const kind = attempt === 1 ? 'generation' : 'repair';
      report(
        attempt === 1 ? 'generating' : 'repairing',
        attempt === 1
          ? `${provider.displayName} is working`
          : 'The response was not valid. Asking the provider to correct it once',
      );

      const attemptStartedAt = this.#now().getTime();
      const result: ProviderExecutionResult | null = await untilAborted(
        provider.generatePresentation(request, {
          executionId: execution.executionId,
          attempt,
          prompt,
          model: execution.model ?? null,
          signal,
          reportProgress: (message) => {
            report(attempt === 1 ? 'generating' : 'repairing', message);
          },
        }),
        signal,
      );
      const record = (
        outcome: AttemptDiagnostics['outcome'],
        outputLength: number,
        details: { exitCode: number | null; errorOutput: string },
      ): void => {
        attempts.push({
          attempt,
          kind,
          durationMs: this.#now().getTime() - attemptStartedAt,
          exitCode: details.exitCode,
          outputLength,
          errorOutput: details.errorOutput,
          outcome,
        });
      };

      const stopError = stopped();
      if (result === null || stopError !== null) {
        record('failed', 0, result?.details ?? { exitCode: null, errorOutput: '' });
        return fail(stopError ?? agentError('cancelled', 'The generation was stopped.'));
      }
      if (!result.ok) {
        record('failed', 0, result.details);
        return fail(result.error);
      }

      report('validating', 'Checking the response');
      const { rawText } = result.output;
      const resolved = resolveProviderOutput(result.output);
      const validated = resolved.ok ? validateAgentResponse(resolved.value, request) : resolved;

      if (validated.ok) {
        record('completed', rawText.length, result.details);
        report('succeeded', 'The response is valid');
        return {
          status: 'succeeded',
          executionId: execution.executionId,
          providerId: provider.id,
          response: validated.value.response,
          warnings: validated.value.warnings,
          repaired: attempt > 1,
          diagnostics: tools.diagnostics(),
        };
      }

      record('rejected', rawText.length, result.details);
      lastError = validated.error;
      if (validated.error.code === 'outputTooLarge') {
        break;
      }
      prompt = presentationRepairPromptV4.render({
        request,
        responseJsonSchema,
        previousOutput: rawText,
        issues: validated.error.issues,
        problem: validated.error.message,
      });
    }

    return fail(lastError);
  }
}
