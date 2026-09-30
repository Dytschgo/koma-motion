import { buildKoma, buildShape } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { fingerprintKoma } from './fingerprint';
import { getMotionIssueRemedy } from './issues';
import { buildTransition } from './transition';
import { findOutdatedObjects } from './validate';

describe('fingerprintKoma', () => {
  it('gives equal content the same fingerprint, whatever the key order', () => {
    const koma = buildKoma({ elements: [buildShape()] });
    const reordered = Object.fromEntries(Object.entries(koma).reverse()) as typeof koma;
    expect(reordered).not.toBe(koma);
    expect(fingerprintKoma(reordered)).toBe(fingerprintKoma(koma));
    expect(fingerprintKoma({ ...koma })).toBe(fingerprintKoma(koma));
  });

  it('changes with any edit of the Koma', () => {
    const shape = buildShape();
    const koma = buildKoma({ elements: [shape] });
    const moved = { ...koma, elements: [{ ...shape, position: { x: 1, y: 2 } }] };
    const renamed = { ...koma, title: 'Another title' };
    expect(fingerprintKoma(moved)).not.toBe(fingerprintKoma(koma));
    expect(fingerprintKoma(renamed)).not.toBe(fingerprintKoma(koma));
  });
});

describe('findOutdatedObjects', () => {
  it('names only the objects whose stored motion no longer matches', () => {
    const still = buildShape({ id: 'still-1', persistentId: 'still', position: { x: 0, y: 0 } });
    const mover = buildShape({ id: 'mover-1', persistentId: 'mover', position: { x: 0, y: 0 } });
    const from = buildKoma({ id: 'koma-1', elements: [still, mover] });
    const to = buildKoma({
      id: 'koma-2',
      elements: [
        { ...still, id: 'still-2' },
        { ...mover, id: 'mover-2', position: { x: 100, y: 0 } },
      ],
    });
    const built = buildTransition({ id: 'transition-1', from, to });
    if (!built.ok) throw new Error('Expected a transition');
    expect(findOutdatedObjects(built.value.transition, from, to)).toEqual([]);

    const edited = {
      ...to,
      elements: [
        { ...still, id: 'still-2' },
        { ...mover, id: 'mover-2', position: { x: 300, y: 0 } },
      ],
    };
    expect(findOutdatedObjects(built.value.transition, from, edited)).toEqual(['mover']);
  });
});

describe('getMotionIssueRemedy', () => {
  it('offers regeneration only where rebuilding from the Komas helps', () => {
    expect(getMotionIssueRemedy('staleTransition')).toBe('regenerate');
    expect(getMotionIssueRemedy('invalidElementReference')).toBe('regenerate');
    expect(getMotionIssueRemedy('conflictingOperations')).toBe('regenerate');
    expect(getMotionIssueRemedy('duplicatePersistentId')).toBe('editKoma');
    expect(getMotionIssueRemedy('invalidKoma')).toBe('editKoma');
    expect(getMotionIssueRemedy('unsupportedOperation')).toBe('futureVersion');
    expect(getMotionIssueRemedy('nonAdjacentKomas')).toBe('none');
  });
});
