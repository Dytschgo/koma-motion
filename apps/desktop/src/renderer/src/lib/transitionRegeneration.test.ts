import type { KomaProject, KomaTransition, ShapeElement } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { buildTransition } from '@koma-motion/motion-engine';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcResponse } from '../../../shared/ipc';
import { changeElement, changeTransition, regenerateTransitionMotion } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useTransitionRegenerationStore } from '../state/transitionRegenerationStore';
import { useUiStore } from '../state/uiStore';
import { invoke } from './api';
import { cancelTransitionRegeneration, regenerateTransition } from './transitionActions';
import { assessTransition } from './transitionIssues';

vi.mock('./api', () => ({
  invoke: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}));

const invokeMock = vi.mocked(invoke);
type Outcome = IpcResponse<'koma:providers:regenerate-transition'>;

function mockChannels(handler: (channel: string, request: unknown) => Promise<unknown>): void {
  invokeMock.mockImplementation(handler as typeof invoke);
}

function defer<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

const diagnostics = {
  providerId: 'claude-code',
  startedAt: '2026-09-30T12:00:00.000Z',
  finishedAt: '2026-09-30T12:00:01.000Z',
  durationMs: 1000,
  promptTemplate: 'transition-regeneration@1',
  attempts: [],
};

const succeeded: Outcome = {
  status: 'succeeded',
  transitionId: 'transition-1',
  settings: { strategy: 'staged', duration: 1400, easing: 'linear', rationale: 'Redone.' },
  warnings: [],
  diagnostics,
};

function failed(
  code: 'executionFailed' | 'invalidResponse' | 'providerUnavailable',
  message: string,
): Outcome {
  return {
    status: 'failed',
    transitionId: 'transition-1',
    error: { code, message, issues: [] },
    diagnostics,
  };
}

const mover = buildShape({
  id: 'mover-1',
  persistentId: 'mover',
  name: 'Mover',
  position: { x: 0, y: 0 },
});

function moved(id: string, x: number): ShapeElement {
  return { ...mover, id, position: { x, y: 0 } };
}

/**
 * Three Komas. The first transition is stale because the mover in "Start" was
 * moved after it was made; the second transition is valid.
 */
function staleProject(): KomaProject {
  const start = buildKoma({ id: 'koma-1', title: 'Start', elements: [mover] });
  const end = buildKoma({ id: 'koma-2', title: 'End', elements: [moved('mover-2', 400)] });
  const after = buildKoma({ id: 'koma-3', title: 'After', elements: [moved('mover-3', 400)] });
  const first = buildTransition({ id: 'transition-1', from: start, to: end });
  const second = buildTransition({ id: 'transition-2', from: end, to: after });
  if (!first.ok || !second.ok) throw new Error('Expected transitions');
  const project = buildProject({
    presentation: buildPresentation({
      komas: [start, end, after],
      transitions: [first.value.transition, second.value.transition],
    }),
  });
  const withProvider: KomaProject = {
    ...project,
    agentConfiguration: {
      ...project.agentConfiguration,
      selectedProviderId: 'claude-code',
      providers: { 'claude-code': { model: 'opus' } },
    },
  };
  // A visual edit keeps stored motion: this makes the first transition stale.
  return changeElement('koma-1', moved('mover-1', 200))(withProvider, {
    next: (prefix) => `${prefix}-x`,
  });
}

function current(): KomaProject {
  const project = selectProject(useProjectStore.getState());
  if (project === null) throw new Error('No project');
  return project;
}

function assessmentOf(
  project: KomaProject,
  transitionId: string,
): ReturnType<typeof assessTransition> {
  const { komas, transitions } = project.presentation;
  const transition = transitions.find((item) => item.id === transitionId);
  const fromIndex = komas.findIndex((koma) => koma.id === transition?.fromKomaId);
  const from = komas[fromIndex];
  const to = komas[fromIndex + 1];
  if (transition === undefined || from === undefined || to === undefined) {
    throw new Error('Expected a transition between neighbours');
  }
  return assessTransition(project.presentation, transition, from, to);
}

function entry():
  ReturnType<typeof useTransitionRegenerationStore.getState>['entries'][string] | undefined {
  return useTransitionRegenerationStore.getState().entries['transition-1'];
}

beforeEach(() => {
  invokeMock.mockReset();
  useTransitionRegenerationStore.setState({ entries: {} });
  useUiStore.setState({ notices: [] });
  useProjectStore.getState().load(staleProject(), null);
});

