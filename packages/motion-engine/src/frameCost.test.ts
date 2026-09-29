import type { GroupElement, Koma, KomaTransition } from '@koma-motion/core';
import { buildKoma, buildShape } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { computeFrame, komaToFrame } from './frame';
import { buildTransition } from './transition';

function transitionBetween(from: Koma, to: Koma): KomaTransition {
  const result = buildTransition({ id: 'transition-1', from, to });
  if (!result.ok) {
    throw new Error('Expected a transition');
  }
  return result.value.transition;
}

/** A Koma of groups with many children, the most expensive kind to validate. */
function largeKoma(id: string, offset: number): Koma {
  const groups = Array.from({ length: 200 }, (_unused, group): GroupElement => {
    const base = buildShape();
    return {
      id: `${id}-group-${String(group)}`,
      persistentId: `group-${String(group)}`,
      name: base.name,
      position: { x: group + offset, y: 0 },
      size: base.size,
      rotation: 0,
      opacity: 1,
      zIndex: 1,
      locked: false,
      visible: true,
      type: 'group',
      content: {
        referenceSize: { width: 200, height: 200 },
        children: Array.from({ length: 40 }, (_child, child) =>
          buildShape({
            id: `${id}-child-${String(group)}-${String(child)}`,
            persistentId: `child-${String(group)}-${String(child)}`,
          }),
        ),
      },
      style: {},
    };
  });
  return buildKoma({ id, elements: groups });
}

describe('cost of a frame', () => {
  it('validates once for the same Komas and operations, not once per frame', () => {
    const source = largeKoma('large-1', 0);
    const target = largeKoma('large-2', 50);
    const transition = transitionBetween(source, target);
    const frames = 60;

    const startedFirst = Date.now();
    const firstFrame = computeFrame({ from: source, to: target, transition, progress: 0.01 });
    const first = Date.now() - startedFirst;
    // The transition is valid: the frame is not the unchanged source Koma.
    expect(firstFrame).not.toEqual(komaToFrame(source));

    const startedRest = Date.now();
    for (let frame = 1; frame <= frames; frame += 1) {
      computeFrame({ from: source, to: target, transition, progress: frame / (frames + 1) });
    }
    const perFrame = (Date.now() - startedRest) / frames;

    // The first frame pays for validation. Later frames must be far cheaper.
    expect(perFrame).toBeLessThan(Math.max(first / 4, 2));
  });

  it('validates again when the operations are replaced', () => {
    const engine = buildShape({ id: 'engine-1', persistentId: 'engine' });
    const from = buildKoma({ id: 'koma-1', elements: [engine] });
    const to = buildKoma({
      id: 'koma-2',
      elements: [{ ...engine, id: 'engine-2', position: { x: 900, y: 100 } }],
    });
    const transition = transitionBetween(from, to);
    expect(computeFrame({ from, to, transition, progress: 0.5 })).not.toEqual(komaToFrame(from));

    const invalid = {
      ...transition,
      elementTransitions: transition.elementTransitions.map((item) => ({
        ...item,
        from: item.from === null ? null : { ...item.from, elementId: 'element-invented' },
      })),
    };
    expect(computeFrame({ from, to, transition: invalid, progress: 0.5 })).toEqual(
      komaToFrame(from),
    );
    // The valid transition is still played after the invalid one was rejected.
    expect(computeFrame({ from, to, transition, progress: 0.5 })).not.toEqual(komaToFrame(from));
  });
});
