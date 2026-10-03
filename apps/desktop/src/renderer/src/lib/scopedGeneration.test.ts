import type { AssetReference, GenerationHistoryEntry, ImageElement } from '@koma-motion/core';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
  FIXTURE_TIMESTAMP,
} from '@koma-motion/core/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GenerationOutcome } from '../../../shared/ipc';
import { setUnavailableImageAssets } from '@koma-motion/renderer';
import { useAgentStore } from '../state/agentStore';
import { changeKomaDetails, deleteKoma } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { acceptScopedProposal, discardScopedProposal, generate } from './agentActions';
import { invoke } from './api';

vi.mock('./api', () => ({ invoke: vi.fn() }));
const entry: GenerationHistoryEntry = {
  id: 'proposal-history',
  createdAt: FIXTURE_TIMESTAMP,
  providerId: 'mock',
  status: 'succeeded',
  userRequest: 'Revise selected',
  summary: 'Proposal ready',
  warnings: [],
};
const asset: AssetReference = {
  id: 'shared-asset',
  type: 'image',
  name: 'Shared.png',
  mediaType: 'image/png',
  projectPath: 'assets/shared.png',
  metadata: {},
  embeddedData: { encoding: 'base64', data: 'aGVsbG8=' },
};
const target = buildKoma({
  id: 'middle',
  title: 'Middle',
  holdDurationMs: 2500,
  elements: [buildText({ id: 'middle-text', persistentId: 'heading' })],
});
const initial = buildProject({
  assets: [asset],
  presentation: buildPresentation({
    title: 'Manual deck',
    komas: [
      buildKoma({ id: 'first', elements: [] }),
      target,
      buildKoma({ id: 'last', title: 'Manual last', elements: [] }),
    ],
  }),
});
const input = {
  userRequest: 'Revise selected',
  objective: null,
  audience: null,
  requestedKomaCount: 1,
  targetKomaId: target.id,
};
const diagnostics = {
  providerId: 'mock',
  startedAt: FIXTURE_TIMESTAMP,
  finishedAt: FIXTURE_TIMESTAMP,
  durationMs: 1,
  promptTemplate: '',
  attempts: [],
};
function outcome(assets: readonly AssetReference[] = []): GenerationOutcome {
  return {
    status: 'succeeded',
    presentation: buildPresentation({
      title: 'Ignored generated title',
      komas: [
        buildKoma({
          id: 'proposal',
          title: 'Proposed',
          elements: [buildShape({ id: 'newshape', persistentId: 'newshape' })],
        }),
      ],
      transitions: [],
    }),
    assets: [...assets],
    historyEntry: entry,
    warnings: [],
    repaired: false,
    diagnostics,
  };
}
function defer() {
  let resolve: (value: GenerationOutcome) => void = () => undefined;
  const promise = new Promise<GenerationOutcome>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
afterEach(() => setUnavailableImageAssets([], []));
beforeEach(() => {
  setUnavailableImageAssets([], []);
  useAgentStore.setState({
    scopedProposal: null,
    execution: null,
    conversation: [],
    lastRun: null,
  });
  useProjectStore.getState().load(initial, null);
  vi.mocked(invoke).mockResolvedValue(outcome());
});

describe('selected proposal ownership', () => {
  function imageOutcome(): GenerationOutcome {
    const answer = outcome();
    if (answer.status !== 'succeeded') throw new Error('Expected successful fixture');
    const image: ImageElement = {
      ...buildShape(),
      type: 'image',
      content: { assetId: asset.id, altText: 'Shared' },
      style: { fit: 'contain', cornerRadius: 0 },
    };
    return {
      ...answer,
      presentation: buildPresentation({
        komas: [buildKoma({ elements: [image] })],
        transitions: [],
      }),
    };
  }

  it('invalidates only referenced asset changes or removals and never deletes shared bytes', async () => {
    vi.mocked(invoke).mockResolvedValue(imageOutcome());
    await generate(input);
    useProjectStore
      .getState()
      .apply((project) => ({ ...project, assets: [{ ...asset, embeddedData: null }] }));
    expect(useAgentStore.getState().scopedProposal?.invalidReason).toMatch(
      /changed or was removed/,
    );
    useProjectStore.getState().undo();
    acceptScopedProposal();
    expect(selectProject(useProjectStore.getState())).toBe(initial);
    discardScopedProposal();
    await generate(input);
    useProjectStore.getState().apply((project) => ({ ...project, assets: [] }));
    expect(useAgentStore.getState().scopedProposal?.invalidReason).toMatch(/removed/);
  });

  it('rechecks file-boundary unavailable image verdicts both before preview and at Apply', async () => {
    vi.mocked(invoke).mockResolvedValue(imageOutcome());
    setUnavailableImageAssets([asset], [asset.id]);
    await generate(input);
    expect(useAgentStore.getState().scopedProposal?.invalidReason).toMatch(/no longer available/);
    discardScopedProposal();
    setUnavailableImageAssets([], []);
    await generate(input);
    expect(useAgentStore.getState().scopedProposal?.invalidReason).toBeNull();
    setUnavailableImageAssets([asset], [asset.id]);
    acceptScopedProposal();
    expect(selectProject(useProjectStore.getState())).toBe(initial);
    expect(useAgentStore.getState().scopedProposal?.invalidReason).toMatch(/no longer available/);
  });

  it('rejects excess generated assets atomically at Apply', async () => {
    const assets = Array.from({ length: 500 }, (_, index) => ({
      ...asset,
      id: `generated-${String(index)}`,
      projectPath: `assets/${String(index)}.png`,
    }));
    vi.mocked(invoke).mockResolvedValue(outcome(assets));
    await generate(input);
    acceptScopedProposal();
    expect(selectProject(useProjectStore.getState())).toBe(initial);
    expect(useAgentStore.getState().scopedProposal?.invalidReason).not.toBeNull();
  });
  it('always previews, and Discard leaves content/assets/history and undo unchanged', async () => {
    const history = useProjectStore.getState().history;
    await generate(input);
    expect(useAgentStore.getState().scopedProposal?.proposed.title).toBe('Proposed');
    expect(selectProject(useProjectStore.getState())).toBe(initial);
    expect(useProjectStore.getState().history).toBe(history);
    discardScopedProposal();
    expect(selectProject(useProjectStore.getState())).toBe(initial);
    expect(useProjectStore.getState().history).toBe(history);
  });

  it('applies only the target plus assets/history in one undo and keeps other edits', async () => {
    const generated = { ...asset, id: 'generated-image', projectPath: 'assets/generated.png' };
    vi.mocked(invoke).mockResolvedValue(outcome([generated]));
    await generate(input);
    useProjectStore
      .getState()
      .apply(changeKomaDetails('last', { title: 'Edited while reviewing' }));
    const beforeApply = selectProject(useProjectStore.getState());
    acceptScopedProposal();
    const next = selectProject(useProjectStore.getState());
    expect(next?.presentation.komas[0]).toBe(initial.presentation.komas[0]);
    expect(next?.presentation.komas[2]?.title).toBe('Edited while reviewing');
    expect(next?.presentation.komas[1]).toMatchObject({
      id: 'middle',
      title: 'Proposed',
      holdDurationMs: 2500,
    });
    expect(next?.presentation.title).toBe('Manual deck');
    expect(next?.assets).toEqual([asset, generated]);
    expect(next?.generationHistory).toEqual([entry]);
    expect(next?.presentation.transitions).toBe(initial.presentation.transitions);
    useProjectStore.getState().undo();
    expect(selectProject(useProjectStore.getState())).toBe(beforeApply);
  });

  it('keeps unrelated asset edits rather than invalidating the proposal', async () => {
    await generate(input);
    const changed = { ...asset, name: 'Renamed elsewhere.png' };
    useProjectStore.getState().apply((project) => ({ ...project, assets: [changed] }));
    expect(useAgentStore.getState().scopedProposal?.invalidReason).toBeNull();
    acceptScopedProposal();
    expect(selectProject(useProjectStore.getState())?.assets).toEqual([changed]);
  });

  it('invalidates target edits permanently even after Undo, during generation and review', async () => {
    const pending = defer();
    vi.mocked(invoke).mockReturnValue(pending.promise);
    const running = generate(input);
    useProjectStore.getState().apply(changeKomaDetails('middle', { title: 'Edited' }));
    useProjectStore.getState().undo();
    pending.resolve(outcome());
    await running;
    expect(useAgentStore.getState().scopedProposal?.invalidReason).toMatch(/changed/);
    acceptScopedProposal();
    expect(selectProject(useProjectStore.getState())).toBe(initial);
    discardScopedProposal();
    vi.mocked(invoke).mockResolvedValue(outcome());
    await generate(input);
    useProjectStore.getState().apply(deleteKoma('middle'));
    expect(useAgentStore.getState().scopedProposal?.invalidReason).toMatch(/removed/);
  });

  it('rejects same-file reopen or project switches while a run is pending', async () => {
    const pending = defer();
    vi.mocked(invoke).mockReturnValue(pending.promise);
    const running = generate(input);
    useProjectStore.getState().load(initial, null);
    pending.resolve(outcome());
    await running;
    expect(useAgentStore.getState().scopedProposal).toBeNull();
    expect(selectProject(useProjectStore.getState())).toBe(initial);
  });

  it('does not persist cancellation history or create a proposal after a late success', async () => {
    const pending = defer();
    vi.mocked(invoke).mockReturnValue(pending.promise);
    const running = generate(input);
    useAgentStore.getState().requestCancel();
    pending.resolve(outcome());
    await running;
    expect(useAgentStore.getState().scopedProposal).toBeNull();
    expect(selectProject(useProjectStore.getState())).toBe(initial);
    expect(useAgentStore.getState().lastRun?.result).toBe('cancelled');
  });

  it('fails closed on multiple Komas instead of trimming the output', async () => {
    const answer = outcome();
    if (answer.status !== 'succeeded') throw new Error('Fixture must succeed.');
    vi.mocked(invoke).mockResolvedValue({ ...answer, presentation: initial.presentation });
    await generate(input);
    expect(useAgentStore.getState().scopedProposal).toBeNull();
    expect(selectProject(useProjectStore.getState())).toBe(initial);
  });

  it('shows asset collisions as invalid without replacing shared assets', async () => {
    vi.mocked(invoke).mockResolvedValue(outcome([asset]));
    await generate(input);
    expect(useAgentStore.getState().scopedProposal?.invalidReason).toMatch(/conflicts/);
    acceptScopedProposal();
    expect(selectProject(useProjectStore.getState())).toBe(initial);
  });
});
