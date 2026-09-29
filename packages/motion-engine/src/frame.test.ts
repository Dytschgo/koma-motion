import type { Koma, KomaElement, KomaTransition } from '@koma-motion/core';
import { buildKoma, buildShape, buildText } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { applyEasing, getOperationProgress } from './easing';
import {
  computeFrame,
  findUnsupportedOperations,
  komaToFrame,
  type Frame,
  type FrameLayer,
} from './frame';
import { buildTransition } from './transition';

function transitionBetween(
  from: Koma,
  to: Koma,
  settings: { strategy?: string; easing?: string } = {},
): KomaTransition {
  const result = buildTransition({
    id: 'transition-1',
    from,
    to,
    suggestion: { easing: 'linear', ...settings },
  });
  if (!result.ok) {
    throw new Error('Expected a transition');
  }
  return result.value.transition;
}

function layer(frame: Frame, key: string): FrameLayer {
  const match = frame.layers.find((candidate) => candidate.key === key);
  if (match === undefined) {
    throw new Error(`No layer ${key} in [${frame.layers.map((item) => item.key).join(', ')}]`);
  }
  return match;
}

const engine = buildShape({
  id: 'engine-1',
  persistentId: 'motion-engine',
  position: { x: 0, y: 0 },
  size: { width: 100, height: 100 },
});
const engineLater: KomaElement = {
  ...engine,
  id: 'engine-2',
  position: { x: 400, y: 200 },
  size: { width: 300, height: 300 },
  rotation: 90,
  opacity: 0.5,
  style: { ...engine.style, fill: '#000000' },
};
const leaving = buildText({ id: 'leaving-1', persistentId: 'leaving' });
const arriving = buildText({ id: 'arriving-2', persistentId: 'arriving', opacity: 0.8 });
const steady = buildShape({ id: 'steady-1', persistentId: 'steady' });

const from = buildKoma({
  id: 'koma-1',
  background: { type: 'solid', colour: '#000000' },
  elements: [engine, leaving, steady],
});
const to = buildKoma({
  id: 'koma-2',
  background: { type: 'solid', colour: '#FFFFFF' },
  elements: [engineLater, arriving, { ...steady, id: 'steady-2' }],
});

