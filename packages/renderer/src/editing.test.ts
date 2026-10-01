import { komaElementSchema } from '@koma-motion/core';
import { buildShape } from '@koma-motion/core/testing';
import { describe, expect, it } from 'vitest';
import {
  containsPointer,
  moveElement,
  pointerToLogical,
  rotateElement,
  resizeElement,
  textEditorBox,
} from './layout';

describe('canvas editing geometry', () => {
  it.each([0.1, 0.5, 1, 4])(
    'keeps rotated and off-stage editors inside the stage at scale %s',
    (scale) => {
      const canvas = { width: 1920, height: 1080 };
      for (const rotation of [0, 45, 90, 175]) {
        for (const position of [
          { x: -500, y: -500 },
          { x: 1900, y: 1000 },
        ]) {
          const element = buildShape({ position, rotation, size: { width: 2500, height: 1200 } });
          const box = textEditorBox(element, canvas, scale);
          const angle = (rotation * Math.PI) / 180;
          const halfWidth =
            (box.width * Math.abs(Math.cos(angle)) + box.height * Math.abs(Math.sin(angle))) / 2;
          const halfHeight =
            (box.width * Math.abs(Math.sin(angle)) + box.height * Math.abs(Math.cos(angle))) / 2;
          expect(box.left + box.width / 2 - halfWidth).toBeGreaterThanOrEqual(-0.001);
          expect(box.top + box.height / 2 - halfHeight).toBeGreaterThanOrEqual(-0.001);
          expect(box.left + box.width / 2 + halfWidth).toBeLessThanOrEqual(
            canvas.width * scale + 0.001,
          );
          expect(box.top + box.height / 2 + halfHeight).toBeLessThanOrEqual(
            canvas.height * scale + 0.001,
          );
        }
      }
    },
  );

  it('preserves the text box when it already fits', () => {
    expect(textEditorBox(buildShape(), { width: 1920, height: 1080 }, 0.5)).toEqual({
      left: 50,
      top: 50,
      width: 100,
      height: 100,
    });
  });
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

  it('rotates clockwise around the element centre and takes the shortest direction', () => {
    const shape = buildShape({
      position: { x: 100, y: 100 },
      size: { width: 200, height: 100 },
      rotation: 15,
    });
    expect(rotateElement(shape, { x: 200, y: 100 }, { x: 250, y: 150 }).rotation).toBeCloseTo(105);
    expect(rotateElement(shape, { x: 150, y: 151 }, { x: 150, y: 149 }).rotation).toBeCloseTo(
      17.29,
      1,
    );
    expect(shape.rotation).toBe(15);
  });

  it.each([3600, -3600])('keeps rotation within the document limit at %s degrees', (rotation) => {
    const shape = buildShape({
      position: { x: 100, y: 100 },
      size: { width: 200, height: 100 },
      rotation,
    });
    const result = rotateElement(
      shape,
      { x: 200, y: 100 },
      { x: rotation > 0 ? 250 : 150, y: 150 },
    );
    expect(result.rotation).toBe(rotation);
    expect(komaElementSchema.safeParse(result).success).toBe(true);
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
