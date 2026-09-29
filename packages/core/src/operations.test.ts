import { describe, expect, it } from 'vitest';
import { createRandomIdGenerator, createSeededIdGenerator, hashString, idSchema } from './ids';
import { duplicateKoma, insertKoma, moveKoma, removeKoma, replaceElement } from './operations';
import { presentationSchema } from './schema/presentation';
import { buildKoma, buildPresentation, buildShape } from './testing/fixtures';

describe('id generators', () => {
  it('creates valid random identifiers that differ', () => {
    const generator = createRandomIdGenerator();
    const first = generator.next('koma');
    const second = generator.next('koma');
    expect(first).not.toBe(second);
    expect(idSchema.safeParse(first).success).toBe(true);
  });

  it('creates the same identifiers for the same seed', () => {
    const a = createSeededIdGenerator('seed');
    const b = createSeededIdGenerator('seed');
    expect([a.next('koma', 'intro'), a.next('element'), a.next('element')]).toEqual([
      b.next('koma', 'intro'),
      b.next('element'),
      b.next('element'),
    ]);
  });

  it('creates different identifiers for different seeds and repeated keys', () => {
    const a = createSeededIdGenerator('seed-a');
    const b = createSeededIdGenerator('seed-b');
    expect(a.next('koma', 'intro')).not.toBe(b.next('koma', 'intro'));
    expect(a.next('koma', 'intro')).not.toBe(a.next('koma', 'intro'));
  });

  it('hashes to sixteen hex characters', () => {
    expect(hashString('koma')).toMatch(/^[0-9a-f]{16}$/);
    expect(hashString('koma')).toBe(hashString('koma'));
    expect(hashString('koma')).not.toBe(hashString('komb'));
  });
});

describe('document operations', () => {
  it('duplicates a Koma with new ids and the same persistent ids', () => {
    const source = buildKoma();
    const copy = duplicateKoma(source, createSeededIdGenerator('copy'), 'Next state');
    expect(copy.id).not.toBe(source.id);
    expect(copy.elements.map((element) => element.persistentId)).toEqual(
      source.elements.map((element) => element.persistentId),
    );
    for (const [index, element] of copy.elements.entries()) {
      expect(element.id).not.toBe(source.elements[index]?.id);
    }
  });

  it('inserts a Koma after the given Koma', () => {
    const presentation = buildPresentation({
      komas: [buildKoma({ id: 'a' }), buildKoma({ id: 'c' })],
    });
    const result = insertKoma(presentation, buildKoma({ id: 'b' }), 'a');
    expect(result.komas.map((koma) => koma.id)).toEqual(['a', 'b', 'c']);
    expect(presentationSchema.safeParse(result).success).toBe(true);
  });

  it('removes a Koma together with its transitions', () => {
    const presentation = buildPresentation({
      komas: [buildKoma({ id: 'a' }), buildKoma({ id: 'b' })],
      transitions: [
        {
          id: 't',
          fromKomaId: 'a',
          toKomaId: 'b',
          strategy: 'continuous',
          duration: 900,
          easing: 'linear',
          elementTransitions: [],
          rationale: '',
        },
      ],
    });
    const result = removeKoma(presentation, 'b');
    expect(result.komas.map((koma) => koma.id)).toEqual(['a']);
    expect(result.transitions).toEqual([]);
  });

  it('moves a Koma and clamps at the ends', () => {
    const presentation = buildPresentation({
      komas: [buildKoma({ id: 'a' }), buildKoma({ id: 'b' }), buildKoma({ id: 'c' })],
    });
    expect(moveKoma(presentation, 'c', -1).komas.map((koma) => koma.id)).toEqual(['a', 'c', 'b']);
    expect(moveKoma(presentation, 'a', -1)).toBe(presentation);
    expect(moveKoma(presentation, 'a', 5).komas.map((koma) => koma.id)).toEqual(['b', 'c', 'a']);
  });

  it('replaces an element without touching the original document', () => {
    const presentation = buildPresentation();
    const moved = buildShape({ position: { x: 500, y: 500 } });
    const result = replaceElement(presentation, 'koma-1', moved);
    expect(result.komas[0]?.elements[0]?.position).toEqual({ x: 500, y: 500 });
    expect(presentation.komas[0]?.elements[0]?.position).toEqual({ x: 100, y: 100 });
  });
});
