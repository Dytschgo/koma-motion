import { describe, expect, it } from 'vitest';
import { buildDeck, makeStale } from './presentationDeck.fixture';
import {
  getPresentationStep,
  resolvePlayingStep,
  resolvePresenterKoma,
  reviewPresentation,
  stepKey,
} from './presentationPlan';

describe('presentation steps', () => {
  it('plays the stored transition between neighbours', () => {
    const deck = buildDeck(3);
    const step = getPresentationStep(deck, 0);
    expect(step?.kind).toBe('motion');
    if (step?.kind !== 'motion') return;
    expect(step.transition.fromKomaId).toBe('koma-1');
    expect(step.to.id).toBe('koma-2');
    expect(getPresentationStep(deck, 2)).toBeNull();
  });

  it('names a stale transition as a problem and never as motion', () => {
    const deck = makeStale(buildDeck(3), 1);
    const step = getPresentationStep(deck, 0);
    expect(step?.kind).toBe('problem');
    if (step?.kind !== 'problem') return;
    expect(step.problem).toMatchObject({
      key: stepKey('koma-1', 'koma-2'),
      fromNumber: 1,
      label: 'Out of date',
    });
    expect(step.problem.reason).toContain('"One" or "Two" changed');
  });

  it('names a missing transition as a problem', () => {
    const deck = { ...buildDeck(2), transitions: [] };
    const step = getPresentationStep(deck, 0);
    expect(step).toMatchObject({
      kind: 'problem',
      problem: { label: 'No transition', transitionId: null },
    });
  });

  it('reviews only the steps from the start onwards', () => {
    // Changing Koma 2 makes the transitions into it and out of it stale.
    const deck = makeStale(buildDeck(4), 1);
    const numbers = (startIndex: number): number[] =>
      reviewPresentation(deck, startIndex).problems.map((problem) => problem.fromNumber);
    expect(numbers(0)).toEqual([1, 2]);
    expect(numbers(1)).toEqual([2]);
    expect(numbers(2)).toEqual([]);
    expect(reviewPresentation(buildDeck(1), 0)).toEqual({ problems: [], notes: [] });
  });

  it('notes a transition that plays without operations from a newer version', () => {
    const deck = buildDeck(2);
    const [transition] = deck.transitions;
    if (transition === undefined) throw new Error('Expected a transition');
    const future = {
      ...deck,
      transitions: [
        {
          ...transition,
          elementTransitions: [
            ...transition.elementTransitions,
            // An operation from a later version, as it would arrive from a file.
            JSON.parse(
              '{"persistentId":"mover","operation":"wiggle","from":null,"to":{"elementId":"mover-2"}}',
            ) as (typeof transition.elementTransitions)[number],
          ],
        },
      ],
    };
    const review = reviewPresentation(future, 0);
    expect(review.problems).toEqual([]);
    expect(review.notes).toHaveLength(1);
    expect(getPresentationStep(future, 0)?.kind).toBe('motion');
  });
});

describe('the presenter Koma', () => {
  it('follows the Koma by id after a reorder', () => {
    const deck = buildDeck(3);
    const reordered = { ...deck, komas: [...deck.komas].reverse() };
    expect(resolvePresenterKoma(reordered, 'koma-1', 0)?.index).toBe(2);
  });

  it('takes the Koma that took the place of a deleted one, or the last one', () => {
    const deck = buildDeck(3);
    const withoutSecond = { ...deck, komas: deck.komas.filter((koma) => koma.id !== 'koma-2') };
    expect(resolvePresenterKoma(withoutSecond, 'koma-2', 1)?.koma.id).toBe('koma-3');
    const withoutLast = { ...deck, komas: deck.komas.slice(0, 2) };
    expect(resolvePresenterKoma(withoutLast, 'koma-3', 2)?.koma.id).toBe('koma-2');
    expect(resolvePresenterKoma({ ...deck, komas: [] }, 'koma-1', 0)).toBeNull();
  });
});

describe('the playing step', () => {
  it('stays valid while its settings change and not when its Komas change', () => {
    const deck = buildDeck(3);
    const [transition] = deck.transitions;
    if (transition === undefined) throw new Error('Expected a transition');
    const motion = {
      transitionId: transition.id,
      fromKomaId: 'koma-1',
      toKomaId: 'koma-2',
    };
    const slower = {
      ...deck,
      transitions: deck.transitions.map((candidate) =>
        candidate === transition ? { ...candidate, duration: 4000 } : candidate,
      ),
    };
    expect(resolvePlayingStep(slower, motion)?.transition.duration).toBe(4000);
    expect(resolvePlayingStep(makeStale(deck, 1), motion)).toBeNull();
    const [first, second, third] = deck.komas;
    if (first === undefined || second === undefined || third === undefined) throw new Error();
    const reordered = { ...deck, komas: [second, first, third] };
    expect(resolvePlayingStep(reordered, motion)).toBeNull();
  });
});
