import { buildShape, buildText } from '@koma-motion/core/testing';
import type { KomaElement } from '@koma-motion/core';
import { describe, expect, it } from 'vitest';
import {
  describeElementKind,
  filterLayers,
  getCanvasPlacement,
  getLayerName,
  orderLayers,
  restackElements,
} from './layers';

const canvas = { width: 1920, height: 1080 };

function shape(id: string, zIndex: number): KomaElement {
  return buildShape({ id, persistentId: id, name: id, zIndex });
}

const ids = (elements: readonly KomaElement[]): string[] => elements.map((element) => element.id);

describe('layer order', () => {
  it('lists the frontmost element first, like the canvas draws them', () => {
    // Equal numbers are drawn in document order: the later element is in front.
    const elements = [shape('a', 1), shape('b', 5), shape('c', 1), shape('d', -2)];
    expect(ids(orderLayers(elements))).toEqual(['b', 'c', 'a', 'd']);
  });

  it('swaps distinct layer numbers and keeps untouched elements', () => {
    const elements = [shape('a', 1), shape('b', 5), shape('c', 9)];
    const next = restackElements(elements, 'a', 'forward');
    expect(ids(orderLayers(next))).toEqual(['c', 'a', 'b']);
    expect(next.map((element) => element.zIndex)).toEqual([5, 1, 9]);
    expect(next[2]).toBe(elements[2]);
  });

  it('moves to the front and to the back', () => {
    const elements = [shape('a', 1), shape('b', 2), shape('c', 3), shape('d', 4)];
    expect(ids(orderLayers(restackElements(elements, 'b', 'front')))).toEqual(['b', 'd', 'c', 'a']);
    expect(ids(orderLayers(restackElements(elements, 'c', 'back')))).toEqual(['d', 'b', 'a', 'c']);
  });

  it('renumbers equal layer numbers so that one step moves past one element', () => {
    // Document order C, A, B with A and B sharing a number.
    const elements = [shape('c', 1), shape('a', 0), shape('b', 0)];
    expect(ids(orderLayers(elements))).toEqual(['c', 'b', 'a']);
    const next = restackElements(elements, 'a', 'forward');
    expect(ids(orderLayers(next))).toEqual(['c', 'a', 'b']);
    expect(ids(next)).toEqual(['c', 'a', 'b']);
  });

  it('keeps renumbered layers within the allowed range', () => {
    const elements = [shape('a', 10000), shape('b', 10000), shape('c', 10000)];
    const next = restackElements(elements, 'a', 'front');
    expect(Math.max(...next.map((element) => element.zIndex))).toBeLessThanOrEqual(10000);
    expect(ids(orderLayers(next))[0]).toBe('a');
  });

  it('returns the same elements when nothing moves', () => {
    const elements = [shape('a', 1), shape('b', 2)];
    expect(restackElements(elements, 'b', 'forward')).toBe(elements);
    expect(restackElements(elements, 'a', 'backward')).toBe(elements);
    expect(restackElements(elements, 'missing', 'front')).toBe(elements);
  });
});

describe('layer descriptions', () => {
  it('reports elements that leave the canvas', () => {
    expect(getCanvasPlacement(buildShape(), canvas)).toBe('inside');
    expect(getCanvasPlacement(buildShape({ position: { x: -50, y: 10 } }), canvas)).toBe('partly');
    expect(getCanvasPlacement(buildShape({ position: { x: 1800, y: 10 } }), canvas)).toBe('partly');
    expect(getCanvasPlacement(buildShape({ position: { x: 2000, y: 10 } }), canvas)).toBe(
      'outside',
    );
    expect(getCanvasPlacement(buildShape({ position: { x: 10, y: -300 } }), canvas)).toBe(
      'outside',
    );
  });

  it('names unnamed elements after their content', () => {
    expect(getLayerName(buildShape({ name: '  Logo ' }))).toBe('Logo');
    expect(getLayerName(buildText({ name: '', content: { text: 'Hello\n  world' } }))).toBe(
      'Hello world',
    );
    expect(getLayerName(buildText({ name: '', content: { text: 'x'.repeat(60) } }))).toHaveLength(
      41,
    );
    expect(getLayerName(buildShape({ name: '' }))).toBe('Untitled circle');
    expect(describeElementKind(buildShape())).toBe('Circle');
  });

  it('filters by name, kind and text, ignoring case', () => {
    const elements = [
      buildShape({ id: 'a', name: 'Engine' }),
      buildText({ id: 'b', name: 'Headline', content: { text: 'Motion matters' } }),
      buildShape({ id: 'c', name: 'Frame', content: { shape: 'rectangle', cornerRadius: 0 } }),
    ];
    expect(ids(filterLayers(elements, 'engine'))).toEqual(['a']);
    expect(ids(filterLayers(elements, 'MATTERS'))).toEqual(['b']);
    expect(ids(filterLayers(elements, 'rectangle'))).toEqual(['c']);
    expect(filterLayers(elements, '  ')).toBe(elements);
  });
});
