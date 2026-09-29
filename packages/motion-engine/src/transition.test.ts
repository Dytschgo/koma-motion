import {
  createSeededIdGenerator,
  presentationSchema,
  type KomaTransition,
} from '@koma-motion/core';
import { buildKoma, buildPresentation, buildShape, buildText } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { buildTransition, normaliseSettings, syncTransitions } from './transition';
import { validateTransition, type TransitionLike } from './validate';

const engine = buildShape({ id: 'engine-1', persistentId: 'motion-engine' });
const first = buildKoma({ id: 'koma-1', title: 'System', elements: [engine] });
const second = buildKoma({
  id: 'koma-2',
  title: 'Focus',
  elements: [{ ...engine, id: 'engine-2', position: { x: 760, y: 340 } }],
});
const third = buildKoma({
  id: 'koma-3',
  title: 'Result',
  elements: [
    { ...engine, id: 'engine-3', position: { x: 200, y: 340 } },
    buildText({ id: 'caption-3', persistentId: 'caption' }),
  ],
});

function build(suggestion?: Parameters<typeof buildTransition>[0]['suggestion']): {
  transition: KomaTransition;
  warnings: readonly string[];
} {
  const result = buildTransition({
    id: 'transition-1',
    from: first,
    to: second,
    ...(suggestion === undefined ? {} : { suggestion }),
  });
  if (!result.ok) {
    throw new Error('Expected a transition');
  }
  return {
    transition: result.value.transition,
    warnings: result.value.warnings.map((warning) => warning.code),
  };
}

describe('normaliseSettings', () => {
  it('uses defaults when nothing is suggested', () => {
    expect(normaliseSettings()).toEqual({
      strategy: 'continuous',
      duration: 900,
      easing: 'easeInOut',
      rationale: '',
      warnings: [],
    });
  });

  it('keeps valid suggestions', () => {
    const settings = normaliseSettings({
      strategy: 'staged',
      duration: 1200.4,
      easing: 'easeOut',
      rationale: '  The engine takes the stage.  ',
    });
    expect(settings).toMatchObject({
      strategy: 'staged',
      duration: 1200,
      easing: 'easeOut',
      rationale: 'The engine takes the stage.',
      warnings: [],
    });
  });

  it.each([
    [{ duration: 5 }, 100],
    [{ duration: 600000 }, 10000],
    [{ duration: Number.NaN }, 900],
    [{ duration: '800' }, 900],
  ])('normalises the duration of %o to %i', (suggestion, expected) => {
    const settings = normaliseSettings(suggestion);
    expect(settings.duration).toBe(expected);
    expect(settings.warnings.map((warning) => warning.code)).toEqual(['settingAdjusted']);
  });

  it('replaces unsupported strategies and easings', () => {
    const settings = normaliseSettings({ strategy: 'explode', easing: 'bounce' });
    expect(settings.strategy).toBe('continuous');
    expect(settings.easing).toBe('easeInOut');
    expect(settings.warnings).toHaveLength(2);
    expect(settings.warnings[0]?.message).toContain('explode');
  });
});

describe('buildTransition', () => {
  it('builds a valid transition with a factual rationale', () => {
    const { transition, warnings } = build();
    expect(transition).toMatchObject({
      id: 'transition-1',
      fromKomaId: 'koma-1',
      toKomaId: 'koma-2',
      strategy: 'continuous',
      duration: 900,
      easing: 'easeInOut',
      rationale: '1 object changes.',
    });
    expect(transition.elementTransitions.map((item) => item.operation)).toEqual(['move']);
    expect(warnings).toEqual([]);
  });

  it('keeps the rationale of a suggestion and ignores suggested operations', () => {
    const { transition } = build({
      rationale: 'The engine moves to the centre.',
      // An agent cannot dictate operations: they are always computed.
      ...{ elementTransitions: [{ persistentId: 'x', operation: 'explode' }] },
    });
    expect(transition.rationale).toBe('The engine moves to the centre.');
    expect(transition.elementTransitions.map((item) => item.operation)).toEqual(['move']);
  });

  it('is deterministic', () => {
    expect(build({ strategy: 'staged' })).toEqual(build({ strategy: 'staged' }));
  });

  it('fails for invalid Komas', () => {
    const result = buildTransition({
      id: 'transition-1',
      from: buildKoma({ elements: [engine, { ...engine, id: 'copy' }] }),
      to: second,
    });
    expect(result.ok).toBe(false);
  });
});

