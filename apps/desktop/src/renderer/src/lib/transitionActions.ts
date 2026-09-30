/**
 * Regenerating one transition that no longer matches its Komas.
 *
 * The selected provider proposes new timing. The motion itself is rebuilt
 * from the two Komas as they are when the answer arrives, and only if neither
 * Koma nor the transition changed while the provider was working. Otherwise
 * the answer is discarded and the warning stays, with the reason.
 */
import type { Koma, KomaTransition, Presentation } from '@koma-motion/core';
import { fingerprintKoma } from '@koma-motion/motion-engine';
import { useAgentStore } from '../state/agentStore';
import { regenerateTransitionMotion } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import {
  selectRunningRegeneration,
  useTransitionRegenerationStore,
} from '../state/transitionRegenerationStore';
import { useUiStore } from '../state/uiStore';
import { invoke } from './api';
import { assessTransition } from './transitionIssues';

interface Endpoints {
  readonly transition: KomaTransition;
  readonly from: Koma;
  readonly to: Koma;
}

/** The transition and its Komas, when they are still neighbours in this order. */
function findEndpoints(presentation: Presentation, transitionId: string): Endpoints | null {
  const transition = presentation.transitions.find((item) => item.id === transitionId);
  if (transition === undefined) return null;
  const fromIndex = presentation.komas.findIndex((koma) => koma.id === transition.fromKomaId);
  const from = presentation.komas[fromIndex];
  const to = presentation.komas[fromIndex + 1];
  return from === undefined || to?.id !== transition.toKomaId ? null : { transition, from, to };
}

function sameSettings(a: KomaTransition, b: KomaTransition): boolean {
  return (
    a.strategy === b.strategy &&
    a.duration === b.duration &&
    a.easing === b.easing &&
    a.rationale === b.rationale
  );
}

function describeProvider(providerId: string, model: string | null): string {
  const name =
    useAgentStore.getState().providers.find((provider) => provider.metadata.id === providerId)
      ?.metadata.displayName ?? providerId;
  return model === null ? name : `${name} (${model})`;
}

/** Why a finished answer no longer fits the project, or `null` when it can be applied. */
function describeConflict(start: Endpoints, now: Endpoints): string | null {
  const changed = [
    now.from.id !== start.from.id || fingerprintKoma(now.from) !== fingerprintKoma(start.from)
      ? `"${now.from.title}"`
      : null,
    now.to.id !== start.to.id || fingerprintKoma(now.to) !== fingerprintKoma(start.to)
      ? `"${now.to.title}"`
      : null,
  ].filter((item) => item !== null);
  if (changed.length > 0) {
    return `${changed.join(' and ')} changed while the transition was being regenerated. The result was discarded so that it cannot overwrite your edit. Regenerate again to use the current content.`;
  }
  if (!sameSettings(start.transition, now.transition)) {
    return 'You changed the settings of this transition while it was being regenerated. The result was discarded so that your settings are kept. Regenerate again if you still want new motion.';
  }
  return null;
}

export async function regenerateTransition(transitionId: string): Promise<void> {
  const project = selectProject(useProjectStore.getState());
  const sessionId = useProjectStore.getState().sessionId;
  const store = useTransitionRegenerationStore.getState();
  if (project === null || selectRunningRegeneration(store, sessionId) !== null) {
    return;
  }
  const start = findEndpoints(project.presentation, transitionId);
  if (start === null) {
    return;
  }
  const providerId = project.agentConfiguration.selectedProviderId;
  const providerName = describeProvider(
    providerId,
    project.agentConfiguration.providers[providerId]?.model ?? null,
  );
  const executionId = `transition-${crypto.randomUUID()}`;
  store.start({
    status: 'running',
    transitionId,
    sessionId,
    executionId,
    providerName,
    progress: 'Starting',
    cancelRequested: false,
  });
  const finish = useTransitionRegenerationStore.getState().finish;
  const stillThisProject = (): boolean => useProjectStore.getState().sessionId === sessionId;
  const failed = (status: 'failed' | 'cancelled' | 'discarded', message: string): void => {
    finish(executionId, { status, transitionId, sessionId, providerName, message });
  };

  try {
    const outcome = await invoke('koma:providers:regenerate-transition', {
      executionId,
      providerId,
      project,
      transitionId,
    });
    if (!stillThisProject()) {
      finish(executionId, null);
      return;
    }
    if (outcome.status === 'cancelled') {
      failed('cancelled', 'Regeneration was stopped. The transition was not changed.');
      return;
    }
    if (outcome.status !== 'succeeded') {
      failed('failed', outcome.error.message);
      return;
    }
    const current = selectProject(useProjectStore.getState());
    const now = current === null ? null : findEndpoints(current.presentation, transitionId);
    if (current === null || now === null) {
      // The transition is gone, and with it the warning.
      finish(executionId, null);
      return;
    }
    const conflict = describeConflict(start, now);
    if (conflict !== null) {
      failed('discarded', conflict);
      return;
    }
    useProjectStore.getState().apply(regenerateTransitionMotion(transitionId, outcome.settings));
    const applied = selectProject(useProjectStore.getState());
    const result = applied === null ? null : findEndpoints(applied.presentation, transitionId);
    if (
      applied === null ||
      result === null ||
      result.transition === now.transition ||
      assessTransition(applied.presentation, result.transition, result.from, result.to)?.blocked ===
        true
    ) {
      failed(
        'failed',
        'The transition could not be rebuilt from its Komas. It was not changed. Check both Komas and try again.',
      );
      return;
    }
    finish(executionId, null);
    useUiStore
      .getState()
      .notify(
        'info',
        `The transition from "${result.from.title}" to "${result.to.title}" was regenerated and can play again.`,
      );
  } catch {
    if (!stillThisProject()) {
      finish(executionId, null);
      return;
    }
    failed(
      'failed',
      'The application could not complete the request. The transition was not changed.',
    );
  }
}

export async function cancelTransitionRegeneration(): Promise<void> {
  const sessionId = useProjectStore.getState().sessionId;
  const store = useTransitionRegenerationStore.getState();
  const running = selectRunningRegeneration(store, sessionId);
  if (running === null) {
    return;
  }
  store.requestCancel(running.executionId);
  try {
    await invoke('koma:providers:cancel', { executionId: running.executionId });
  } catch {
    useUiStore.getState().notify('error', 'The regeneration could not be stopped.');
  }
}