describe('assessTransition', () => {
  it('explains a stale transition by its Komas and the objects that changed', () => {
    const assessment = assessmentOf(current(), 'transition-1');
    expect(assessment).toMatchObject({
      blocked: true,
      remedy: 'regenerate',
      label: 'Out of date',
      headline: 'The transition from "Start" to "End" cannot play',
      reason:
        '"Start" or "End" changed after this motion was made, so it no longer matches "Mover".',
    });
    expect(assessmentOf(current(), 'transition-2')).toBeNull();
  });

  it('offers no fix for a broken Koma and names the Koma to correct', () => {
    const project = current();
    const [start, end] = project.presentation.komas;
    if (start === undefined || end === undefined) throw new Error('Expected Komas');
    const broken = { ...end, elements: [...end.elements, { ...mover, id: 'twin' }] };
    const transition = project.presentation.transitions[0];
    if (transition === undefined) throw new Error('Expected a transition');
    const presentation = { ...project.presentation, komas: [start, broken] };
    expect(assessTransition(presentation, transition, start, broken)).toMatchObject({
      blocked: true,
      remedy: 'editKoma',
      komasToEdit: ['target'],
      remedyText: expect.stringContaining('cannot fix this automatically') as unknown,
    });
  });

  it('calls damaged stored motion fixable by regeneration', () => {
    const project = current();
    const [start, end] = project.presentation.komas;
    const transition = project.presentation.transitions[0];
    if (start === undefined || end === undefined || transition === undefined) {
      throw new Error('Expected a transition');
    }
    const damaged: KomaTransition = {
      ...transition,
      elementTransitions: [
        {
          persistentId: 'mover',
          operation: 'move',
          from: { elementId: 'mover-1', position: { x: 0, y: 0 } },
          to: { elementId: 'missing', position: { x: 900, y: 0 } },
        },
      ],
    };
    expect(assessTransition(project.presentation, damaged, start, end)).toMatchObject({
      blocked: true,
      remedy: 'regenerate',
      label: 'Cannot play',
      reason: expect.stringContaining('The stored motion is damaged.') as unknown,
    });
  });

  it('says that motion from a newer version needs a later version, without a fix', () => {
    const project = current();
    const [, end, after] = project.presentation.komas;
    const transition = project.presentation.transitions[1];
    if (end === undefined || after === undefined || transition === undefined) {
      throw new Error('Expected a transition');
    }
    const future = {
      ...transition,
      elementTransitions: [
        ...transition.elementTransitions,
        { persistentId: 'mover', operation: 'morph', from: null, to: null },
      ],
    } as unknown as KomaTransition;
    expect(assessTransition(project.presentation, future, end, after)).toMatchObject({
      blocked: false,
      remedy: 'futureVersion',
      label: 'Partly skipped',
      remedyText: expect.stringContaining('needs a later version') as unknown,
    });
  });
});

describe('regenerateTransitionMotion', () => {
  it('replaces only the targeted transition and keeps both Komas', () => {
    const before = current();
    const after = regenerateTransitionMotion('transition-1', succeeded.settings)(before, {
      next: (prefix) => prefix,
    });
    expect(after.presentation.komas).toBe(before.presentation.komas);
    expect(after.presentation.transitions[1]).toBe(before.presentation.transitions[1]);
    expect(after.presentation.transitions[0]).toMatchObject({
      id: 'transition-1',
      strategy: 'staged',
      duration: 1400,
      easing: 'linear',
      rationale: 'Redone.',
    });
    expect(assessmentOf(after, 'transition-1')).toBeNull();
  });
});

