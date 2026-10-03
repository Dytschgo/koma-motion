import { buildProject } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { buildDeck, makeStale } from '../lib/presentationDeck.fixture';
import { changeKomaDetails } from './commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from './projectStore';

describe('Koma hold duration commands', () => {
  it('makes timing undoable without rebuilding even stale stored motion', () => {
    const project = buildProject({ presentation: makeStale(buildDeck(2), 1) });
    const store = useProjectStore.getState();
    store.load(project, null);
    store.apply(changeKomaDetails('koma-1', { holdDurationMs: 1750 }));
    const next = selectProject(useProjectStore.getState())!;
    expect(next.presentation.komas.map((koma) => koma.holdDurationMs)).toEqual([1750, null]);
    expect(next.presentation.transitions).toBe(project.presentation.transitions);
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(true);
    store.undo();
    expect(selectProject(useProjectStore.getState())).toBe(project);
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
    store.redo();
    expect(selectProject(useProjectStore.getState())).toBe(next);
    store.apply(changeKomaDetails('koma-1', { holdDurationMs: null }));
    expect(
      selectProject(useProjectStore.getState())!.presentation.komas[0]!.holdDurationMs,
    ).toBeNull();
  });

  it('rejects an invalid duration before it enters document history', () => {
    const project = buildProject({ presentation: buildDeck(1) });
    useProjectStore.getState().load(project, null);
    expect(() =>
      useProjectStore.getState().apply(changeKomaDetails('koma-1', { holdDurationMs: 60001 })),
    ).toThrow();
    expect(selectProject(useProjectStore.getState())).toBe(project);
  });
});
