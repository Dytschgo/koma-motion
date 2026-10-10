import {
  createSeededIdGenerator,
  groupElements,
  ungroupElement,
  type Koma,
} from '@koma-motion/core';
import { buildKoma, buildShape, buildText } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { diffKomas } from './diff';

const square = buildShape({ id: 'el-square', persistentId: 'square', zIndex: 1 });
const title = buildText({ id: 'el-title', persistentId: 'title', zIndex: 2 });

function group(koma: Koma, seed: string): Koma {
  const result = groupElements(
    koma,
    koma.elements.map((element) => element.id),
    createSeededIdGenerator(seed),
  );
  if (!result.ok) throw new Error(result.error.message);
  return result.value.koma;
}

function operations(from: Koma, to: Koma): string[] {
  const result = diffKomas(from, to);
  if (!result.ok) throw new Error(result.error.map((issue) => issue.message).join('\n'));
  return result.value.elementTransitions.map(
    (transition) => `${transition.persistentId}:${transition.operation}`,
  );
}

describe('motion identity of groups created in the interface', () => {
  const first = buildKoma({ id: 'koma-1', elements: [square, title] });
  const second = buildKoma({
    id: 'koma-2',
    elements: [
      { ...square, id: 'el-square-2', position: { x: 300, y: 100 } },
      { ...title, id: 'el-title-2', position: { x: 300, y: 400 } },
    ],
  });

  it('cross-fades objects grouped on only one of two Komas', () => {
    const grouped = group(second, 'second');
    const groupId = grouped.elements[0]?.persistentId ?? '';
    expect(operations(first, grouped).sort()).toEqual(
      [`${groupId}:fadeIn`, 'square:fadeOut', 'title:fadeOut'].sort(),
    );
  });

  it('moves the same objects grouped on both Komas as one retained group', () => {
    const from = group(first, 'first');
    const to = group(second, 'second');
    const groupId = from.elements[0]?.persistentId ?? '';
    expect(to.elements[0]?.persistentId).toBe(groupId);
    expect(operations(from, to)).toEqual([`${groupId}:move`]);
  });

  it('restores the motion of the objects after ungrouping', () => {
    const grouped = group(second, 'second');
    const groupElement = grouped.elements[0];
    if (groupElement === undefined) throw new Error('Expected group');
    const ungrouped = ungroupElement(grouped, groupElement.id);
    if (!ungrouped.ok) throw new Error(ungrouped.error.message);
    expect(operations(first, ungrouped.value.koma)).toEqual(operations(first, second));
  });
});
