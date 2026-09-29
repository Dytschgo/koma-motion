import { createSeededIdGenerator, komaProjectSchema, type KomaProject } from '@koma-motion/core';
import { buildKoma, buildProject, buildShape, buildText } from '@koma-motion/core/testing';
import { validateTransition } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import {
  addKoma,
  applyGeneration,
  changeElement,
  changeTransition,
  deleteKoma,
  reorderKoma,
  type ProjectCommand,
} from './commands';
import {
  canRedo,
  canUndo,
  COALESCE_WINDOW_MS,
  commit,
  createHistory,
  HISTORY_LIMIT,
  redo,
  undo,
} from './history';

describe('history', () => {
  it('undoes and redoes changes', () => {
    let history = createHistory('a');
    history = commit(history, 'b', { time: 0 });
    history = commit(history, 'c', { time: 1 });
    expect(history.present).toBe('c');
    expect(canUndo(history)).toBe(true);

    history = undo(history);
    expect(history.present).toBe('b');
    expect(canRedo(history)).toBe(true);

    history = redo(history);
    expect(history.present).toBe('c');
    expect(canRedo(history)).toBe(false);
  });

  it('forgets the redo steps after a new change', () => {
    let history = commit(createHistory('a'), 'b', { time: 0 });
    history = undo(history);
    history = commit(history, 'c', { time: 1 });
    expect(history.future).toEqual([]);
    expect(undo(history).present).toBe('a');
  });

  it('does nothing at the ends', () => {
    const history = createHistory('a');
    expect(undo(history)).toBe(history);
    expect(redo(history)).toBe(history);
  });

  it('ignores a change that changes nothing', () => {
    const history = createHistory('a');
    expect(commit(history, 'a', { time: 0 })).toBe(history);
  });

  it('merges a series of edits of the same field into one step', () => {
    let history = createHistory('');
    history = commit(history, 'K', { coalesceKey: 'title', time: 0 });
    history = commit(history, 'Ko', { coalesceKey: 'title', time: 200 });
    history = commit(history, 'Kom', { coalesceKey: 'title', time: 400 });
    expect(history.past).toEqual(['']);
    expect(undo(history).present).toBe('');
  });

  it('starts a new step for another field or after a pause', () => {
    let history = createHistory('');
    history = commit(history, 'a', { coalesceKey: 'title', time: 0 });
    history = commit(history, 'b', { coalesceKey: 'notes', time: 100 });
    history = commit(history, 'c', { coalesceKey: 'notes', time: 100 + COALESCE_WINDOW_MS + 1 });
    expect(history.past).toEqual(['', 'a', 'b']);
  });

  it('keeps a limited number of steps', () => {
    let history = createHistory(0);
    for (let value = 1; value <= HISTORY_LIMIT + 20; value += 1) {
      history = commit(history, value, { time: value });
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
    expect(history.past[0]).toBe(20);
  });
});

describe('document commands', () => {
  const engine = buildShape({ id: 'engine-1', persistentId: 'engine' });
  const title = buildText({ id: 'title-1', persistentId: 'title' });
  const base = buildProject({
    presentation: {
      ...buildProject().presentation,
      komas: [buildKoma({ id: 'koma-1', title: 'First', elements: [engine, title] })],
      transitions: [],
    },
  });

  function run(project: KomaProject, ...commands: ProjectCommand[]): KomaProject {
    const idGenerator = createSeededIdGenerator('commands');
    const result = commands.reduce((current, command) => command(current, idGenerator), project);
    expect(komaProjectSchema.safeParse(result).success).toBe(true);
    for (const transition of result.presentation.transitions) {
      expect(validateTransition(transition, result.presentation)).toEqual([]);
    }
    return result;
  }

  it('adds a Koma as the next state of the same objects', () => {
    const project = run(base, addKoma('koma-1'));
    const [first, second] = project.presentation.komas;
    expect(second?.elements.map((element) => element.persistentId)).toEqual(['engine', 'title']);
    expect(second?.id).not.toBe(first?.id);
    expect(project.presentation.transitions).toHaveLength(1);
    expect(
      project.presentation.transitions[0]?.elementTransitions.map((item) => item.operation),
    ).toEqual(['hold', 'hold']);
  });

  it('adds an empty Koma in the background colour of the Brand Kit', () => {
    const empty = { ...base, presentation: { ...base.presentation, komas: [] } };
    const project = run(empty, addKoma(null));
    expect(project.presentation.komas).toHaveLength(1);
    expect(project.presentation.komas[0]?.background.colour).toBe(base.brandKit.colours.background);
  });

  it('recomputes the motion when an element changes', () => {
    const withSecond = run(base, addKoma('koma-1'));
    const second = withSecond.presentation.komas[1];
    const copy = second?.elements.find((element) => element.persistentId === 'engine');
    if (second === undefined || copy === undefined) {
      throw new Error('Expected a second Koma');
    }

    const project = run(
      withSecond,
      changeElement(second.id, { ...copy, position: { x: 900, y: 500 } }),
    );

    const operations = project.presentation.transitions[0]?.elementTransitions
      .filter((item) => item.persistentId === 'engine')
      .map((item) => item.operation);
    expect(operations).toEqual(['move']);
  });

  it('keeps the settings of a transition when its Komas change', () => {
    const withSecond = run(base, addKoma('koma-1'));
    const transitionId = withSecond.presentation.transitions[0]?.id ?? '';
    const second = withSecond.presentation.komas[1];
    const copy = second?.elements[0];
    if (second === undefined || copy === undefined) {
      throw new Error('Expected a second Koma');
    }

    const project = run(
      withSecond,
      changeTransition(transitionId, { duration: 2500.4, strategy: 'staged' }),
      changeElement(second.id, { ...copy, rotation: 45 }),
    );

    expect(project.presentation.transitions[0]).toMatchObject({
      id: transitionId,
      duration: 2500,
      strategy: 'staged',
    });
  });

  it('limits the duration of a transition', () => {
    const withSecond = run(base, addKoma('koma-1'));
    const transitionId = withSecond.presentation.transitions[0]?.id ?? '';
    expect(
      run(withSecond, changeTransition(transitionId, { duration: 1 })).presentation.transitions[0]
        ?.duration,
    ).toBe(100);
  });

  it('reconnects the Komas when one is deleted or moved', () => {
    const three = run(base, addKoma('koma-1'), addKoma('koma-1'));
    const ids = three.presentation.komas.map((koma) => koma.id);
    expect(three.presentation.transitions).toHaveLength(2);

    const deleted = run(three, deleteKoma(ids[1] ?? ''));
    expect(
      deleted.presentation.transitions.map((item) => [item.fromKomaId, item.toKomaId]),
    ).toEqual([[ids[0], ids[2]]]);

    const moved = run(three, reorderKoma(ids[0] ?? '', 2));
    expect(moved.presentation.komas.map((koma) => koma.id)).toEqual([ids[1], ids[2], ids[0]]);
    expect(moved.presentation.transitions).toHaveLength(2);
  });

  it('replaces the presentation with a generated one and records it', () => {
    const generated = run(base, addKoma('koma-1')).presentation;
    const project = run(
      base,
      applyGeneration(generated, {
        id: 'generation-1',
        createdAt: '2026-09-29T12:00:00.000Z',
        providerId: 'mock',
        userRequest: 'Introduce Koma Motion',
        status: 'succeeded',
        summary: 'Created 2 Komas',
        warnings: [],
      }),
    );
    expect(project.presentation).toBe(generated);
    expect(project.generationHistory).toHaveLength(1);
    expect(project.brandKit).toBe(base.brandKit);
  });

  it('leaves the original project untouched', () => {
    const before = JSON.stringify(base);
    run(base, addKoma('koma-1'), deleteKoma('koma-1'));
    expect(JSON.stringify(base)).toBe(before);
  });
});
