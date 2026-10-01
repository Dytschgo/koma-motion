/** Provider detection and generation: the steps between the chat panel and the main process. */
import { agentError, type GenerationInput, type ResponseIssue } from '@koma-motion/agent-runtime';
import type { KomaProject, Presentation } from '@koma-motion/core';
import { useAgentStore } from '../state/agentStore';
import { applyGeneration, recordGeneration } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { invoke } from './api';

function createExecutionId(): string {
  return `execution-${crypto.randomUUID()}`;
}

/** Another action can replace a confirmation opened by an earlier action. */
function waitForConfirmationToClose(): Promise<void> {
  return new Promise((resolve) => {
    const unsubscribe = useUiStore.subscribe((state) => {
      if (state.confirmation === null) {
        unsubscribe();
        resolve();
      }
    });
  });
}

/** A proposal may outlive an asset edit, so check its images against the live project. */
function unavailableImageIssues(presentation: Presentation, project: KomaProject): ResponseIssue[] {
  const available = new Set(
    project.assets.filter((asset) => asset.embeddedData !== null).map((asset) => asset.id),
  );
  const issues: ResponseIssue[] = [];
  presentation.komas.forEach((koma, komaIndex) => {
    koma.elements.forEach((element, elementIndex) => {
      const path = `komas[${String(komaIndex)}].elements[${String(elementIndex)}]`;
      if (element.type === 'image' && !available.has(element.content.assetId)) {
        issues.push({
          code: 'invalidReference',
          path: `${path}.content.assetId`,
          message: `The image asset "${element.content.assetId}" is no longer available.`,
        });
      }
      if (element.type === 'group') {
        element.content.children.forEach((child, childIndex) => {
          if (child.type === 'image' && !available.has(child.content.assetId)) {
            issues.push({
              code: 'invalidReference',
              path: `${path}.content.children[${String(childIndex)}].content.assetId`,
              message: `The image asset "${child.content.assetId}" is no longer available.`,
            });
          }
        });
      }
    });
  });
  return issues;
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
 * A successful result replaces an unchanged presentation in one undoable step.
 * If the presentation changes while generation runs, the user chooses whether
 * to replace those edits. A failed result leaves the presentation untouched.
 */
export async function generate(input: GenerationInput): Promise<void> {
  const project = selectProject(useProjectStore.getState());
  const sessionId = useProjectStore.getState().sessionId;
  const agent = useAgentStore.getState();
  if (project === null || agent.execution !== null) {
    return;
  }
  const providerId = project.agentConfiguration.selectedProviderId;
  const presentationAtStart = project.presentation;
  const providerName =
    agent.providers.find((provider) => provider.metadata.id === providerId)?.metadata.displayName ??
    providerId;
  const executionId = createExecutionId();

  agent.addEntry({ kind: 'request', text: input.userRequest });
  agent.startExecution({ executionId, providerId, providerName });

  /** A project switch invalidates this run. Its output must not land in the replacement. */
  const stillThisProject = (): boolean => useProjectStore.getState().sessionId === sessionId;

  try {
    const outcome = await invoke('koma:providers:execute', {
      executionId,
      providerId,
      project,
      input,
    });
    if (!stillThisProject()) {
      return;
    }
    if (outcome.status === 'succeeded') {
      let currentPresentation = selectProject(useProjectStore.getState())?.presentation;
      while (currentPresentation !== presentationAtStart) {
        const presentationAtPrompt = currentPresentation;
        useAgentStore.getState().addStatus({
          executionId,
          phase: 'succeeded',
          message: 'Generation complete. Waiting for your decision',
          timestamp: new Date().toISOString(),
        });
        const replace = await useUiStore.getState().confirm({
          title: 'Replace your edited Komas?',
          message:
            'Generation is complete, but you edited the Komas while it was running. Replacing them discards those edits. Keep editing discards the generated Komas.',
          confirmLabel: 'Replace Komas',
          cancelLabel: 'Keep editing',
          destructive: true,
        });
        if (!stillThisProject()) {
          return;
        }
        if (!replace) {
          // A different confirmation displaced ours. Let that action finish,
          // then offer this completed proposal again if this project remains.
          if (useUiStore.getState().confirmation !== null) {
            await waitForConfirmationToClose();
            if (!stillThisProject()) {
              return;
            }
            currentPresentation = selectProject(useProjectStore.getState())?.presentation;
            continue;
          }
          useAgentStore.getState().addEntry({
            kind: 'notApplied',
            providerName,
            text: outcome.historyEntry.summary,
          });
          return;
        }
        currentPresentation = selectProject(useProjectStore.getState())?.presentation;
        if (currentPresentation === presentationAtPrompt) {
          break;
        }
      }
      const currentProject = selectProject(useProjectStore.getState());
      if (currentProject === null) {
        return;
      }
      const issues = unavailableImageIssues(outcome.presentation, currentProject);
      if (issues.length > 0) {
        useAgentStore.getState().addEntry({
          kind: 'failure',
          providerName,
          status: 'failed',
          error: agentError(
            'invalidResponse',
            'The generated Komas use images that are no longer available in this project. Generate again with the current assets.',
            issues,
          ),
          diagnostics: outcome.diagnostics,
          request: input.userRequest,
        });
        return;
      }
      useProjectStore.getState().apply(applyGeneration(outcome.presentation, outcome.historyEntry));
      useUiStore.getState().selectKoma(outcome.presentation.komas[0]?.id ?? null);
      useAgentStore.getState().addEntry({
        kind: 'result',
        providerName,
        text: outcome.historyEntry.summary,
        warnings: outcome.warnings,
      });
    } else {
      useProjectStore.getState().apply(recordGeneration(outcome.historyEntry));
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
    if (!stillThisProject()) {
      return;
    }
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
    useAgentStore.getState().finishExecution(executionId);
  }
}

/** Asks a provider's CLI for the models of the signed-in account. */
export async function listProviderModels(providerId: string): Promise<void> {
  useAgentStore.getState().setModelListing(providerId, 'loading');
  try {
    const listing = await invoke('koma:providers:list-models', { providerId });
    useAgentStore.getState().setModelListing(providerId, listing);
  } catch {
    useAgentStore.getState().setModelListing(providerId, {
      status: 'failed',
      message: 'The models could not be listed. Try again.',
    });
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