describe('syncTransitions', () => {
  it('creates one transition for every adjacent pair', () => {
    const presentation = buildPresentation({ komas: [first, second, third] });
    const { presentation: synced, warnings } = syncTransitions(
      presentation,
      createSeededIdGenerator('sync'),
    );
    expect(synced.transitions.map((item) => [item.fromKomaId, item.toKomaId])).toEqual([
      ['koma-1', 'koma-2'],
      ['koma-2', 'koma-3'],
    ]);
    expect(warnings).toEqual([]);
    expect(presentationSchema.safeParse(synced).success).toBe(true);
  });

  it('keeps settings of existing transitions and recomputes their operations', () => {
    const presentation = buildPresentation({ komas: [first, second] });
    const generator = createSeededIdGenerator('sync');
    const initial = syncTransitions(presentation, generator).presentation;
    const customised = {
      ...initial,
      transitions: initial.transitions.map((transition) => ({
        ...transition,
        duration: 2000,
        strategy: 'staged' as const,
        rationale: 'Chosen by a person.',
      })),
      komas: [first, { ...second, elements: [{ ...engine, id: 'engine-2', rotation: 30 }] }],
    };

    const synced = syncTransitions(customised, generator).presentation;

    expect(synced.transitions[0]).toMatchObject({
      id: initial.transitions[0]?.id,
      duration: 2000,
      strategy: 'staged',
      rationale: 'Chosen by a person.',
    });
    expect(synced.transitions[0]?.elementTransitions.map((item) => item.operation)).toEqual([
      'rotate',
    ]);
  });

  it('removes transitions of pairs that are no longer adjacent', () => {
    const generator = createSeededIdGenerator('sync');
    const initial = syncTransitions(
      buildPresentation({ komas: [first, second, third] }),
      generator,
    ).presentation;
    const reordered = syncTransitions({ ...initial, komas: [first, third, second] }, generator);
    expect(
      reordered.presentation.transitions.map((item) => [item.fromKomaId, item.toKomaId]),
    ).toEqual([
      ['koma-1', 'koma-3'],
      ['koma-3', 'koma-2'],
    ]);
  });

  it('reports pairs that cannot be compared and leaves them without a transition', () => {
    const broken = buildKoma({
      id: 'koma-2',
      title: 'Broken',
      elements: [engine, { ...engine, id: 'copy' }],
    });
    const { presentation, warnings } = syncTransitions(
      buildPresentation({ komas: [first, broken] }),
      createSeededIdGenerator('sync'),
    );
    expect(presentation.transitions).toEqual([]);
    expect(warnings.map((warning) => warning.code)).toEqual(['duplicatePersistentId']);
  });
});

