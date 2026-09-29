import type { ElementTransition, Koma } from '@koma-motion/core';
import { buildKoma, buildShape, buildText } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { diffKomas, type KomaDiff } from './diff';

function diff(from: Koma, to: Koma): KomaDiff {
  const result = diffKomas(from, to);
  if (!result.ok) {
    throw new Error(result.error.map((issue) => issue.message).join('\n'));
  }
  return result.value;
}

function operationsOf(result: KomaDiff, persistentId: string): string[] {
  return result.elementTransitions
    .filter((transition) => transition.persistentId === persistentId)
    .map((transition) => transition.operation);
}

function find(
  result: KomaDiff,
  persistentId: string,
  operation: ElementTransition['operation'],
): ElementTransition {
  const match = result.elementTransitions.find(
    (transition) => transition.persistentId === persistentId && transition.operation === operation,
  );
  if (match === undefined) {
    throw new Error(`No ${operation} operation for ${persistentId}`);
  }
  return match;
}

const engine = buildShape({ id: 'engine-1', persistentId: 'motion-engine' });

describe('persistent identity', () => {
  it('recognises a moved and scaled circle as the same object', () => {
    const from = buildKoma({
      id: 'koma-1',
      elements: [
        buildShape({
          id: 'engine-1',
          persistentId: 'motion-engine',
          position: { x: 1200, y: 300 },
          size: { width: 120, height: 120 },
        }),
      ],
    });
    const to = buildKoma({
      id: 'koma-2',
      elements: [
        buildShape({
          id: 'engine-2',
          persistentId: 'motion-engine',
          position: { x: 760, y: 340 },
          size: { width: 400, height: 400 },
        }),
      ],
    });

    const result = diff(from, to);

    expect(result.summary).toEqual({
      retained: ['motion-engine'],
      unchanged: [],
      entering: [],
      exiting: [],
    });
    expect(operationsOf(result, 'motion-engine')).toEqual(['move', 'scale']);
    expect(find(result, 'motion-engine', 'move')).toEqual({
      persistentId: 'motion-engine',
      operation: 'move',
      from: { elementId: 'engine-1', position: { x: 1200, y: 300 } },
      to: { elementId: 'engine-2', position: { x: 760, y: 340 } },
    });
    expect(find(result, 'motion-engine', 'scale').to).toEqual({
      elementId: 'engine-2',
      size: { width: 400, height: 400 },
    });
  });

  it('treats the same shape with another persistent id as an unrelated new object', () => {
    const from = buildKoma({ id: 'koma-1', elements: [engine] });
    const to = buildKoma({
      id: 'koma-2',
      elements: [{ ...engine, id: 'other-1', persistentId: 'something-else' }],
    });

    const result = diff(from, to);

    expect(result.summary.retained).toEqual([]);
    expect(result.summary.exiting).toEqual(['motion-engine']);
    expect(result.summary.entering).toEqual(['something-else']);
  });
});

describe('retained elements', () => {
  it('holds an unchanged element', () => {
    const from = buildKoma({ id: 'koma-1', elements: [engine] });
    const to = buildKoma({ id: 'koma-2', elements: [{ ...engine, id: 'engine-2' }] });

    const result = diff(from, to);

    expect(result.summary.unchanged).toEqual(['motion-engine']);
    expect(result.elementTransitions).toEqual([
      {
        persistentId: 'motion-engine',
        operation: 'hold',
        from: { elementId: 'engine-1' },
        to: { elementId: 'engine-2' },
      },
    ]);
  });

  it('detects movement', () => {
    const result = diff(
      buildKoma({ elements: [engine] }),
      buildKoma({ elements: [{ ...engine, position: { x: 100, y: 640 } }] }),
    );
    expect(operationsOf(result, 'motion-engine')).toEqual(['move']);
  });

  it('detects scaling', () => {
    const result = diff(
      buildKoma({ elements: [engine] }),
      buildKoma({ elements: [{ ...engine, size: { width: 200, height: 360 } }] }),
    );
    expect(operationsOf(result, 'motion-engine')).toEqual(['scale']);
  });

  it('detects rotation', () => {
    const result = diff(
      buildKoma({ elements: [engine] }),
      buildKoma({ elements: [{ ...engine, rotation: 45 }] }),
    );
    expect(find(result, 'motion-engine', 'rotate')).toMatchObject({
      from: { rotation: 0 },
      to: { rotation: 45 },
    });
  });

  it('detects opacity changes in both directions', () => {
    const dimmed = { ...engine, opacity: 0.3 };
    expect(
      operationsOf(
        diff(buildKoma({ elements: [engine] }), buildKoma({ elements: [dimmed] })),
        'motion-engine',
      ),
    ).toEqual(['fadeOut']);
    expect(
      operationsOf(
        diff(buildKoma({ elements: [dimmed] }), buildKoma({ elements: [engine] })),
        'motion-engine',
      ),
    ).toEqual(['fadeIn']);
  });

  it('detects colour changes of shapes and text', () => {
    const title = buildText({ persistentId: 'title' });
    const result = diff(
      buildKoma({ elements: [engine, title] }),
      buildKoma({
        elements: [
          { ...engine, style: { ...engine.style, fill: '#F2C14E' } },
          { ...title, style: { ...title.style, colour: '#FF5A36' } },
        ],
      }),
    );
    expect(find(result, 'motion-engine', 'colourChange')).toMatchObject({
      from: { colours: { fill: '#FF5A36', stroke: null } },
      to: { colours: { fill: '#F2C14E', stroke: null } },
    });
    expect(find(result, 'title', 'colourChange')).toMatchObject({
      from: { colours: { text: '#F2EFE9' } },
      to: { colours: { text: '#FF5A36' } },
    });
  });

  it('ignores differences below the tolerance', () => {
    const result = diff(
      buildKoma({ elements: [engine] }),
      buildKoma({ elements: [{ ...engine, position: { x: 100.0004, y: 100 } }] }),
    );
    expect(operationsOf(result, 'motion-engine')).toEqual(['hold']);
  });

  it('combines several changes of one object', () => {
    const result = diff(
      buildKoma({ elements: [engine] }),
      buildKoma({
        elements: [
          {
            ...engine,
            position: { x: 0, y: 0 },
            size: { width: 50, height: 50 },
            rotation: 90,
            opacity: 0.5,
            style: { ...engine.style, fill: '#2B3A55' },
          },
        ],
      }),
    );
    expect(operationsOf(result, 'motion-engine')).toEqual([
      'move',
      'scale',
      'rotate',
      'fadeOut',
      'colourChange',
    ]);
  });
});

