import {
  buildGenerationRequest,
  convertResponseToPresentation,
  type AgentError,
  type ExecutionStatusEvent,
  type GenerationInput,
  type GenerationRunner,
} from '@koma-motion/agent-runtime';
import {
  createSeededIdGenerator,
  hashString,
  type GenerationHistoryEntry,
  type GenerationStatus,
  type IdGenerator,
  type KomaProject,
} from '@koma-motion/core';
import type { GenerationOutcome } from '../../shared/ipc';

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
}): Promise<GenerationOutcome> {
  const { runner, executionId, providerId, project, input, now, onStatus } = options;
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
    timeoutMs: configuration.timeoutSeconds * 1000,
    model: configuration.providers[providerId]?.model ?? null,
    onStatus,
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

  onStatus({
    executionId,
    phase: 'converting',
    message: 'Computing the motion between the Komas',
    timestamp: now().toISOString(),
  });
  // The same request always leads to the same identifiers.
  const seed = hashString(JSON.stringify({ providerId, request }));
  const converted = convertResponseToPresentation(result.response, {
    request,
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
  return {
    status: 'succeeded',
    presentation,
    historyEntry: historyEntry(
      'succeeded',
      `Created ${String(count)} ${count === 1 ? 'Koma' : 'Komas'}: ${presentation.komas.map((koma) => koma.title).join(', ')}`,
      warnings,
    ),
    warnings,
    repaired: result.repaired,
    diagnostics: result.diagnostics,
  };
}
