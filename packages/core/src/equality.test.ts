import { describe, expect, it } from 'vitest';
import { isStructurallyEqual } from './equality';
import { buildKoma, buildShape, buildText } from './testing/fixtures';

describe('isStructurallyEqual', () => {
  it('ignores the order of keys, at every depth', () => {
    const one = { id: 'a', position: { x: 1, y: 2 }, style: { fill: '#FFFFFF', stroke: null } };
    const other = { style: { stroke: null, fill: '#FFFFFF' }, position: { y: 2, x: 1 }, id: 'a' };
    expect(JSON.stringify(one)).not.toBe(JSON.stringify(other));
    expect(isStructurallyEqual(one, other)).toBe(true);
    expect(isStructurallyEqual(other, one)).toBe(true);
  });

  it('keeps the order of array items', () => {
    expect(isStructurallyEqual([1, 2, 3], [1, 2, 3])).toBe(true);
    expect(isStructurallyEqual([1, 2, 3], [3, 2, 1])).toBe(false);
    expect(isStructurallyEqual([1, 2], [1, 2, 3])).toBe(false);
    expect(isStructurallyEqual([1, 2, 3], [1, 2])).toBe(false);
    expect(isStructurallyEqual([], [])).toBe(true);
  });

  it('compares nested values', () => {
    const koma = buildKoma({ elements: [buildShape(), buildText()] });
    const copy = buildKoma({ elements: [buildShape(), buildText()] });
    expect(isStructurallyEqual(koma, copy)).toBe(true);
    expect(
      isStructurallyEqual(
        koma,
        buildKoma({ elements: [buildShape({ position: { x: 100, y: 101 } }), buildText()] }),
      ),
    ).toBe(false);
    expect(isStructurallyEqual({ a: [{ b: 1 }] }, { a: [{ b: 1 }] })).toBe(true);
    expect(isStructurallyEqual({ a: [{ b: 1 }] }, { a: [{ b: 2 }] })).toBe(false);
  });

  it('treats a property that is undefined as a missing property', () => {
    expect(isStructurallyEqual({ a: 1, b: undefined }, { a: 1 })).toBe(true);
    expect(isStructurallyEqual({ a: 1 }, { a: 1, b: undefined })).toBe(true);
    expect(isStructurallyEqual({ a: 1, b: undefined }, { a: 1, c: undefined })).toBe(true);
    expect(isStructurallyEqual({ a: undefined }, {})).toBe(true);
  });

  it('reports a missing, an extra and a differently named property', () => {
    expect(isStructurallyEqual({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(isStructurallyEqual({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(isStructurallyEqual({ a: 1, b: undefined }, { a: 1, c: 2 })).toBe(false);
    expect(isStructurallyEqual({ a: 1 }, { b: 1 })).toBe(false);
    expect(isStructurallyEqual({ a: null }, {})).toBe(false);
    expect(isStructurallyEqual({ a: null }, { a: undefined })).toBe(false);
  });

  it('does not read inherited properties as content', () => {
    expect(isStructurallyEqual({ toString: undefined }, {})).toBe(true);
    expect(isStructurallyEqual({ constructor: Object }, {})).toBe(false);
    expect(isStructurallyEqual(JSON.parse('{"__proto__":{"a":1}}'), {})).toBe(false);
    expect(isStructurallyEqual(Object.create(null), {})).toBe(true);
  });

  it('distinguishes types', () => {
    expect(isStructurallyEqual(1, '1')).toBe(false);
    expect(isStructurallyEqual(0, false)).toBe(false);
    expect(isStructurallyEqual(0, null)).toBe(false);
    expect(isStructurallyEqual('', null)).toBe(false);
    expect(isStructurallyEqual(null, undefined)).toBe(false);
    expect(isStructurallyEqual(null, {})).toBe(false);
    expect(isStructurallyEqual({}, null)).toBe(false);
    expect(isStructurallyEqual([], {})).toBe(false);
    expect(isStructurallyEqual({}, [])).toBe(false);
    expect(isStructurallyEqual({ 0: 'a', length: 1 }, ['a'])).toBe(false);
    expect(isStructurallyEqual(undefined, {})).toBe(false);
  });

  it('compares primitives', () => {
    expect(isStructurallyEqual('a', 'a')).toBe(true);
    expect(isStructurallyEqual('a', 'b')).toBe(false);
    expect(isStructurallyEqual(true, true)).toBe(true);
    expect(isStructurallyEqual(true, false)).toBe(false);
    expect(isStructurallyEqual(null, null)).toBe(true);
    expect(isStructurallyEqual(undefined, undefined)).toBe(true);
    expect(isStructurallyEqual(0.1 + 0.2, 0.3)).toBe(false);
  });

  it('keeps 0 equal to -0 and NaN equal to NaN, and is stricter than JSON elsewhere', () => {
    expect(isStructurallyEqual({ x: 0 }, { x: -0 })).toBe(true);
    expect(isStructurallyEqual({ x: Number.NaN }, { x: Number.NaN })).toBe(true);
    // JSON writes all of these as null.
    expect(isStructurallyEqual(Number.NaN, null)).toBe(false);
    expect(isStructurallyEqual(Number.POSITIVE_INFINITY, Number.NaN)).toBe(false);
    expect(isStructurallyEqual([undefined], [null])).toBe(false);
  });

  it('accepts the same reference without reading it', () => {
    const unread: Record<string, unknown> = {};
    Object.defineProperty(unread, 'data', {
      enumerable: true,
      get: () => {
        throw new Error('The value was read.');
      },
    });
    expect(isStructurallyEqual(unread, unread)).toBe(true);
    expect(isStructurallyEqual({ asset: unread }, { asset: unread })).toBe(true);
    expect(isStructurallyEqual([unread], [unread])).toBe(true);
    expect(() => isStructurallyEqual(unread, { data: 1 })).toThrow('The value was read.');
  });

  it('compares objects that are not plain by reference only', () => {
    const date = new Date(0);
    expect(isStructurallyEqual(date, date)).toBe(true);
    expect(isStructurallyEqual(new Date(0), new Date(0))).toBe(false);
    expect(isStructurallyEqual(new Map(), new Map())).toBe(false);
    expect(isStructurallyEqual(new Map(), {})).toBe(false);
  });
});
