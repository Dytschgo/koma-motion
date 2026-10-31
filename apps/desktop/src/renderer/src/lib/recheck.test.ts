import type { GenerationInput } from '@koma-motion/agent-runtime';
import { createSeededIdGenerator } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject, buildShape } from '@koma-motion/core/testing';
import { syncTransitions, validateTransition } from '@koma-motion/motion-engine';
import { describe, expect, it } from 'vitest';
import { isRecheckCommand, prepareRecheck, repairProjectMotion } from './recheck';

const input: GenerationInput = {
  userRequest: 'Make the middle Koma clearer.',
  targetKomaId: 'middle',
  requestedKomaCount: 1,
  objective: null,
  audience: null,
};
const project = buildProject({
  presentation: buildPresentation({
    komas: [buildKoma({ id: 'middle' }), buildKoma({ id: 'last' })],
  }),
});

describe('Recheck', () => {
  it('recognizes the command without consuming ordinary requests that mention rechecking', () => {
    for (const command of ['recheck', ' Recheck! ', '/recheck', 'RECHECK.']) {
      expect(isRecheckCommand(command)).toBe(true);
    }
    for (const request of ['recheck the chart labels', 'Create a recheck checklist', '']) {
      expect(isRecheckCommand(request)).toBe(false);
    }
  });

  it('keeps the original target and count after selection or count changes', () => {
    expect(prepareRecheck(input, project, [])).toEqual(input);
    const entire = { ...input, targetKomaId: undefined, requestedKomaCount: 7 };
    expect(prepareRecheck(entire, project, [])?.requestedKomaCount).toBe(7);
  });

  it('refuses a removed target instead of switching to the entire presentation', () => {
    expect(prepareRecheck(input, buildProject(), [])).toBeNull();
  });

  it('does not reuse previously attached reference content', () => {
    const reference = {
      id: 'reference',
      name: 'notes.txt',
      format: 'txt' as const,
      text: 'Private notes',
      truncated: false,
    };
    // References must come from the current session/consent, never the old input.
    const previous = { ...input, references: [reference] };
    expect(prepareRecheck(previous, project, [])?.references).toBeUndefined();
  });

  it('repairs invalid motion without changing content, timing, or already valid motion', () => {
    const shape = buildShape({ persistentId: 'object' });
    const presentation = syncTransitions(
      buildPresentation({
        komas: [
          buildKoma({ id: 'first', elements: [shape] }),
          buildKoma({
            id: 'second',
            elements: [{ ...shape, id: 'other', position: { x: 400, y: 100 } }],
          }),
        ],
        transitions: [],
      }),
      createSeededIdGenerator('recheck'),
    ).presentation;
    const transition = presentation.transitions[0];
    if (transition === undefined) throw new Error('Missing fixture motion');
    const original = buildProject({ presentation });
    expect(repairProjectMotion(original)).toBe(original);
    const broken = {
      ...original,
      presentation: { ...presentation, transitions: [{ ...transition, elementTransitions: [] }] },
    };
    const repaired = repairProjectMotion(broken);
    expect(repaired.presentation.komas).toBe(broken.presentation.komas);
    expect(repaired.presentation.transitions[0]?.duration).toBe(transition.duration);
    expect(
      validateTransition(repaired.presentation.transitions[0]!, repaired.presentation),
    ).toEqual([]);
    expect(broken.presentation.transitions[0]?.elementTransitions).toEqual([]);
    expect(repairProjectMotion(repaired)).toBe(repaired);
  });
});
