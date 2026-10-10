import { describe, expect, it } from 'vitest';
import {
  checkGroupable,
  derivePersistentGroupId,
  groupElements,
  sortBackToFront,
  ungroupElement,
} from './grouping';
import { createSeededIdGenerator } from './ids';
import type { GroupElement, KomaElement, LeafElement } from './schema/element';
import { komaSchema, type Koma } from './schema/koma';
import { buildKoma, buildShape, buildText } from './testing/fixtures';

const ids = (): ReturnType<typeof createSeededIdGenerator> => createSeededIdGenerator('grouping');

function unwrap<T>(result: { ok: true; value: T } | { ok: false; error: { message: string } }): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

const square = buildShape({
  id: 'el-square',
  persistentId: 'square',
  position: { x: 100, y: 100 },
  size: { width: 200, height: 200 },
  zIndex: 1,
});
const title = buildText({
  id: 'el-title',
  persistentId: 'title',
  position: { x: 400, y: 150 },
  size: { width: 600, height: 100 },
  zIndex: 2,
});
const backdrop = buildShape({
  id: 'el-backdrop',
  persistentId: 'backdrop',
  position: { x: 0, y: 0 },
  size: { width: 1920, height: 1080 },
  zIndex: 0,
});
const koma = buildKoma({ id: 'koma-a', elements: [backdrop, square, title] });

/** Where a group draws a child, computed independently of the implementation. */
function drawnChild(group: GroupElement, child: LeafElement): { x: number; y: number } {
  const sx = group.size.width / group.content.referenceSize.width;
  const sy = group.size.height / group.content.referenceSize.height;
  const angle = (group.rotation * Math.PI) / 180;
  const pivotX = group.position.x + group.size.width / 2;
  const pivotY = group.position.y + group.size.height / 2;
  const dx = group.position.x + (child.position.x + child.size.width / 2) * sx - pivotX;
  const dy = group.position.y + (child.position.y + child.size.height / 2) * sy - pivotY;
  return {
    x: pivotX + dx * Math.cos(angle) - dy * Math.sin(angle),
    y: pivotY + dx * Math.sin(angle) + dy * Math.cos(angle),
  };
}

function centre(element: KomaElement): { x: number; y: number } {
  return {
    x: element.position.x + element.size.width / 2,
    y: element.position.y + element.size.height / 2,
  };
}

