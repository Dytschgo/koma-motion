import { buildShape } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import { containsPointer, moveElement, pointerToLogical, resizeElement } from './layout';

describe('canvas editing geometry', () => {
  it.each([0.2, 0.5, 1, 2])(
    'maps viewport coordinates at scale %s including scroll offsets',
    (scale) => {
      const canvas = { width: 1920, height: 1080 };
      const rect = {
        left: -120,
        top: 80,
        width: canvas.width * scale,
        height: canvas.height * scale,
      };
      expect(
        pointerToLogical({ x: -120 + 640 * scale, y: 80 + 360 * scale }, rect, canvas),
      ).toEqual({ x: 640, y: 360 });
      expect(containsPointer({ x: rect.left - 1, y: 100 }, rect)).toBe(false);
    },
  );

  it('moves without changing identity, size or rotation and clamps model limits', () => {
    const shape = buildShape({ position: { x: 19999, y: 10 }, rotation: 30 });
    const moved = moveElement(shape, { x: 10, y: -5 });
    expect(moved).toEqual({ ...shape, position: { x: 20000, y: 5 } });
    expect(shape.position.x).toBe(19999);
  });

  it('resizes the northwest corner around its fixed opposite corner with a minimum size', () => {
    const shape = buildShape({ position: { x: 100, y: 100 }, size: { width: 200, height: 100 } });
    const result = resizeElement(shape, { x: 1000, y: 1000 }, 'nw');
    expect(result.size).toEqual({ width: 24, height: 24 });
    expect(result.position).toEqual({ x: 276, y: 176 });
  });

  it('resizes along rotated axes while anchoring the opposite corner', () => {
    const shape = buildShape({
      position: { x: 100, y: 100 },
      size: { width: 200, height: 100 },
      rotation: 90,
    });
    const result = resizeElement(shape, { x: -20, y: 40 }, 'se');
    expect(result.size).toEqual({ width: 240, height: 120 });
    expect(result.position.x).toBeCloseTo(70);
    expect(result.position.y).toBeCloseTo(110);
  });
});
