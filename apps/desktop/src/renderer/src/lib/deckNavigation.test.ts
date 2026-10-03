import { komaProjectSchema } from '@koma-motion/core';
import { validateTransition } from '@koma-motion/motion-engine';
import { parseProject, serialiseProject } from '@koma-motion/project-format';
import { describe, expect, it } from 'vitest';
import { reorderKoma } from '../state/commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { getKomaMoveOffset, searchKomas } from './deckNavigation';
import { buildNavigationProject } from './deckNavigation.fixture';

describe('long deck navigation', () => {
  it('searches number, title and purpose without changing full-deck positions or adjacency', () => {
    const project = buildNavigationProject();
    const original = JSON.stringify(project);
    const komas = project.presentation.komas;
    expect(searchKomas(komas, '  REVENUE quarterly ')).toEqual([{ koma: komas[49], number: 50 }]);
    expect(searchKomas(komas, 'Chapter 100')).toEqual([{ koma: komas[99], number: 100 }]);
    expect(searchKomas(komas, '100')).toEqual([{ koma: komas[99], number: 100 }]);
    expect(searchKomas(komas, 'Chapter 9').map((result) => result.number)).toEqual([
      9, 19, 29, 39, 49, 59, 69, 79, 89, 90, 91, 92, 93, 94, 95, 96, 97, 98, 99,
    ]);
    expect(searchKomas(komas, 'no matching metadata')).toEqual([]);
    expect(searchKomas(komas, '').map((result) => result.koma)).toEqual(komas);
    expect(JSON.stringify(project)).toBe(original);
  });

  it('rejects invalid direct positions instead of clamping them into document changes', () => {
    const project = buildNavigationProject();
    const komas = project.presentation.komas;
    for (const invalid of [
      '',
      ' ',
      '0',
      '-1',
      '101',
      '1.5',
      '1e2',
      'Infinity',
      'abc',
      '9007199254740992',
    ])
      expect(getKomaMoveOffset(komas, 'koma-1', invalid)).toBeNull();
    expect(getKomaMoveOffset(komas, 'missing', '1')).toBeNull();
    expect(getKomaMoveOffset([], 'koma-1', '1')).toBeNull();
    expect(getKomaMoveOffset(komas, 'koma-1', ' 100 ')).toBe(99);
    expect(getKomaMoveOffset(komas, 'koma-100', '1')).toBe(-99);
    expect(getKomaMoveOffset(komas, 'koma-50', '75')).toBe(25);
    expect(getKomaMoveOffset(komas, 'koma-50', '50')).toBe(0);
  });

  for (const [id, position] of [
    ['koma-1', '100'],
    ['koma-100', '1'],
    ['koma-50', '75'],
  ] as const) {
    it(`moves ${id} to ${position} in one undo step with holds, identity and unchanged motion intact`, () => {
      const project = buildNavigationProject();
      const store = useProjectStore;
      const ui = useUiStore;
      store.getState().load(project, null);
      ui.getState().selectKoma(id);
      const offset = getKomaMoveOffset(project.presentation.komas, id, position)!;
      store.getState().apply(reorderKoma(id, offset));
      const moved = selectProject(store.getState())!;
      expect(moved.presentation.komas[Number(position) - 1]?.id).toBe(id);
      expect(ui.getState().selectedKomaId).toBe(id);
      expect(store.getState().history?.past).toHaveLength(1);
      expect(selectHasUnsavedChanges(store.getState())).toBe(true);
      komaProjectSchema.parse(moved);
      expect(new Set(moved.presentation.komas.map((koma) => koma.id)).size).toBe(100);
      for (const koma of moved.presentation.komas)
        expect(koma).toBe(project.presentation.komas.find((original) => original.id === koma.id));
      expect(moved.presentation.transitions).toHaveLength(99);
      let newEdges = 0;
      for (const [index, transition] of moved.presentation.transitions.entries()) {
        expect(transition.fromKomaId).toBe(moved.presentation.komas[index]?.id);
        expect(transition.toKomaId).toBe(moved.presentation.komas[index + 1]?.id);
        const original = project.presentation.transitions.find(
          (old) => old.fromKomaId === transition.fromKomaId && old.toKomaId === transition.toKomaId,
        );
        if (original) expect(transition).toBe(original);
        else {
          newEdges++;
          expect(project.presentation.transitions.some((old) => old.id === transition.id)).toBe(
            false,
          );
          expect(validateTransition(transition, moved.presentation)).toEqual([]);
        }
      }
      expect(newEdges).toBe(id === 'koma-50' ? 3 : 1);
      store.getState().undo();
      expect(selectProject(store.getState())).toBe(project);
      expect(selectHasUnsavedChanges(store.getState())).toBe(false);
      expect(ui.getState().selectedKomaId).toBe(id);
      store.getState().redo();
      expect(selectProject(store.getState())).toBe(moved);
      const encoded = serialiseProject(moved);
      if (!encoded.ok) throw new Error(encoded.error.message);
      const reopened = parseProject(encoded.value);
      if (!reopened.ok) throw new Error(reopened.error.message);
      expect(reopened.value.project.presentation).toEqual(moved.presentation);
      expect(reopened.value.project.generationHistory).toEqual(project.generationHistory);
      ui.getState().reset();
    });
  }
});