describe('groupElements', () => {
  it('keeps children where they are drawn, with their identities and order', () => {
    const before = JSON.stringify(koma);
    const { koma: grouped, group } = unwrap(groupElements(koma, [title.id, square.id], ids()));
    expect(JSON.stringify(koma)).toBe(before);
    expect(komaSchema.safeParse(grouped).success).toBe(true);
    expect(group.position).toEqual({ x: 100, y: 100 });
    expect(group.size).toEqual({ width: 900, height: 200 });
    expect(group.content.referenceSize).toEqual(group.size);
    expect(group.rotation).toBe(0);
    expect(group.opacity).toBe(1);
    expect(group.name).toBe('Group');
    expect(group.content.children.map((child) => [child.id, child.persistentId])).toEqual([
      [square.id, square.persistentId],
      [title.id, title.persistentId],
    ]);
    expect(group.content.children.map((child) => child.position)).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 50 },
    ]);
    for (const child of group.content.children) {
      const original = child.id === square.id ? square : title;
      expect(drawnChild(group, child)).toEqual(centre(original));
      expect({ ...child, position: original.position }).toEqual(original);
    }
    // The group takes the frontmost child's stacking place.
    expect(grouped.elements.map((element) => element.id)).toEqual([backdrop.id, group.id]);
    expect(group.zIndex).toBe(title.zIndex);
  });

  it('derives the group identity from its objects so other Komas can match it', () => {
    const otherKoma = buildKoma({
      id: 'koma-b',
      elements: [
        { ...title, id: 'el-title-b', position: { x: 10, y: 10 } },
        { ...square, id: 'el-square-b' },
      ],
    });
    const first = unwrap(groupElements(koma, [square.id, title.id], ids())).group;
    const second = unwrap(
      groupElements(otherKoma, ['el-title-b', 'el-square-b'], createSeededIdGenerator('other')),
    ).group;
    expect(second.persistentId).toBe(first.persistentId);
    expect(second.id).not.toBe(first.id);
    expect(first.persistentId).toBe(derivePersistentGroupId(['title', 'square']));
    expect(derivePersistentGroupId(['a', 'b'])).not.toBe(derivePersistentGroupId(['a', 'c']));
  });

  it('avoids a persistent identity that another object of the Koma already uses', () => {
    const taken = derivePersistentGroupId([square.persistentId, title.persistentId]);
    const crowded = { ...koma, elements: [{ ...backdrop, persistentId: taken }, square, title] };
    const { group } = unwrap(groupElements(crowded, [square.id, title.id], ids()));
    expect(group.persistentId).toBe(`${taken}-2`);
  });

  it('bounds rotated elements by what is drawn and restores them exactly', () => {
    const bar = buildShape({
      id: 'el-bar',
      persistentId: 'bar',
      position: { x: 500, y: 500 },
      size: { width: 200, height: 10 },
      rotation: 90,
      zIndex: 3,
    });
    const input = { ...koma, elements: [square, bar] };
    const { koma: grouped, group } = unwrap(groupElements(input, [square.id, bar.id], ids()));
    // The bar is drawn as 10 x 200 around its centre (600, 505).
    expect(group.position).toEqual({ x: 100, y: 100 });
    expect(group.size).toEqual({ width: 505, height: 505 });
    const restored = unwrap(ungroupElement(grouped, group.id)).koma;
    expect(restored.elements).toEqual(input.elements);
  });

  it('places elements that were between grouped ones behind the group', () => {
    const between = buildShape({
      id: 'el-between',
      persistentId: 'between',
      zIndex: 2,
      position: { x: 150, y: 150 },
    });
    const front = { ...title, zIndex: 3 };
    const input = { ...koma, elements: [square, front, between] };
    const { koma: grouped, group } = unwrap(groupElements(input, [square.id, front.id], ids()));
    expect(sortBackToFront(grouped.elements).map((element) => element.id)).toEqual([
      between.id,
      group.id,
    ]);
    // Ungrouping keeps that grouped order: children take the group's layer.
    const { koma: ungrouped, children } = unwrap(ungroupElement(grouped, group.id));
    expect(children.map((child) => [child.id, child.zIndex])).toEqual([
      [square.id, 3],
      [front.id, 3],
    ]);
    expect(sortBackToFront(ungrouped.elements).map((element) => element.id)).toEqual([
      between.id,
      square.id,
      front.id,
    ]);
  });

  it('round-trips with ungroup to the same elements', () => {
    const { koma: grouped, group } = unwrap(groupElements(koma, [square.id, title.id], ids()));
    const { koma: restored, children } = unwrap(ungroupElement(grouped, group.id));
    expect(restored.elements).toEqual(koma.elements);
    expect(children.map((child) => child.id)).toEqual([square.id, title.id]);
  });

  it('explains why a selection cannot be grouped', () => {
    expect(checkGroupable(koma, [square.id])?.code).toBe('tooFewElements');
    expect(checkGroupable(koma, [square.id, square.id])?.code).toBe('tooFewElements');
    expect(checkGroupable(koma, [square.id, 'missing'])?.code).toBe('missingElement');
    const locked = { ...koma, elements: [{ ...square, locked: true }, title] };
    expect(checkGroupable(locked, [square.id, title.id])?.code).toBe('locked');
    const { koma: grouped, group } = unwrap(groupElements(koma, [square.id, title.id], ids()));
    expect(checkGroupable(grouped, [group.id, backdrop.id])?.code).toBe('containsGroup');
    expect(checkGroupable(koma, [square.id, title.id])).toBeNull();
    const result = groupElements(koma, [square.id], ids());
    expect(result.ok).toBe(false);
    const many = buildKoma({
      elements: Array.from({ length: 201 }, (_, index) =>
        buildShape({ id: `el-${String(index)}`, persistentId: `object-${String(index)}` }),
      ),
    });
    expect(
      checkGroupable(
        many,
        many.elements.map((element) => element.id),
      )?.code,
    ).toBe('tooManyElements');
  });
});

