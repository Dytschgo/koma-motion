import { createSeededIdGenerator, type KomaTransition } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildShape, buildText } from '@koma-motion/core/testing';
import { syncTransitions } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import { getCurrentTransition, resolvePreviewTransition } from './selectors';

const shape = buildShape({ id: 'shape-1', persistentId: 'shape' });
const first = buildKoma({ id: 'koma-1', title: 'First', elements: [shape] });
const second = buildKoma({
  id: 'koma-2',
  title: 'Second',
  elements: [{ ...shape, id: 'shape-2', position: { x: 320, y: 80 } }],
});
const third = buildKoma({
  id: 'koma-3',
  title: 'Third',
  elements: [
    { ...shape, id: 'shape-3', position: { x: 40, y: 200 } },
    buildText({ id: 'caption-3', persistentId: 'caption' }),
  ],
});

const presentation = syncTransitions(
  buildPresentation({ komas: [first, second, third] }),
  createSeededIdGenerator('preview-identity'),
).presentation;

function transitionAt(index: number): KomaTransition {
  const transition = presentation.transitions[index];
  if (transition === undefined) {
    throw new Error(`Expected a transition at index ${String(index)}`);
  }
  return transition;
}

const opening = transitionAt(0);
const identity = {
  transitionId: opening.id,
  fromKomaId: opening.fromKomaId,
  toKomaId: opening.toKomaId,
};

describe('resolvePreviewTransition', () => {
  it('accepts the recorded pair while it is still adjacent', () => {
    const resolved = resolvePreviewTransition(presentation, identity);
    expect(resolved?.transition.id).toBe(opening.id);
    expect(resolved?.from.id).toBe('koma-1');
    expect(resolved?.to.id).toBe('koma-2');
  });

  it('rejects a missing transition id', () => {
    expect(resolvePreviewTransition(presentation, { ...identity, transitionId: 'missing' })).toBe(
      null,
    );
  });

  it('rejects a transition whose ends no longer match the recorded pair', () => {
    const rewired = {
      ...presentation,
      transitions: presentation.transitions.map((transition) =>
        transition.id === opening.id
          ? { ...transition, fromKomaId: second.id, toKomaId: third.id }
          : transition,
      ),
    };
    expect(resolvePreviewTransition(rewired, identity)).toBeNull();
    expect(resolvePreviewTransition(presentation, { ...identity, toKomaId: third.id })).toBeNull();
  });

  it('rejects a pair that is no longer adjacent in that order', () => {
    const separated = { ...presentation, komas: [first, third, second] };
    const reversed = { ...presentation, komas: [second, first, third] };
    expect(resolvePreviewTransition(separated, identity)).toBeNull();
    expect(resolvePreviewTransition(reversed, identity)).toBeNull();
  });

  it('stays valid when only the duration changes', () => {
    const longer = {
      ...presentation,
      transitions: presentation.transitions.map((transition) =>
        transition.id === opening.id ? { ...transition, duration: 4000 } : transition,
      ),
    };
    const resolved = resolvePreviewTransition(longer, identity);
    expect(resolved?.transition.id).toBe(opening.id);
    expect(resolved?.transition.duration).toBe(4000);
    expect(resolved?.from.id).toBe(identity.fromKomaId);
    expect(resolved?.to.id).toBe(identity.toKomaId);
  });
});

describe('getCurrentTransition', () => {
  it('does not substitute another transition while a stale preview id is set', () => {
    expect(
      getCurrentTransition(presentation, first.id, { ...identity, transitionId: 'missing' }),
    ).toBeNull();
    expect(getCurrentTransition(presentation, third.id, null)?.id).toBe(transitionAt(1).id);
  });
});
