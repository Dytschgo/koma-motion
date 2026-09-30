import { createSeededIdGenerator, type KomaProject } from '@koma-motion/core';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  buildText,
} from '@koma-motion/core/testing';
import { syncTransitions, validateTransition } from '@koma-motion/motion-engine';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  canRecalculateTransition,
  changeElement,
  deleteElement,
  recalculateTransition,
  restackElement,
} from './commands';
import { selectProject, useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';

const ids = (): ReturnType<typeof createSeededIdGenerator> => createSeededIdGenerator('inspector');
const back = buildShape({ id: 'back-1', persistentId: 'back', zIndex: 1 });
const front = buildText({ id: 'front-1', persistentId: 'front', zIndex: 2 });
const first = buildKoma({ id: 'koma-1', elements: [back, front] });
const second = buildKoma({
  id: 'koma-2',
  elements: [
    { ...back, id: 'back-2' },
    { ...front, id: 'front-2' },
  ],
});
const base: KomaProject = buildProject({
  presentation: syncTransitions(
    buildPresentation({ komas: [first, second], transitions: [] }),
    ids(),
  ).presentation,
});

beforeEach(() => {
  useUiStore.getState().reset();
  useProjectStore.getState().load(base, null);
});

describe('layer commands', () => {
  it('reorders layers as one undoable step without regenerating motion', () => {
    const store = useProjectStore.getState();
    store.apply(restackElement('koma-1', 'back-1', 'forward'));
    const moved = selectProject(useProjectStore.getState());
    const elements = moved?.presentation.komas[0]?.elements ?? [];
    expect(elements.map((element) => element.zIndex)).toEqual([2, 1]);
    expect(moved?.presentation.transitions).toBe(base.presentation.transitions);
    useProjectStore.getState().undo();
    expect(selectProject(useProjectStore.getState())).toBe(base);
  });

  it('does not record a step when the element cannot move further', () => {
    const command = restackElement('koma-1', 'front-1', 'forward');
    expect(command(base, ids())).toBe(base);
    expect(command.affectedKomaIds).toEqual(['koma-1']);
  });
});

describe('recalculating motion', () => {
  it('repairs out-of-date motion and keeps the settings of the transition', () => {
    const transition = base.presentation.transitions[0];
    if (transition === undefined) throw new Error('Expected a transition');
    const custom = {
      ...base,
      presentation: {
        ...base.presentation,
        transitions: [
          { ...transition, duration: 2500, easing: 'linear' as const, rationale: 'Mine' },
        ],
      },
    };
    const edited = changeElement('koma-2', {
      ...back,
      id: 'back-2',
      position: { x: 900, y: 500 },
    })(custom, ids());
    const stored = edited.presentation.transitions[0];
    if (stored === undefined) throw new Error('Expected a transition');
    expect(validateTransition(stored, edited.presentation).map((issue) => issue.code)).toEqual([
      'staleTransition',
    ]);
    expect(canRecalculateTransition(edited.presentation, stored.id)).toBe(true);

    const repaired = recalculateTransition(stored.id)(edited, ids());
    const result = repaired.presentation.transitions[0];
    if (result === undefined) throw new Error('Expected a transition');
    expect(validateTransition(result, repaired.presentation)).toEqual([]);
    expect(result).toMatchObject({
      id: stored.id,
      duration: 2500,
      easing: 'linear',
      rationale: 'Mine',
    });
    expect(canRecalculateTransition(repaired.presentation, stored.id)).toBe(false);
    expect(recalculateTransition(stored.id)(repaired, ids())).toBe(repaired);
  });

  it('leaves a missing transition alone', () => {
    expect(recalculateTransition('missing')(base, ids())).toBe(base);
    expect(canRecalculateTransition(base.presentation, 'missing')).toBe(false);
  });
});

describe('Inspector context', () => {
  it('follows the selection and returns to the Koma when it is cleared', () => {
    const ui = useUiStore.getState();
    expect(useUiStore.getState().inspectorTab).toBe('koma');
    ui.selectKoma('koma-1');
    ui.selectElement('back-1');
    expect(useUiStore.getState()).toMatchObject({
      inspectorTab: 'element',
      selectedElementId: 'back-1',
    });
    // An ordinary field edit keeps the selection and the context.
    useProjectStore.getState().apply(changeElement('koma-1', { ...back, name: 'Renamed' }));
    expect(useUiStore.getState()).toMatchObject({
      inspectorTab: 'element',
      selectedElementId: 'back-1',
    });
    ui.selectElement(null);
    expect(useUiStore.getState().inspectorTab).toBe('koma');
  });

  it('clears the element when the Koma changes and keeps the motion context', () => {
    const ui = useUiStore.getState();
    ui.selectElement('back-1');
    ui.selectKoma('koma-2');
    expect(useUiStore.getState()).toMatchObject({
      inspectorTab: 'koma',
      selectedElementId: null,
    });
    ui.setInspectorTab('motion');
    ui.selectKoma('koma-1');
    expect(useUiStore.getState().inspectorTab).toBe('motion');
  });

  it('shows the motion while a preview plays and resets with the project', () => {
    const ui = useUiStore.getState();
    ui.selectElement('front-1');
    const transition = base.presentation.transitions[0];
    if (transition === undefined) throw new Error('Expected a transition');
    ui.startPreview(transition.id);
    expect(useUiStore.getState()).toMatchObject({
      inspectorTab: 'motion',
      selectedElementId: null,
    });
    ui.selectElement('front-1');
    ui.reset();
    expect(useUiStore.getState()).toMatchObject({ inspectorTab: 'koma', selectedElementId: null });
  });

  it('removes a deleted element from the document so the Inspector can clear it', () => {
    useUiStore.getState().selectElement('back-1');
    useProjectStore.getState().apply(deleteElement('koma-1', 'back-1'));
    const koma = selectProject(useProjectStore.getState())?.presentation.komas[0];
    expect(koma?.elements.some((element) => element.id === 'back-1')).toBe(false);
  });
});