describe('regenerateTransition', () => {
  it('asks the selected provider for the one transition and clears the warning on success', async () => {
    const before = current();
    mockChannels(() => Promise.resolve(succeeded));
    await regenerateTransition('transition-1');

    expect(invokeMock).toHaveBeenCalledWith('koma:providers:regenerate-transition', {
      executionId: expect.stringMatching(/^transition-/) as unknown,
      providerId: 'claude-code',
      project: before,
      transitionId: 'transition-1',
    });
    const after = current();
    expect(assessmentOf(after, 'transition-1')).toBeNull();
    expect(after.presentation.komas).toBe(before.presentation.komas);
    expect(after.presentation.transitions[1]).toBe(before.presentation.transitions[1]);
    expect(entry()).toBeUndefined();
    expect(useUiStore.getState().notices.at(-1)).toMatchObject({
      kind: 'info',
      message: 'The transition from "Start" to "End" was regenerated and can play again.',
    });

    // One undo step brings the stale transition back.
    useProjectStore.getState().undo();
    expect(current()).toBe(before);
  });

  it('keeps the warning and the project on provider failure, invalid output or unavailability, and allows a retry', async () => {
    const before = current();
    for (const outcome of [
      failed('executionFailed', 'Claude Code reported an error.'),
      failed(
        'invalidResponse',
        'The response of the agent does not follow the required structure:\neasing: bounce',
      ),
      failed('providerUnavailable', 'Claude Code is not installed.'),
    ]) {
      mockChannels(() => Promise.resolve(outcome));
      await regenerateTransition('transition-1');
      expect(current()).toBe(before);
      expect(entry()).toMatchObject({
        status: 'failed',
        providerName: 'claude-code (opus)',
        message: outcome.status === 'failed' ? outcome.error.message : '',
      });
      expect(assessmentOf(current(), 'transition-1')?.blocked).toBe(true);
    }

    mockChannels(() => Promise.reject(new Error('bridge lost')));
    await regenerateTransition('transition-1');
    expect(entry()).toMatchObject({ status: 'failed' });
    expect(current()).toBe(before);

    mockChannels(() => Promise.resolve(succeeded));
    await regenerateTransition('transition-1');
    expect(entry()).toBeUndefined();
    expect(assessmentOf(current(), 'transition-1')).toBeNull();
  });

  it('can be cancelled and then leaves the transition unchanged', async () => {
    const before = current();
    const execution = defer<Outcome>();
    mockChannels((channel) =>
      channel === 'koma:providers:cancel'
        ? Promise.resolve({ cancelled: true })
        : execution.promise,
    );
    const pending = regenerateTransition('transition-1');
    expect(entry()).toMatchObject({ status: 'running', providerName: 'claude-code (opus)' });

    // A second request while one runs starts nothing.
    await regenerateTransition('transition-2');
    expect(
      invokeMock.mock.calls.filter(
        ([channel]) => channel === 'koma:providers:regenerate-transition',
      ),
    ).toHaveLength(1);

    await cancelTransitionRegeneration();
    const running = entry();
    expect(running).toMatchObject({ status: 'running', cancelRequested: true });
    expect(invokeMock).toHaveBeenCalledWith('koma:providers:cancel', {
      executionId: running?.status === 'running' ? running.executionId : '',
    });
    execution.resolve({
      status: 'cancelled',
      transitionId: 'transition-1',
      error: { code: 'cancelled', message: 'The generation was stopped.', issues: [] },
      diagnostics,
    });
    await pending;
    expect(entry()).toMatchObject({
      status: 'cancelled',
      message: 'Regeneration was stopped. The transition was not changed.',
    });
    expect(current()).toBe(before);
  });

  it('discards the result when an endpoint Koma is edited while it runs', async () => {
    const execution = defer<Outcome>();
    mockChannels(() => execution.promise);
    const pending = regenerateTransition('transition-1');

    useProjectStore.getState().apply(changeElement('koma-1', moved('mover-1', 50)));
    const edited = current();
    execution.resolve(succeeded);
    await pending;

    expect(current()).toBe(edited);
    expect(assessmentOf(current(), 'transition-1')?.blocked).toBe(true);
    expect(entry()).toMatchObject({
      status: 'discarded',
      message: expect.stringContaining(
        '"Start" changed while the transition was being regenerated',
      ) as unknown,
    });
  });

  it('applies the result when an edit during the run was undone again', async () => {
    const execution = defer<Outcome>();
    mockChannels(() => execution.promise);
    const pending = regenerateTransition('transition-1');
    useProjectStore.getState().apply(changeElement('koma-2', moved('mover-2', 10)));
    useProjectStore.getState().undo();
    execution.resolve(succeeded);
    await pending;
    expect(assessmentOf(current(), 'transition-1')).toBeNull();
    expect(entry()).toBeUndefined();
  });

  it('keeps settings the user changed while it ran', async () => {
    const execution = defer<Outcome>();
    mockChannels(() => execution.promise);
    const pending = regenerateTransition('transition-1');
    useProjectStore.getState().apply(changeTransition('transition-1', { duration: 3000 }));
    const edited = current();
    execution.resolve(succeeded);
    await pending;
    expect(current()).toBe(edited);
    expect(entry()).toMatchObject({ status: 'discarded' });
  });

  it('ignores a result that arrives after another project was opened', async () => {
    const execution = defer<Outcome>();
    mockChannels(() => execution.promise);
    const pending = regenerateTransition('transition-1');
    const other = buildProject({ name: 'Other' });
    useProjectStore.getState().load(other, null);
    execution.resolve(succeeded);
    await pending;
    expect(current()).toBe(other);
    expect(entry()).toBeUndefined();
  });
});
