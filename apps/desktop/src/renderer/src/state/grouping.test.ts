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
import { getGroupingAvailability, groupSelection, ungroupSelection } from '../lib/groupActions';
import { groupKomaElements, ungroupKomaElement } from './commands';
import { selectProject, useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';

const ids = (): ReturnType<typeof createSeededIdGenerator> => createSeededIdGenerator('grouping');
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

function current(): KomaProject {
  const project = selectProject(useProjectStore.getState());
  if (project === null) throw new Error('Expected a project');
  return project;
}

beforeEach(() => {
  useUiStore.getState().reset();
  useProjectStore.getState().load(base, null);
  useUiStore.getState().selectKoma('koma-1');
});

describe('multi-selection', () => {
  it('adds and removes elements and keeps the last one in the Inspector', () => {
    const ui = useUiStore.getState();
    ui.selectElement('back-1');
    ui.toggleElementSelection('front-1');
    expect(useUiStore.getState()).toMatchObject({
      selectedElementId: 'front-1',
      selectedElementIds: ['back-1', 'front-1'],
      inspectorTab: 'element',
    });
    ui.toggleElementSelection('front-1');
    expect(useUiStore.getState()).toMatchObject({
      selectedElementId: 'back-1',
      selectedElementIds: ['back-1'],
    });
    ui.toggleElementSelection('back-1');
    expect(useUiStore.getState()).toMatchObject({
      selectedElementId: null,
      selectedElementIds: [],
      inspectorTab: 'koma',
    });
  });

  it('is cleared by a plain selection, another Koma and a preview', () => {
    const ui = useUiStore.getState();
    ui.selectElements(['back-1', 'front-1']);
    ui.selectElement('back-1');
    expect(useUiStore.getState().selectedElementIds).toEqual(['back-1']);
    ui.selectElements(['back-1', 'front-1']);
    ui.selectKoma('koma-2');
    expect(useUiStore.getState().selectedElementIds).toEqual([]);
    ui.selectElements(['back-2', 'front-2']);
    const transition = base.presentation.transitions[0];
    if (transition === undefined) throw new Error('Expected a transition');
    ui.startPreview(transition.id);
    expect(useUiStore.getState().selectedElementIds).toEqual([]);
  });
});

describe('group commands', () => {
  it('groups as one undo step, recomputes the neighbouring motion and redoes the same identities', () => {
    useProjectStore.getState().apply(groupKomaElements('koma-1', ['back-1', 'front-1']));
    const grouped = current();
    const [group] = grouped.presentation.komas[0]?.elements ?? [];
    if (group?.type !== 'group') throw new Error('Expected a group');
    expect(group.content.children.map((child) => child.id)).toEqual(['back-1', 'front-1']);
    expect(useProjectStore.getState().history?.past).toHaveLength(1);
    // The transition keeps its settings and plays: the separate objects fade
    // into the group, which has no counterpart on the next Koma.
    const [before] = base.presentation.transitions;
    const [transition] = grouped.presentation.transitions;
    if (before === undefined || transition === undefined) throw new Error('Expected a transition');
    expect(transition).toMatchObject({
      id: before.id,
      duration: before.duration,
      easing: before.easing,
      strategy: before.strategy,
      rationale: before.rationale,
    });
    expect(validateTransition(transition, grouped.presentation)).toEqual([]);
    expect(
      transition.elementTransitions.map((item) => `${item.persistentId}:${item.operation}`).sort(),
    ).toEqual(['back:fadeIn', 'front:fadeIn', `${group.persistentId}:fadeOut`].sort());

    useProjectStore.getState().undo();
    expect(current()).toBe(base);
    useProjectStore.getState().redo();
    expect(current()).toBe(grouped);
  });

  it('moves the same objects grouped on both Komas as one group', () => {
    useProjectStore.getState().apply(groupKomaElements('koma-1', ['back-1', 'front-1']));
    useProjectStore.getState().apply(groupKomaElements('koma-2', ['back-2', 'front-2']));
    const [from, to] = current().presentation.komas.map((koma) => koma.elements[0]);
    expect(from?.persistentId).toBe(to?.persistentId);
    expect(
      current().presentation.transitions[0]?.elementTransitions.map((item) => item.operation),
    ).toEqual(['hold']);
  });

  it('ungroups as one undo step back to the original elements', () => {
    useProjectStore.getState().apply(groupKomaElements('koma-1', ['back-1', 'front-1']));
    const grouped = current();
    const group = grouped.presentation.komas[0]?.elements[0];
    if (group === undefined) throw new Error('Expected a group');
    useProjectStore.getState().apply(ungroupKomaElement('koma-1', group.id));
    expect(current().presentation.komas[0]?.elements).toEqual(first.elements);
    expect(current().presentation.transitions).toEqual(base.presentation.transitions);
    expect(useProjectStore.getState().history?.past).toHaveLength(2);
    useProjectStore.getState().undo();
    expect(current()).toBe(grouped);
  });

  it('leaves the document unchanged when a selection cannot be grouped', () => {
    expect(() => {
      useProjectStore.getState().apply(groupKomaElements('koma-1', ['back-1']));
    }).toThrow('Select two or more elements');
    expect(() => {
      useProjectStore.getState().apply(ungroupKomaElement('koma-1', 'back-1'));
    }).toThrow('Select a group');
    expect(current()).toBe(base);
    expect(useProjectStore.getState().history?.past).toHaveLength(0);
  });
});

describe('group actions', () => {
  it('groups the selection, selects the group, and ungroups back to the children', () => {
    const ui = useUiStore.getState();
    ui.selectElements(['front-1', 'back-1']);
    const koma = current().presentation.komas[0] ?? null;
    expect(getGroupingAvailability(koma, ['front-1', 'back-1'])).toEqual({
      canGroup: true,
      group: null,
    });
    expect(groupSelection()).toBe(true);
    const group = current().presentation.komas[0]?.elements.find((item) => item.type === 'group');
    if (group === undefined) throw new Error('Expected a group');
    expect(useUiStore.getState()).toMatchObject({
      selectedElementId: group.id,
      selectedElementIds: [group.id],
      inspectorTab: 'element',
    });
    expect(
      getGroupingAvailability(current().presentation.komas[0] ?? null, [group.id]).group?.id,
    ).toBe(group.id);

    expect(ungroupSelection()).toBe(true);
    expect(useUiStore.getState().selectedElementIds).toEqual(['back-1', 'front-1']);
    expect(current().presentation.komas[0]?.elements).toEqual(first.elements);
  });

  it('ignores a single element and reports a selection that cannot be grouped', () => {
    const ui = useUiStore.getState();
    ui.selectElement('back-1');
    expect(groupSelection()).toBe(false);
    expect(ungroupSelection()).toBe(false);
    expect(useUiStore.getState().notices).toEqual([]);
    useProjectStore.getState().apply(() => ({
      ...base,
      presentation: {
        ...base.presentation,
        komas: [{ ...first, elements: [{ ...back, locked: true }, front] }, second],
      },
    }));
    ui.selectElements(['back-1', 'front-1']);
    expect(groupSelection()).toBe(false);
    expect(useUiStore.getState().notices.at(-1)?.message).toContain('Unlock');
  });
});
