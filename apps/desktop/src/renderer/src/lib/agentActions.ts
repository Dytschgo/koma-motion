/** Provider detection and generation: the steps between the chat panel and the main process. */
import {
  agentError,
  type GenerationInput,
  type ProviderMetadata,
  type ResponseIssue,
} from '@koma-motion/agent-runtime';
import type { KomaProject, Presentation } from '@koma-motion/core';
import { useAgentStore, type RunResult } from '../state/agentStore';
import { applyGeneration, recordGeneration } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import {
  applyScopedProposal,
  scopedProposalIssue,
  scopedSnapshotIssue,
  type ScopedProposal,
} from '../state/scopedGeneration';
import { invoke } from './api';

// Invalidation is permanent, including an edit followed by Undo while a proposal waits.
useProjectStore.subscribe((state) => {
  const proposal = useAgentStore.getState().scopedProposal;
  if (proposal === null || proposal.invalidReason !== null) return;
  const issue = scopedProposalIssue(proposal, selectProject(state), state.sessionId);
  if (issue) useAgentStore.getState().setScopedProposal({ ...proposal, invalidReason: issue });
});

export function discardScopedProposal(): void {
  useAgentStore.getState().setScopedProposal(null);
}

export function acceptScopedProposal(): void {
  const proposal = useAgentStore.getState().scopedProposal;
  if (proposal === null) return;
  try {
    useProjectStore
      .getState()
      .apply(applyScopedProposal(proposal, useProjectStore.getState().sessionId));
    useUiStore.getState().selectKoma(proposal.target.id);
    useAgentStore.getState().setScopedProposal(null);
    useAgentStore.getState().addEntry({
      kind: 'result',
      providerName: proposal.providerName,
      text: `Applied proposal to ${proposal.target.title || 'selected Koma'}.`,
      warnings: proposal.warnings,
    });
  } catch (error) {
    const issue =
      error instanceof Error ? error.message : 'This proposal cannot be applied. Generate again.';
    useAgentStore.getState().setScopedProposal({ ...proposal, invalidReason: issue });
  }
}

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

