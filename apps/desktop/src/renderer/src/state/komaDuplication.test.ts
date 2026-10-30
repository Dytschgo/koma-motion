import { flattenElements, komaProjectSchema } from '@koma-motion/core';
import { describe, expect, it } from 'vitest';
import { buildNavigationProject } from '../lib/deckNavigation.fixture';
import { duplicateKomaInProject } from './commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from './projectStore';

describe('thumbnail duplication', () => {
  it('copies content and timing with distinct document IDs in one undoable change', () => {
    const original = buildNavigationProject();
    useProjectStore.getState().load(original, null);
    useProjectStore.getState().apply(duplicateKomaInProject('koma-2'));
    const next = selectProject(useProjectStore.getState());
    if (next === null) throw new Error('Expected the open project');
    const source = original.presentation.komas[1];
    const copy = next.presentation.komas[2];
    if (source === undefined || copy === undefined) throw new Error('Expected both Komas');
    expect(next.presentation.komas).toHaveLength(101);
    expect(copy).toMatchObject({
      title: source.title,
      purpose: source.purpose,
      speakerNotes: source.speakerNotes,
      holdDurationMs: source.holdDurationMs,
    });
    expect(copy.id).not.toBe(source.id);
    expect(flattenElements(copy.elements).map((element) => element.persistentId)).toEqual(
      flattenElements(source.elements).map((element) => element.persistentId),
    );
    const originalIds = new Set(
      original.presentation.komas.flatMap((koma) =>
        flattenElements(koma.elements).map((element) => element.id),
      ),
    );
    expect(flattenElements(copy.elements).every((element) => !originalIds.has(element.id))).toBe(
      true,
    );
    expect(next.presentation.transitions).toHaveLength(100);
    // An unrelated, customised transition survives the adjacent insertion.
    expect(next.presentation.transitions.at(-1)).toEqual(original.presentation.transitions.at(-1));
    expect(komaProjectSchema.safeParse(next).success).toBe(true);
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(true);
    useProjectStore.getState().undo();
    expect(selectProject(useProjectStore.getState())).toBe(original);
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
    useProjectStore.getState().redo();
    expect(selectProject(useProjectStore.getState())).toBe(next);
  });

  it('ignores a missing thumbnail without adding an undo step', () => {
    const original = buildNavigationProject();
    useProjectStore.getState().load(original, null);
    useProjectStore.getState().apply(duplicateKomaInProject('missing'));
    expect(selectProject(useProjectStore.getState())).toBe(original);
    expect(useProjectStore.getState().history?.past).toEqual([]);
  });
});
