/** Provider detection and generation: the steps between the chat panel and the main process. */
import type { GenerationInput } from '@koma-motion/agent-runtime';
import { useAgentStore } from '../state/agentStore';
import { applyGeneration, recordGeneration } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { invoke } from './api';

function createExecutionId(): string {
  return `execution-${crypto.randomUUID()}`;
}

export async function detectProviders(): Promise<void> {
  const agent = useAgentStore.getState();
  agent.setDetection('running');
  try {
    const { providers } = await invoke('koma:providers:detect', {});
    useAgentStore.getState().setDetection('done', providers);
  } catch {
    useAgentStore.getState().setDetection('failed');
  }
}

/**
 * Sends a request to the selected provider and applies the result.
 *
 * A successful result replaces the presentation in one undoable step. When
 * generation fails, the presentation stays exactly as it was.
 */
export async function generate(input: GenerationInput): Promise<void> {
  const project = selectProject(useProjectStore.getState());
  const agent = useAgentStore.getState();
  if (project === null || agent.execution !== null) {
    return;
  }
  const providerId = project.agentConfiguration.selectedProviderId;
  const providerName =
    agent.providers.find((provider) => provider.metadata.id === providerId)?.metadata.displayName ??
    providerId;
  const executionId = createExecutionId();

  agent.addEntry({ kind: 'request', text: input.userRequest });
  agent.startExecution({ executionId, providerId, providerName });

  try {
    const outcome = await invoke('koma:providers:execute', {
      executionId,
      providerId,
      project,
      input,
    });
    const projects = useProjectStore.getState();
    if (outcome.status === 'succeeded') {
      projects.apply(applyGeneration(outcome.presentation, outcome.historyEntry));
      useUiStore.getState().selectKoma(outcome.presentation.komas[0]?.id ?? null);
      useAgentStore.getState().addEntry({
        kind: 'result',
        providerName,
        text: outcome.historyEntry.summary,
        warnings: outcome.warnings,
      });
    } else {
      projects.apply(recordGeneration(outcome.historyEntry));
      useAgentStore.getState().addEntry({
        kind: 'failure',
        providerName,
        status: outcome.status,
        error: outcome.error,
        diagnostics: outcome.diagnostics,
        request: input.userRequest,
      });
    }
  } catch {
    useAgentStore.getState().addEntry({
      kind: 'failure',
      providerName,
      status: 'failed',
      error: {
        code: 'internalError',
        message: 'The application could not complete the request.',
        issues: [],
      },
      diagnostics: {
        providerId,
        startedAt: new Date().toISOString(),
        finishedAt: new Date().toISOString(),
        durationMs: 0,
        promptTemplate: '',
        attempts: [],
      },
      request: input.userRequest,
    });
  } finally {
    useAgentStore.getState().finishExecution();
  }
}

export async function cancelGeneration(): Promise<void> {
  const { execution, requestCancel } = useAgentStore.getState();
  if (execution === null) {
    return;
  }
  requestCancel();
  try {
    await invoke('koma:providers:cancel', { executionId: execution.executionId });
  } catch {
    useUiStore.getState().notify('error', 'The generation could not be stopped.');
  }
}