describe('computeFrame', () => {
  const transition = transitionBetween(from, to);

  it('is exactly the source Koma at the start', () => {
    expect(computeFrame({ from, to, transition, progress: 0 })).toEqual(komaToFrame(from));
    expect(computeFrame({ from, to, transition, progress: -2 })).toEqual(komaToFrame(from));
  });

  it('is exactly the target Koma at the end', () => {
    expect(computeFrame({ from, to, transition, progress: 1 })).toEqual(komaToFrame(to));
    expect(computeFrame({ from, to, transition, progress: 7 })).toEqual(komaToFrame(to));
  });

  it('interpolates position, size, rotation, opacity and colour of a retained object', () => {
    const frame = computeFrame({ from, to, transition, progress: 0.5 });
    const { element, role } = layer(frame, 'motion-engine/retained');
    expect(role).toBe('retained');
    expect(element.id).toBe('engine-2');
    expect(element.position).toEqual({ x: 200, y: 100 });
    expect(element.size).toEqual({ width: 200, height: 200 });
    expect(element.rotation).toBe(45);
    expect(element.opacity).toBe(0.75);
    expect(element.type === 'shape' && element.style.fill).toBe('#802D1B');
  });

  it('holds an unchanged object', () => {
    const frame = computeFrame({ from, to, transition, progress: 0.5 });
    const { element } = layer(frame, 'steady/retained');
    expect({ ...element, id: steady.id }).toEqual(steady);
  });

  it('fades entering objects in and exiting objects out', () => {
    const frame = computeFrame({ from, to, transition, progress: 0.25 });
    expect(layer(frame, 'arriving/entering').element.opacity).toBeCloseTo(0.2);
    expect(layer(frame, 'leaving/exiting').element.opacity).toBeCloseTo(0.75);
  });

  it('interpolates the background', () => {
    const frame = computeFrame({ from, to, transition, progress: 0.5 });
    expect(frame.background.colour).toBe('#808080');
  });

  it('cross-fades a replaced object while it moves', () => {
    const title = buildText({ id: 'title-1', persistentId: 'title', position: { x: 0, y: 0 } });
    const source = buildKoma({ elements: [title] });
    const target = buildKoma({
      elements: [
        { ...title, id: 'title-2', position: { x: 100, y: 0 }, content: { text: 'New words' } },
      ],
    });
    const frame = computeFrame({
      from: source,
      to: target,
      transition: transitionBetween(source, target),
      progress: 0.25,
    });

    const outgoing = layer(frame, 'title/outgoing').element;
    const incoming = layer(frame, 'title/incoming').element;
    expect(outgoing.type === 'text' && outgoing.content.text).toBe('Presentations are frames.');
    expect(incoming.type === 'text' && incoming.content.text).toBe('New words');
    expect(outgoing.opacity).toBeCloseTo(0.75);
    expect(incoming.opacity).toBeCloseTo(0.25);
    expect(outgoing.position).toEqual({ x: 25, y: 0 });
    expect(incoming.position).toEqual({ x: 25, y: 0 });
  });

  it('uses only the stored transition and never compares the Komas itself', () => {
    const withoutOperations = { ...transition, elementTransitions: [] };
    const frame = computeFrame({ from, to, transition: withoutOperations, progress: 0.5 });
    expect(layer(frame, 'motion-engine/retained').element.position).toEqual(engine.position);
    expect(frame.layers.map((item) => item.key)).not.toContain('arriving/entering');
  });

  it('skips operations it does not know', () => {
    const unknown = {
      ...transition,
      elementTransitions: [
        ...transition.elementTransitions,
        {
          persistentId: 'motion-engine',
          operation: 'morph',
          from: { elementId: 'engine-1' },
          to: { elementId: 'engine-2' },
        },
      ],
    };
    expect(computeFrame({ from, to, transition: unknown, progress: 0.5 })).toEqual(
      computeFrame({ from, to, transition, progress: 0.5 }),
    );
    expect(findUnsupportedOperations(unknown).map((issue) => issue.code)).toEqual([
      'unsupportedOperation',
    ]);
    expect(findUnsupportedOperations(transition)).toEqual([]);
  });

  it('is deterministic', () => {
    expect(computeFrame({ from, to, transition, progress: 0.37 })).toEqual(
      computeFrame({ from, to, transition, progress: 0.37 }),
    );
  });

  it('does not play invented coordinates or a false element reference', () => {
    const invented = {
      ...transition,
      elementTransitions: [
        {
          persistentId: 'motion-engine',
          operation: 'move',
          from: { elementId: 'engine-1', position: { x: 5, y: 5 } },
          to: { elementId: 'missing-shape', position: { x: 9000, y: 9000 } },
        },
      ],
    };
    expect(computeFrame({ from, to, transition: invented, progress: 0.5 })).toEqual(
      komaToFrame(from),
    );
    expect(computeFrame({ from, to, transition: invented, progress: 0 })).toEqual(
      komaToFrame(from),
    );
    expect(computeFrame({ from, to, transition: invented, progress: 1 })).toEqual(komaToFrame(to));
    expect(layer(komaToFrame(from), 'motion-engine/retained').element.position).toEqual(
      engine.position,
    );
  });

  it('does not play duplicate move operations', () => {
    const move = transition.elementTransitions.find((item) => item.operation === 'move');
    if (move === undefined) {
      throw new Error('Expected a move');
    }
    const duplicated = {
      ...transition,
      elementTransitions: [...transition.elementTransitions, move],
    };
    expect(computeFrame({ from, to, transition: duplicated, progress: 0.5 })).toEqual(
      komaToFrame(from),
    );
    expect(computeFrame({ from, to, transition: duplicated, progress: 1 })).toEqual(
      komaToFrame(to),
    );
  });

  it('keeps source stacking until the transition ends', () => {
    const alpha = buildShape({
      id: 'a-1',
      persistentId: 'alpha',
      name: 'Alpha',
      zIndex: 1,
      position: { x: 0, y: 0 },
    });
    const beta = buildShape({
      id: 'b-1',
      persistentId: 'beta',
      name: 'Beta',
      zIndex: 1,
      position: { x: 40, y: 40 },
    });
    const gamma = buildShape({
      id: 'c-2',
      persistentId: 'gamma',
      name: 'Gamma',
      zIndex: 1,
      position: { x: 80, y: 80 },
    });
    const source = buildKoma({ id: 'koma-1', elements: [alpha, beta] });
    const target = buildKoma({
      id: 'koma-2',
      elements: [
        { ...beta, id: 'b-2' },
        { ...alpha, id: 'a-2', zIndex: 5, position: { x: 120, y: 0 } },
        gamma,
      ],
    });
    const stacked = transitionBetween(source, target);
    const middle = computeFrame({ from: source, to: target, transition: stacked, progress: 0.5 });
    expect(middle.layers.map((item) => item.persistentId)).toEqual(['alpha', 'beta', 'gamma']);
    expect(middle.layers.map((item) => item.element.zIndex)).toEqual([1, 1, 1]);
    expect(middle.layers[0]?.element.position).toEqual({ x: 60, y: 0 });

    const end = computeFrame({ from: source, to: target, transition: stacked, progress: 1 });
    expect(end.layers.map((item) => item.persistentId)).toEqual(['beta', 'alpha', 'gamma']);
    expect(end.layers.find((item) => item.persistentId === 'alpha')?.element.zIndex).toBe(5);
  });

  it('keeps a replace cross-fade on the source zIndex with outgoing first', () => {
    const title = buildText({
      id: 'title-1',
      persistentId: 'title',
      position: { x: 0, y: 0 },
      zIndex: 3,
    });
    const source = buildKoma({ id: 'koma-1', elements: [title] });
    const target = buildKoma({
      id: 'koma-2',
      elements: [
        {
          ...title,
          id: 'title-2',
          position: { x: 80, y: 0 },
          zIndex: 9,
          content: { text: 'New words' },
        },
      ],
    });
    const crossFade = transitionBetween(source, target);
    const frame = computeFrame({
      from: source,
      to: target,
      transition: crossFade,
      progress: 0.25,
    });
    expect(frame.layers.map((item) => item.key)).toEqual(['title/outgoing', 'title/incoming']);
    expect(frame.layers.map((item) => item.element.zIndex)).toEqual([3, 3]);
    expect(
      computeFrame({ from: source, to: target, transition: crossFade, progress: 1 }).layers[0]
        ?.element.zIndex,
    ).toBe(9);
  });
});

