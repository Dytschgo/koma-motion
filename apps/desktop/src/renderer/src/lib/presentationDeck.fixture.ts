/** Decks for presentation tests. */
import { createSeededIdGenerator, type Koma, type Presentation } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildShape } from '@koma-motion/core/testing';
import { syncTransitions } from '@koma-motion/motion-engine';

const TITLES = ['One', 'Two', 'Three', 'Four'];

function komaAt(index: number, x: number): Koma {
  return buildKoma({
    id: `koma-${String(index + 1)}`,
    title: TITLES[index] ?? `Koma ${String(index + 1)}`,
    elements: [
      buildShape({
        id: `mover-${String(index + 1)}`,
        persistentId: 'mover',
        name: 'Mover',
        position: { x, y: 200 },
      }),
    ],
  });
}

/** A deck whose transitions all match their Komas. */
export function buildDeck(count: number): Presentation {
  const komas = Array.from({ length: count }, (_, index) => komaAt(index, 100 + index * 150));
  return syncTransitions(buildPresentation({ komas }), createSeededIdGenerator('deck'))
    .presentation;
}

/** Moves the mover of the Koma at `index` without rebuilding the transition into it. */
export function makeStale(presentation: Presentation, index: number): Presentation {
  return {
    ...presentation,
    komas: presentation.komas.map((koma, at) => (at === index ? komaAt(at, 1500) : koma)),
  };
}