/** The model a run starts with, in words. */
function describeModel(
  metadata: ProviderMetadata | undefined,
  model: string | null | undefined,
): string {
  if (metadata === undefined || !metadata.supportsModelSelection) return 'built-in';
  return model ?? metadata.defaultModel ?? 'default model';
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
  if (project === null || agent.execution !== null || agent.scopedProposal !== null) {
    return;
  }
  const providerId = project.agentConfiguration.selectedProviderId;
  const target =
    input.targetKomaId === undefined
      ? undefined
      : project.presentation.komas.find((koma) => koma.id === input.targetKomaId);
  if (input.targetKomaId !== undefined && target === undefined) {
    useUiStore.getState().notify('error', 'Select a current Koma and generate again.');
    return;
  }
  let snapshotIssue: string | null = null;
  const unsubscribeSnapshot =
    target === undefined
      ? () => undefined
      : useProjectStore.subscribe((state) => {
          snapshotIssue ??= scopedSnapshotIssue(
            { sessionId, target, originalAssets: project.assets },
            selectProject(state),
            state.sessionId,
          );
        });
  const presentationAtStart = project.presentation;
  const metadata = agent.providers.find(
    (provider) => provider.metadata.id === providerId,
  )?.metadata;
  const providerName = metadata?.displayName ?? providerId;
  const executionId = createExecutionId();

  agent.addEntry({
    kind: 'request',
    text: input.userRequest,
    ...(input.references?.length
      ? { referenceNames: input.references.map((reference) => reference.name) }
      : {}),
  });
  agent.startExecution({
    executionId,
    providerId,
    providerName,
    streams: metadata?.streamsOutput ?? false,
    modelLabel: describeModel(metadata, project.agentConfiguration.providers[providerId]?.model),
  });

  /** The text this run streamed, kept with its outcome in the conversation. */
  const streamed = (): { output?: string } => {
    const execution = useAgentStore.getState().execution;
    return execution?.executionId === executionId && execution.output.text.trim() !== ''
      ? { output: execution.output.text }
      : {};
  };

  /** A project switch invalidates this run. Its output must not land in the replacement. */
  const stillThisProject = (): boolean => useProjectStore.getState().sessionId === sessionId;

  /** How the run ended, for the activity in the chat. A run that throws failed. */
  let result: RunResult = 'failed';
  try {
    const outcome = await invoke('koma:providers:execute', {
      executionId,
      providerId,
      project,
      input,
    });
    result =
      outcome.status === 'succeeded'
        ? 'completed'
        : outcome.status === 'cancelled'
          ? 'cancelled'
          : 'failed';
    if (!stillThisProject()) {
      return;
    }
    if (outcome.status === 'succeeded') {
      if (target !== undefined) {
        if (useAgentStore.getState().execution?.cancelRequested) {
          result = 'cancelled';
          useAgentStore.getState().addEntry({
            ...streamed(),
            kind: 'notApplied',
            providerName,
            text: 'The selected-Koma proposal was stopped. Nothing was changed.',
          });
          return;
        }
        const proposed = outcome.presentation.komas[0];
        if (outcome.presentation.komas.length !== 1 || proposed === undefined)
          throw new Error('A selected-Koma response must contain one Koma.');
        const proposal: ScopedProposal = {
          sessionId,
          target,
          originalAssets: project.assets,
          proposed,
          assets: outcome.assets ?? [],
          historyEntry: outcome.historyEntry,
          providerName,
          warnings: outcome.warnings,
          invalidReason: snapshotIssue,
        };
        const current = selectProject(useProjectStore.getState());
        const issue = scopedProposalIssue(proposal, current, useProjectStore.getState().sessionId);
        useAgentStore.getState().setScopedProposal({ ...proposal, invalidReason: issue });
        useAgentStore.getState().addEntry({
          ...streamed(),
          kind: 'notApplied',
          providerName,
          text: `Proposal ready for ${target.title || 'selected Koma'}. Review it before applying.`,
        });
        return;
      }
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
            ...streamed(),
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
      const issues = unavailableImageIssues(outcome.presentation, {
        ...currentProject,
        assets: [...currentProject.assets, ...(outcome.assets ?? [])],
      });
      if (issues.length > 0) {
        result = 'failed';
        const error = agentError(
          'invalidResponse',
          'The generated Komas use images that are no longer available in this project. Generate again with the current assets.',
          issues,
        );
        useAgentStore.getState().addStatus({
          executionId,
          phase: 'failed',
          message: error.message,
          timestamp: new Date().toISOString(),
        });
        useAgentStore.getState().addEntry({
          ...streamed(),
          kind: 'failure',
          providerName,
          status: 'failed',
          error,
          diagnostics: outcome.diagnostics,
          request: input.userRequest,
        });
        return;
      }
      useProjectStore
        .getState()
        .apply(applyGeneration(outcome.presentation, outcome.historyEntry, outcome.assets));
      useUiStore.getState().selectKoma(outcome.presentation.komas[0]?.id ?? null);
      useAgentStore.getState().addEntry({
        ...streamed(),
        kind: 'result',
        providerName,
        text: outcome.historyEntry.summary,
        warnings: outcome.warnings,
      });
    } else {
      if (target === undefined)
        useProjectStore.getState().apply(recordGeneration(outcome.historyEntry));
      useAgentStore.getState().addEntry({
        ...streamed(),
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
    result = 'failed';
    const error = agentError('internalError', 'The application could not complete the request.');
    useAgentStore.getState().addStatus({
      executionId,
      phase: 'failed',
      message: error.message,
      timestamp: new Date().toISOString(),
    });
    useAgentStore.getState().addEntry({
      ...streamed(),
      kind: 'failure',
      providerName,
      status: 'failed',
      error,
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
    unsubscribeSnapshot();
    useAgentStore.getState().finishExecution(executionId, result);
  }
}

/** Asks a provider's CLI for the models of the signed-in account. */
export async function listProviderModels(providerId: string): Promise<void> {
  if (useAgentStore.getState().modelListings[providerId] === 'loading') return;
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