describe('replacement', () => {
  it('replaces text whose content changes', () => {
    const title = buildText({ persistentId: 'title' });
    const result = diff(
      buildKoma({ elements: [title] }),
      buildKoma({ elements: [{ ...title, content: { text: 'Make them move.' } }] }),
    );
    expect(operationsOf(result, 'title')).toEqual(['replace']);
    expect(result.warnings).toEqual([]);
  });

  it('replaces a shape whose kind changes and keeps its movement', () => {
    const result = diff(
      buildKoma({ elements: [engine] }),
      buildKoma({
        elements: [
          {
            ...engine,
            position: { x: 900, y: 100 },
            content: { shape: 'rectangle', cornerRadius: 0 },
          },
        ],
      }),
    );
    expect(operationsOf(result, 'motion-engine')).toEqual(['replace', 'move']);
  });

  it('replaces an object whose type changes and warns about the ambiguity', () => {
    const label = buildText({ id: 'engine-2', persistentId: 'motion-engine' });
    const result = diff(buildKoma({ elements: [engine] }), buildKoma({ elements: [label] }));
    expect(operationsOf(result, 'motion-engine')).toContain('replace');
    expect(operationsOf(result, 'motion-engine')).not.toContain('colourChange');
    expect(result.warnings.map((warning) => warning.code)).toEqual(['ambiguousState']);
  });
});

describe('entering and exiting elements', () => {
  it('fades in an element that only exists in the target', () => {
    const caption = buildText({ id: 'caption-2', persistentId: 'caption', opacity: 0.8 });
    const result = diff(
      buildKoma({ elements: [engine] }),
      buildKoma({ elements: [engine, caption] }),
    );
    expect(result.summary.entering).toEqual(['caption']);
    expect(find(result, 'caption', 'fadeIn')).toEqual({
      persistentId: 'caption',
      operation: 'fadeIn',
      from: null,
      to: { elementId: 'caption-2', opacity: 0.8 },
    });
  });

  it('fades out an element that only exists in the source', () => {
    const caption = buildText({ id: 'caption-1', persistentId: 'caption' });
    const result = diff(
      buildKoma({ elements: [engine, caption] }),
      buildKoma({ elements: [engine] }),
    );
    expect(result.summary.exiting).toEqual(['caption']);
    expect(find(result, 'caption', 'fadeOut')).toEqual({
      persistentId: 'caption',
      operation: 'fadeOut',
      from: { elementId: 'caption-1', opacity: 1 },
      to: null,
    });
  });

  it('treats a hidden element as absent', () => {
    const result = diff(
      buildKoma({ elements: [engine] }),
      buildKoma({ elements: [{ ...engine, visible: false }] }),
    );
    expect(result.summary.exiting).toEqual(['motion-engine']);
  });
});

describe('invalid input', () => {
  it('rejects duplicate persistent ids in the source', () => {
    const result = diffKomas(
      buildKoma({ title: 'Broken', elements: [engine, { ...engine, id: 'engine-copy' }] }),
      buildKoma({ elements: [engine] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toHaveLength(1);
      expect(result.error[0]).toMatchObject({
        code: 'duplicatePersistentId',
        persistentId: 'motion-engine',
      });
      expect(result.error[0]?.message).toContain('source Koma "Broken"');
    }
  });

  it('rejects duplicate persistent ids in the target', () => {
    const result = diffKomas(
      buildKoma({ elements: [engine] }),
      buildKoma({ elements: [engine, { ...engine, id: 'engine-copy' }] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.message).toContain('target Koma');
    }
  });

  it('rejects a Koma with invalid elements', () => {
    const result = diffKomas(
      buildKoma({ elements: [{ ...engine, opacity: 4 }] }),
      buildKoma({ elements: [engine] }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error[0]?.code).toBe('invalidKoma');
      expect(result.error[0]?.message).toContain('elements[0].opacity');
    }
  });
});

describe('determinism', () => {
  it('produces the same operations in the same order, whatever the element order', () => {
    const a = buildShape({ id: 'a-1', persistentId: 'a' });
    const b = buildShape({ id: 'b-1', persistentId: 'b', position: { x: 0, y: 0 } });
    const c = buildText({ id: 'c-1', persistentId: 'c' });
    const movedB = { ...b, position: { x: 50, y: 50 } };

    const first = diff(buildKoma({ elements: [a, b, c] }), buildKoma({ elements: [a, movedB] }));
    const second = diff(buildKoma({ elements: [c, b, a] }), buildKoma({ elements: [movedB, a] }));

    expect(second).toEqual(first);
    expect(first.elementTransitions.map((transition) => transition.persistentId)).toEqual([
      'a',
      'b',
      'c',
    ]);
    expect(JSON.stringify(first)).toBe(
      JSON.stringify(
        diff(buildKoma({ elements: [a, b, c] }), buildKoma({ elements: [a, movedB] })),
      ),
    );
  });
});
