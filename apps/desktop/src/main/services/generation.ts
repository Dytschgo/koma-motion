import {
  agentError,
  buildGenerationRequest,
  buildTransitionRegenerationRequest,
  convertResponseToPresentation,
  mergeSelectedKoma,
  type AgentError,
  type ExecutionOutputEvent,
  type ExecutionStatusEvent,
  type GenerationInput,
  type GenerationRunner,
} from '@koma-motion/agent-runtime';
import {
  appendGenerationHistory,
  komaProjectSchema,
  PROJECT_TOO_LARGE_MESSAGE,
  createSeededIdGenerator,
  hashString,
  type GenerationHistoryEntry,
  type GenerationStatus,
  type IdGenerator,
  type KomaProject,
} from '@koma-motion/core';
import type { GenerationOutcome, TransitionRegenerationOutcome } from '../../shared/ipc';
import type { ImageGenerator } from '@koma-motion/agent-runtime/node';
import { generateRequestedImages } from './generatedImages';

const MAX_SUMMARY_LENGTH = 400;

function firstLine(text: string): string {
  return (text.split('\n')[0] ?? '').slice(0, MAX_SUMMARY_LENGTH);
}

/**
 * Runs one generation request from chat input to a proposal for the project.
 *
 * The result is a complete, validated presentation or an error. The project
 * itself is never changed here: the renderer applies a successful proposal as
 * one step, so a failed generation cannot leave a partly changed project.
 */
export async function generatePresentation(options: {
  readonly runner: GenerationRunner;
  readonly executionId: string;
  readonly providerId: string;
  readonly project: KomaProject;
  readonly input: GenerationInput;
  readonly idGenerator: IdGenerator;
  readonly now: () => Date;
  readonly onStatus: (event: ExecutionStatusEvent) => void;
  /** Receives text the provider writes for the user while it works. */
  readonly onOutput?: (event: ExecutionOutputEvent) => void;
  readonly signal?: AbortSignal;
  readonly generateImage?: ImageGenerator;
}): Promise<GenerationOutcome> {
  const { runner, executionId, providerId, project, input, now, onStatus, onOutput } = options;
  const request = buildGenerationRequest(project, input);
  const configuration = project.agentConfiguration;

  const historyEntry = (
    status: GenerationStatus,
    summary: string,
    warnings: readonly string[] = [],
  ): GenerationHistoryEntry => ({
    id: options.idGenerator.next('generation'),
    createdAt: now().toISOString(),
    providerId,
    userRequest: request.userRequest,
    status,
    summary: summary.slice(0, MAX_SUMMARY_LENGTH),
    warnings: warnings.slice(0, 50).map((warning) => warning.slice(0, 1000)),
  });

  const result = await runner.execute({
    executionId,
    providerId,
    request,
    timeoutMs: configuration.timeoutSeconds === null ? null : configuration.timeoutSeconds * 1000,
    model: configuration.providers[providerId]?.model ?? null,
    reasoning:
      configuration.providers[providerId]?.reasoningByModel?.[
        configuration.providers[providerId]?.model ?? ''
      ] ?? null,
    onStatus,
    ...(onOutput === undefined ? {} : { onOutput }),
  });

  const failed = (
    status: Exclude<GenerationStatus, 'succeeded'>,
    error: AgentError,
  ): GenerationOutcome => ({
    status,
    error,
    historyEntry: historyEntry(status, firstLine(error.message)),
    diagnostics: result.diagnostics,
  });

  if (result.status !== 'succeeded') {
    return failed(result.status, result.error);
  }

  let response = result.response;
  const assets: KomaProject['assets'] = [];
  if (
    (configuration.imageGeneration === 'codex' || configuration.imageGeneration === 'grok') &&
    (response.imageRequests?.length ?? 0) > 0
  ) {
    try {
      const generated = await generateRequestedImages({
        response,
        provider: configuration.imageGeneration,
        signal: options.signal ?? AbortSignal.timeout(600_000),
        idGenerator: options.idGenerator,
        ...(options.generateImage ? { generateImage: options.generateImage } : {}),
        onProgress: (message) =>
          onStatus({ executionId, phase: 'generating', message, timestamp: now().toISOString() }),
      });
      response = generated.response;
      assets.push(...generated.assets);
    } catch (error) {
      const timedOut =
        options.signal?.aborted &&
        options.signal.reason instanceof DOMException &&
        options.signal.reason.name === 'TimeoutError';
      const status = timedOut ? 'timedOut' : options.signal?.aborted ? 'cancelled' : 'failed';
      return failed(
        status,
        agentError(
          status === 'failed' ? 'executionFailed' : status,
          status === 'cancelled'
            ? 'Image generation was stopped. No Komas were replaced.'
            : status === 'timedOut'
              ? 'Image generation timed out. No Komas were replaced.'
              : `${error instanceof Error ? error.message : 'Image generation failed.'} No Komas were replaced.`,
        ),
      );
    }
  }
  if (options.signal?.aborted)
    return failed(
      'cancelled',
      agentError('cancelled', 'Generation was stopped. No Komas were replaced.'),
    );

  onStatus({
    executionId,
    phase: 'converting',
    message: 'Computing the motion between the Komas',
    timestamp: now().toISOString(),
  });
  // The same request always leads to the same identifiers.
  const seed = hashString(JSON.stringify({ providerId, request }));
  const converted = convertResponseToPresentation(response, {
    request: {
      ...request,
      availableAssets: [
        ...request.availableAssets,
        ...assets.map(({ id, name }) => ({ id, name })),
      ],
    },
    idGenerator: createSeededIdGenerator(seed),
  });
  if (!converted.ok) {
    return failed('failed', converted.error);
  }

  const { presentation } = converted.value;
  const warnings = [...result.warnings, ...converted.value.warnings];
  if (result.repaired) {
    warnings.push('The first response of the provider was not valid. It was corrected once.');
  }
  const count = presentation.komas.length;
  const entry = historyEntry(
    'succeeded',
    `Created ${String(count)} ${count === 1 ? 'Koma' : 'Komas'}: ${presentation.komas.map((koma) => koma.title).join(', ')}`,
    warnings,
  );
  let candidateProject;
  try {
    const proposed = presentation.komas[0];
    candidateProject =
      request.targetKoma !== undefined && proposed !== undefined
        ? mergeSelectedKoma(
            project,
            request.targetKoma.id,
            proposed,
            assets,
            entry,
            createSeededIdGenerator(seed),
          )
        : appendGenerationHistory(
            { ...project, presentation, assets: [...project.assets, ...assets] },
            entry,
          );
  } catch {
    return failed(
      'failed',
      agentError(
        'conversionFailed',
        'The selected-Koma proposal could not be safely merged. No Komas were replaced.',
      ),
    );
  }
  const candidate = komaProjectSchema.safeParse(candidateProject);
  if (!candidate.success) {
    const tooLarge = candidate.error.issues.some(
      (issue) => issue.message === PROJECT_TOO_LARGE_MESSAGE,
    );
    return failed(
      'failed',
      agentError(
        tooLarge ? 'outputTooLarge' : 'conversionFailed',
        tooLarge
          ? PROJECT_TOO_LARGE_MESSAGE
          : 'The generated presentation could not be applied to this project. No Komas were replaced.',
      ),
    );
  }
  return {
    status: 'succeeded',
    presentation,
    assets,
    historyEntry: entry,
    warnings,
    repaired: result.repaired,
    diagnostics: result.diagnostics,
  };
}

