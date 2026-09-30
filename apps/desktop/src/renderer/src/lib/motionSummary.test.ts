import { createSeededIdGenerator } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildShape, buildText } from '@koma-motion/core/testing';
import { motionIssue, syncTransitions, validateTransition } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import { filterEffects, getMotionStatus, summariseMotion } from './motionSummary';

const engine = buildShape({ id: 'engine-1', persistentId: 'engine', name: 'Engine' });
const title = buildText({ id: 'title-1', persistentId: 'title', name: 'Title' });
const badge = buildShape({ id: 'badge-1', persistentId: 'badge', name: '' });
const from = buildKoma({ id: 'koma-1', elements: [engine, title] });
const to = buildKoma({
  id: 'koma-2',
  elements: [
    { ...engine, id: 'engine-2', position: { x: 600, y: 100 } },
    { ...title, id: 'title-2' },
    { ...badge, id: 'badge-2' },
  ],
});
const presentation = syncTransitions(
  buildPresentation({ komas: [from, to], transitions: [] }),
  createSeededIdGenerator('summary'),
).presentation;
const transition = presentation.transitions[0];
if (transition === undefined) throw new Error('Expected a transition');

describe('motion summary', () => {
  it('describes each object once with a readable name', () => {
    const summary = summariseMotion(transition, from, to);
    expect(summary.counts).toEqual({ changes: 1, enters: 1, exits: 0, holds: 1 });
    expect(summary.effects).toContainEqual(
      expect.objectContaining({ persistentId: 'engine', name: 'Engine', kind: 'changes' }),
    );
    expect(summary.effects).toContainEqual(
      expect.objectContaining({ name: 'Title', kind: 'holds', description: 'holds' }),
    );
    // No name: the persistent identity is shown instead of an empty row.
    expect(summary.effects).toContainEqual(
      expect.objectContaining({ name: 'badge', kind: 'enters', description: 'enters' }),
    );
  });

  it('filters effects by object and description', () => {
    const { effects } = summariseMotion(transition, from, to);
    expect(filterEffects(effects, 'engi').map((effect) => effect.name)).toEqual(['Engine']);
    expect(filterEffects(effects, 'ENTERS').map((effect) => effect.name)).toEqual(['badge']);
  });
});

describe('motion status', () => {
  it('is ready only when the stored motion matches both Komas', () => {
    expect(getMotionStatus(validateTransition(transition, presentation)).health).toBe('ready');
  });

  it('reports motion that no longer matches the Komas as out of date', () => {
    const moved = {
      ...presentation,
      komas: [from, { ...to, elements: to.elements.map((item) => ({ ...item, rotation: 45 })) }],
    };
    const status = getMotionStatus(validateTransition(transition, moved));
    expect(status.health).toBe('stale');
    expect(status.title).toBe('Motion is out of date');
  });

  it('separates unplayable motion from skipped effects', () => {
    expect(getMotionStatus([motionIssue('duplicateOperation', 'Twice')]).health).toBe('blocked');
    const partial = getMotionStatus([motionIssue('unsupportedOperation', 'Future')]);
    expect(partial.health).toBe('partial');
    expect(partial.detail).toContain('1 effect is not supported');
  });
});