describe('staged strategy', () => {
  const transition = transitionBetween(from, to, { strategy: 'staged' });

  it('lets objects leave before retained objects change and new objects enter', () => {
    const early = computeFrame({ from, to, transition, progress: 0.2 });
    expect(layer(early, 'leaving/exiting').element.opacity).toBeCloseTo(0.5);
    expect(layer(early, 'motion-engine/retained').element.position).toEqual({ x: 0, y: 0 });
    expect(layer(early, 'arriving/entering').element.opacity).toBe(0);

    const middle = computeFrame({ from, to, transition, progress: 0.5 });
    expect(layer(middle, 'leaving/exiting').element.opacity).toBe(0);
    expect(layer(middle, 'motion-engine/retained').element.position.x).toBeCloseTo(200);
    expect(layer(middle, 'motion-engine/retained').element.position.y).toBeCloseTo(100);
    expect(layer(middle, 'arriving/entering').element.opacity).toBe(0);

    const late = computeFrame({ from, to, transition, progress: 0.8 });
    expect(layer(late, 'motion-engine/retained').element.position).toEqual({ x: 400, y: 200 });
    expect(layer(late, 'arriving/entering').element.opacity).toBeCloseTo(0.4);
  });
});

describe('easing', () => {
  it.each(['linear', 'easeIn', 'easeOut', 'easeInOut'] as const)(
    '%s starts at 0 and ends at 1',
    (easing) => {
      expect(applyEasing(easing, 0)).toBe(0);
      expect(applyEasing(easing, 1)).toBe(1);
      expect(applyEasing(easing, 0.5)).toBeGreaterThan(0);
      expect(applyEasing(easing, 0.5)).toBeLessThan(1);
    },
  );

  it('clamps progress outside a timing window', () => {
    expect(getOperationProgress(0.1, 'staged', 'linear', 'entering')).toBe(0);
    expect(getOperationProgress(0.9, 'staged', 'linear', 'exiting')).toBe(1);
  });
});
