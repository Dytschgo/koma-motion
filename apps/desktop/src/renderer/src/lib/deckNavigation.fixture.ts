import { createSeededIdGenerator, type KomaProject } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { syncTransitions } from '@koma-motion/motion-engine';

/** A long deck with distinguishable metadata, holds and customised adjacent motion. */
export function buildNavigationProject(): KomaProject {
  const komas = Array.from({ length: 100 }, (_, index) => {
    const number = index + 1;
    return buildKoma({
      id: `koma-${String(number)}`,
      title: `Chapter ${String(number)}`,
      purpose: number === 50 ? 'Explain quarterly revenue' : `Purpose ${String(number)}`,
      speakerNotes: `Notes ${String(number)}`,
      holdDurationMs: number % 2 === 0 ? 1000 + number * 100 : null,
      elements: [
        buildShape({ id: `shape-${String(number)}`, position: { x: number * 10, y: 100 } }),
      ],
    });
  });
  const presentation = syncTransitions(
    buildPresentation({ komas, transitions: [] }),
    createSeededIdGenerator('navigation-fixture'),
  ).presentation;
  return buildProject({
    name: 'Long deck navigation',
    presentation: {
      ...presentation,
      transitions: presentation.transitions.map((transition, index) => ({
        ...transition,
        duration: 1000 + index,
        easing: 'easeOut',
        rationale: `Custom motion ${String(index + 1)}`,
      })),
    },
  });
}