describe('validateTransition', () => {
  const presentation = syncTransitions(
    buildPresentation({ komas: [first, second, third] }),
    createSeededIdGenerator('validate'),
  ).presentation;
  const valid = presentation.transitions[0];
  if (valid === undefined) {
    throw new Error('Expected a transition');
  }

  const codes = (transition: TransitionLike): string[] =>
    validateTransition(transition, presentation).map((issue) => issue.code);

  it('accepts a computed transition', () => {
    expect(codes(valid)).toEqual([]);
  });

  it('reports a missing source Koma', () => {
    expect(codes({ ...valid, fromKomaId: 'koma-gone' })).toEqual(['missingSourceKoma']);
  });

  it('reports a missing target Koma', () => {
    expect(codes({ ...valid, toKomaId: 'koma-gone' })).toEqual(['missingTargetKoma']);
  });

  it('reports both Komas when both are missing', () => {
    expect(codes({ ...valid, fromKomaId: 'a', toKomaId: 'b' })).toEqual([
      'missingSourceKoma',
      'missingTargetKoma',
    ]);
  });

  it('reports Komas that do not follow one another', () => {
    expect(codes({ ...valid, toKomaId: 'koma-3' })).toContain('nonAdjacentKomas');
  });

  it('reports references to objects that do not exist', () => {
    const issues = validateTransition(
      {
        ...valid,
        elementTransitions: [
          {
            persistentId: 'ghost',
            operation: 'move',
            from: { elementId: 'ghost-1' },
            to: { elementId: 'ghost-2' },
          },
        ],
      },
      presentation,
    );
    expect(issues.map((issue) => issue.code)).toEqual([
      'invalidElementReference',
      'invalidElementReference',
    ]);
    expect(issues[0]?.persistentId).toBe('ghost');
  });

  it('reports references to the wrong element', () => {
    expect(
      codes({
        ...valid,
        elementTransitions: [
          {
            persistentId: 'motion-engine',
            operation: 'move',
            from: { elementId: 'engine-1' },
            to: { elementId: 'engine-3' },
          },
        ],
      }),
    ).toEqual(['invalidElementReference']);
  });

  it('reports operations without any state', () => {
    expect(
      codes({
        ...valid,
        elementTransitions: [
          { persistentId: 'motion-engine', operation: 'hold', from: null, to: null },
        ],
      }),
    ).toEqual(['invalidElementReference']);
  });

  it('reports unsupported operations', () => {
    const issues = validateTransition(
      {
        ...valid,
        elementTransitions: [
          {
            persistentId: 'motion-engine',
            operation: 'morph',
            from: { elementId: 'engine-1' },
            to: { elementId: 'engine-2' },
          },
        ],
      },
      presentation,
    );
    expect(issues.map((issue) => issue.code)).toEqual(['unsupportedOperation']);
    expect(issues[0]?.message).toContain('"morph"');
  });

  it('reports a transition that no longer matches its Komas', () => {
    expect(codes({ ...valid, elementTransitions: [] })).toEqual(['staleTransition']);
  });

  it('reports duplicate move operations', () => {
    const move = valid.elementTransitions[0];
    if (move === undefined) {
      throw new Error('Expected a move');
    }
    expect(codes({ ...valid, elementTransitions: [move, { ...move }] })).toEqual([
      'duplicateOperation',
    ]);
  });

  it('reports operations that write the same property', () => {
    expect(
      codes({
        ...valid,
        elementTransitions: [
          {
            persistentId: 'motion-engine',
            operation: 'fadeIn',
            from: { elementId: 'engine-1', opacity: 0 },
            to: { elementId: 'engine-2', opacity: 1 },
          },
          {
            persistentId: 'motion-engine',
            operation: 'fadeOut',
            from: { elementId: 'engine-1', opacity: 1 },
            to: { elementId: 'engine-2', opacity: 0 },
          },
        ],
      }),
    ).toEqual(['conflictingOperations']);
  });

  it('reports hold combined with another operation', () => {
    const move = valid.elementTransitions[0];
    if (move === undefined) {
      throw new Error('Expected a move');
    }
    expect(
      codes({
        ...valid,
        elementTransitions: [
          {
            persistentId: 'motion-engine',
            operation: 'hold',
            from: { elementId: 'engine-1' },
            to: { elementId: 'engine-2' },
          },
          move,
        ],
      }),
    ).toEqual(['conflictingOperations']);
  });

  it('does not disable a valid transition because of an unknown operation', () => {
    expect(
      codes({
        ...valid,
        elementTransitions: [
          ...valid.elementTransitions,
          {
            persistentId: 'motion-engine',
            operation: 'morph',
            from: { elementId: 'engine-1' },
            to: { elementId: 'engine-2' },
          },
        ],
      }),
    ).toEqual(['unsupportedOperation']);
  });

  it('accepts a replace cross-fade that also moves', () => {
    const shape = buildShape({ id: 'engine-1', persistentId: 'motion-engine' });
    const from = buildKoma({ id: 'koma-1', title: 'System', elements: [shape] });
    const moved = buildKoma({
      id: 'koma-2',
      title: 'Focus',
      elements: [
        {
          ...shape,
          id: 'engine-2',
          position: { x: 900, y: 100 },
          content: { shape: 'rectangle', cornerRadius: 0 },
        },
      ],
    });
    const result = buildTransition({ id: 'transition-replace', from, to: moved });
    if (!result.ok) {
      throw new Error('Expected a transition');
    }
    expect(result.value.transition.elementTransitions.map((item) => item.operation)).toEqual([
      'replace',
      'move',
    ]);
    expect(
      validateTransition(
        result.value.transition,
        buildPresentation({ komas: [from, moved], transitions: [result.value.transition] }),
      ),
    ).toEqual([]);
  });
});