/**
 * Asks the selected provider for new settings of one transition.
 *
 * The provider sees the two Komas and the motion derived from them, and
 * answers with timing and a rationale only. Its answer is validated here; the
 * renderer rebuilds the transition from the Komas as they are when the answer
 * arrives, and discards it if either Koma changed in the meantime.
 */
export async function regenerateTransition(options: {
  readonly runner: GenerationRunner;
  readonly executionId: string;
  readonly providerId: string;
  readonly project: KomaProject;
  readonly transitionId: string;
  readonly onStatus: (event: ExecutionStatusEvent) => void;
  readonly now: () => Date;
}): Promise<TransitionRegenerationOutcome> {
  const { runner, executionId, providerId, project, transitionId, onStatus, now } = options;
  const request = buildTransitionRegenerationRequest(project, transitionId);
  if (!request.ok) {
    const timestamp = now().toISOString();
    onStatus({ executionId, phase: 'failed', message: request.error.message, timestamp });
    return {
      status: 'failed',
      transitionId,
      error: request.error,
      diagnostics: {
        providerId,
        startedAt: timestamp,
        finishedAt: timestamp,
        durationMs: 0,
        promptTemplate: '',
        attempts: [],
      },
    };
  }
  const configuration = project.agentConfiguration;
  const result = await runner.executeTransition({
    executionId,
    providerId,
    request: request.value,
    timeoutMs: configuration.timeoutSeconds === null ? null : configuration.timeoutSeconds * 1000,
    model: configuration.providers[providerId]?.model ?? null,
    reasoning:
      configuration.providers[providerId]?.reasoningByModel?.[
        configuration.providers[providerId]?.model ?? ''
      ] ?? null,
    onStatus,
  });
  if (result.status !== 'succeeded') {
    return {
      status: result.status,
      transitionId,
      error: result.error,
      diagnostics: result.diagnostics,
    };
  }
  const warnings = [...result.warnings];
  if (result.repaired) {
    warnings.push('The first response of the provider was not valid. It was corrected once.');
  }
  return {
    status: 'succeeded',
    transitionId,
    settings: {
      strategy: result.response.strategy,
      duration: result.response.durationMs,
      easing: result.response.easing,
      rationale: result.response.rationale,
    },
    warnings,
    diagnostics: result.diagnostics,
  };
}
