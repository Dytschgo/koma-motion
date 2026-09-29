import { z } from 'zod';

/**
 * Coordinate system
 *
 * Every Koma is laid out on a fixed logical canvas. The canvas is 1080 logical
 * units tall; its width follows the aspect ratio of the presentation. The
 * origin is the top-left corner, x grows to the right and y grows downwards.
 *
 * The `position` of an element is the top-left corner of its unrotated
 * bounding box. `rotation` is measured in degrees, clockwise, around the
 * centre of that box. Font sizes and stroke widths use the same logical units.
 *
 * See docs/MOTION_MODEL.md for the reasoning behind this decision.
 */
export const ASPECT_RATIOS = ['16:9', '4:3'] as const;
export const aspectRatioSchema = z.enum(ASPECT_RATIOS);
export type AspectRatio = z.infer<typeof aspectRatioSchema>;

export const CANVAS_HEIGHT = 1080;

export const CANVAS_SIZES: Readonly<Record<AspectRatio, Size>> = {
  '16:9': { width: 1920, height: CANVAS_HEIGHT },
  '4:3': { width: 1440, height: CANVAS_HEIGHT },
};

/** Elements may sit partly or fully outside the canvas, within this bound. */
export const COORDINATE_LIMIT = 20000;

const coordinateSchema = z.number().min(-COORDINATE_LIMIT).max(COORDINATE_LIMIT);
const extentSchema = z.number().positive().max(COORDINATE_LIMIT);

export const positionSchema = z.object({ x: coordinateSchema, y: coordinateSchema });
export const sizeSchema = z.object({ width: extentSchema, height: extentSchema });
export const rotationSchema = z.number().min(-3600).max(3600);
export const opacitySchema = z.number().min(0).max(1);

export type Position = z.infer<typeof positionSchema>;
export type Size = z.infer<typeof sizeSchema>;

export function getCanvasSize(aspectRatio: AspectRatio): Size {
  return CANVAS_SIZES[aspectRatio];
}
