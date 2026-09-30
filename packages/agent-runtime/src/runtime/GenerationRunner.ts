import { agentError, type AgentError } from '../contract/errors';
import {
  presentationGenerationRequestSchema,
  type PresentationGenerationRequest,
} from '../contract/request';
import {
  getResponseJsonSchema,
  type AgentPresentationResponse,
  type JsonSchema,
} from '../contract/response';
import {
  getTransitionResponseJsonSchema,
  transitionRegenerationRequestSchema,
  type AgentTransitionSettings,
  type TransitionRegenerationRequest,
} from '../contract/transition';
import {
  presentationGenerationPromptV4,
  presentationRepairPromptV4,
  type AgentPrompt,
} from '../prompts/presentationGeneration';
import {
  transitionRegenerationPromptV1,
  transitionRepairPromptV1,
} from '../prompts/transitionRegeneration';
import type { ProviderRegistry } from '../providers/registry';
import type {
  AgentExecutionContext,
  AgentProvider,
  AttemptDiagnostics,
  ExecutionDiagnostics,
  ExecutionPhase,
  ExecutionStatusEvent,
  ProviderExecutionResult,
} from '../providers/types';
import { resolveProviderOutput } from '../validation/extract';
import { validateAgentResponse } from '../validation/validateResponse';
import { validateTransitionResponse } from '../validation/validateTransitionResponse';

export const DEFAULT_TIMEOUT_MS = null;
/** Node timers overflow above this value; reject invalid opt-in deadlines. */
export const MAX_TIMEOUT_MS = 2_147_483_647;
/** One generation attempt plus at most one repair attempt. */
export const MAX_ATTEMPTS = 2;

interface Execution<Request> {
  readonly executionId: string;
  readonly providerId: string;
  readonly request: Request;
  readonly timeoutMs?: number | null;
  readonly model?: string | null;
  readonly onStatus?: (event: ExecutionStatusEvent) => void;
}

export type GenerationExecution = Execution<PresentationGenerationRequest>;
export type TransitionRegenerationExecution = Execution<TransitionRegenerationRequest>;

type ExecutionResult<Response> =
  | {
      readonly status: 'succeeded';
      readonly executionId: string;
      readonly providerId: string;
      readonly response: Response;
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

export type PresentationGenerationResult = ExecutionResult<AgentPresentationResponse>;
export type TransitionRegenerationResult = ExecutionResult<AgentTransitionSettings>;

interface RequestIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * What differs between the kinds of work a provider does: the request
 * contract, the prompts, the provider method and the response validation.
 * Detection, cancellation, timeouts and the single repair attempt are shared.
 */
interface Task<Request, Response> {
  readonly parseRequest: (
    value: unknown,
  ) =>
    | { readonly success: true; readonly data: Request }
    | { readonly success: false; readonly issues: readonly RequestIssue[] };
  readonly responseJsonSchema: () => JsonSchema;
  readonly render: (request: Request, responseJsonSchema: JsonSchema) => AgentPrompt;
  readonly renderRepair: (input: {
    readonly request: Request;
    readonly responseJsonSchema: JsonSchema;
    readonly previousOutput: string;
    readonly issues: AgentError['issues'];
    readonly problem: string;
  }) => AgentPrompt;
  readonly invoke: (
    provider: AgentProvider,
    request: Request,
    context: AgentExecutionContext,
  ) => Promise<ProviderExecutionResult>;
  readonly validate: (
    output: unknown,
    request: Request,
  ) =>
    | {
        readonly ok: true;
        readonly value: { readonly response: Response; readonly warnings: readonly string[] };
      }
    | { readonly ok: false; readonly error: AgentError };
}

function parseWith<Request>(schema: {
  safeParse(
    value: unknown,
  ): { success: true; data: Request } | { success: false; error: { issues: RequestIssue[] } };
}): Task<Request, unknown>['parseRequest'] {
  return (value) => {
    const parsed = schema.safeParse(value);
    return parsed.success
      ? { success: true, data: parsed.data }
      : { success: false, issues: parsed.error.issues };
  };
}

const PRESENTATION_TASK: Task<PresentationGenerationRequest, AgentPresentationResponse> = {
  parseRequest: parseWith(presentationGenerationRequestSchema),
  responseJsonSchema: getResponseJsonSchema,
  render: (request, responseJsonSchema) =>
    presentationGenerationPromptV4.render({ request, responseJsonSchema }),
  renderRepair: (input) => presentationRepairPromptV4.render(input),
  invoke: (provider, request, context) => provider.generatePresentation(request, context),
  validate: validateAgentResponse,
};

const TRANSITION_TASK: Task<TransitionRegenerationRequest, AgentTransitionSettings> = {
  parseRequest: parseWith(transitionRegenerationRequestSchema),
  responseJsonSchema: getTransitionResponseJsonSchema,
  render: (request, responseJsonSchema) =>
    transitionRegenerationPromptV1.render({ request, responseJsonSchema }),
  renderRepair: (input) => transitionRepairPromptV1.render(input),
  invoke: (provider, request, context) => provider.generateTransition(request, context),
  validate: (output, request) => {
    const validated = validateTransitionResponse(output, request);
    return validated.ok
      ? {
          ok: true,
          value: { response: validated.value.settings, warnings: validated.value.warnings },
        }
      : validated;
  },
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

  execute(execution: GenerationExecution): Promise<PresentationGenerationResult> {
    return this.#execute(execution, PRESENTATION_TASK);
  }

  /** Asks a provider for new settings of one transition. Nothing is applied here. */
  executeTransition(
    execution: TransitionRegenerationExecution,
  ): Promise<TransitionRegenerationResult> {
    return this.#execute(execution, TRANSITION_TASK);
  }

  async #execute<Request, Response>(
    execution: Execution<Request>,
    task: Task<Request, Response>,
  ): Promise<ExecutionResult<Response>> {
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
    const fail = (error: AgentError): ExecutionResult<Response> => {
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
    const request = task.parseRequest(execution.request);
    if (!request.success) {
      return fail(
        agentError(
          'invalidRequest',
          'The request could not be sent because it is not valid.',
          request.issues.map((issue) => ({
            code: 'schema',
            path: issue.path.map(String).join('.'),
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
      return await this.#run(provider, request.data, execution, task, running, {
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

  async #run<Request, Response>(
    provider: AgentProvider,
    request: Request,
    execution: Execution<Request>,
    task: Task<Request, Response>,
    running: RunningExecution,
    tools: {
      readonly attempts: AttemptDiagnostics[];
      readonly report: (phase: ExecutionPhase, message: string) => void;
      readonly fail: (error: AgentError) => ExecutionResult<Response>;
      readonly diagnostics: () => ExecutionDiagnostics;
      readonly timeoutMs: number | null;
      readonly setPromptTemplate: (value: string) => void;
    },
  ): Promise<ExecutionResult<Response>> {
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

    const responseJsonSchema = task.responseJsonSchema();
    let prompt: AgentPrompt = task.render(request, responseJsonSchema);
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
        task.invoke(provider, request, {
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
      const validated = resolved.ok ? task.validate(resolved.value, request) : resolved;

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
      prompt = task.renderRepair({
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