describe('ungroupElement', () => {
  const child = buildShape({
    id: 'el-child',
    persistentId: 'child',
    position: { x: 50, y: 0 },
    size: { width: 100, height: 50 },
    rotation: 10,
    opacity: 0.5,
    zIndex: 4,
    content: { shape: 'roundedRectangle', cornerRadius: 8 },
    style: { fill: '#FF5A36', stroke: '#2B3A55', strokeWidth: 2 },
  });
  const label = buildText({
    id: 'el-label',
    persistentId: 'label',
    position: { x: 0, y: 60 },
    size: { width: 200, height: 40 },
    zIndex: 5,
  });
  const scaled: GroupElement = {
    id: 'el-group',
    persistentId: 'group',
    name: 'Badge',
    type: 'group',
    position: { x: 300, y: 200 },
    size: { width: 400, height: 200 },
    rotation: 30,
    opacity: 0.8,
    zIndex: 7,
    locked: false,
    visible: true,
    content: { referenceSize: { width: 200, height: 100 }, children: [label, child] },
    style: {},
  };
  const withGroup: Koma = buildKoma({ id: 'koma-g', elements: [backdrop, scaled] });

  it('converts children to canvas coordinates with the group scale, rotation and opacity', () => {
    const { koma: next, children } = unwrap(ungroupElement(withGroup, scaled.id));
    expect(komaSchema.safeParse(next).success).toBe(true);
    expect(next.elements.map((element) => element.id)).toEqual([backdrop.id, child.id, label.id]);
    const [shape, text] = children;
    if (shape?.type !== 'shape' || text?.type !== 'text') throw new Error('Unexpected children');
    expect(centre(shape).x).toBeCloseTo(drawnChild(scaled, child).x, 5);
    expect(centre(shape).y).toBeCloseTo(drawnChild(scaled, child).y, 5);
    expect(centre(text).x).toBeCloseTo(drawnChild(scaled, label).x, 5);
    expect(centre(text).y).toBeCloseTo(drawnChild(scaled, label).y, 5);
    expect(shape.size).toEqual({ width: 200, height: 100 });
    expect(shape.rotation).toBe(40);
    expect(shape.opacity).toBeCloseTo(0.4, 6);
    expect(shape.content.cornerRadius).toBe(16);
    expect(shape.style.strokeWidth).toBe(4);
    expect(text.style.fontSize).toBe(label.style.fontSize * 2);
    expect(text.rotation).toBe(30);
    // Identities are kept, so motion to other Komas still finds these objects.
    expect([shape.persistentId, text.persistentId]).toEqual(['child', 'label']);
    // Their own layers (4, 5) keep the grouped drawing order.
    expect([shape.zIndex, text.zIndex]).toEqual([4, 5]);
  });

  it('hides children of a hidden group and refuses locked groups and other elements', () => {
    const hidden = { ...withGroup, elements: [backdrop, { ...scaled, visible: false }] };
    const { children } = unwrap(ungroupElement(hidden, scaled.id));
    expect(children.every((item) => !item.visible)).toBe(true);
    const locked = { ...withGroup, elements: [backdrop, { ...scaled, locked: true }] };
    expect(ungroupElement(locked, scaled.id)).toMatchObject({
      ok: false,
      error: { code: 'locked' },
    });
    expect(ungroupElement(withGroup, backdrop.id)).toMatchObject({
      ok: false,
      error: { code: 'notAGroup' },
    });
    expect(ungroupElement(withGroup, 'missing')).toMatchObject({
      ok: false,
      error: { code: 'missingElement' },
    });
  });
});
