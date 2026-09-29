import { z } from 'zod';
import { hexColourSchema } from '../colour';
import { opacitySchema, positionSchema, rotationSchema, sizeSchema } from '../geometry';
import { idSchema, persistentIdSchema } from '../ids';

export const ELEMENT_TYPES = ['text', 'shape', 'image', 'group'] as const;
export const elementTypeSchema = z.enum(ELEMENT_TYPES);
export type ElementType = z.infer<typeof elementTypeSchema>;

export const SHAPE_KINDS = ['rectangle', 'roundedRectangle', 'circle', 'line'] as const;
export const shapeKindSchema = z.enum(SHAPE_KINDS);
export type ShapeKind = z.infer<typeof shapeKindSchema>;

export const TEXT_ALIGNMENTS = ['left', 'center', 'right'] as const;
export const VERTICAL_ALIGNMENTS = ['top', 'middle', 'bottom'] as const;
export const IMAGE_FITS = ['contain', 'cover'] as const;

export const fontFamilySchema = z
  .string()
  .min(1)
  .max(120)
  .regex(
    /^[A-Za-z0-9 ,'"_-]+$/,
    'Font family may only contain letters, digits, spaces and , \' " _ -',
  );

const elementBaseShape = {
  id: idSchema,
  persistentId: persistentIdSchema,
  /** Human-readable label shown in the inspector. */
  name: z.string().max(120),
  position: positionSchema,
  size: sizeSchema,
  rotation: rotationSchema,
  opacity: opacitySchema,
  zIndex: z.number().int().min(-10000).max(10000),
  locked: z.boolean(),
  visible: z.boolean(),
};

export const textElementSchema = z.object({
  ...elementBaseShape,
  type: z.literal('text'),
  content: z.object({
    text: z.string().max(5000),
  }),
  style: z.object({
    fontFamily: fontFamilySchema,
    fontSize: z.number().min(1).max(2000),
    fontWeight: z.number().int().min(100).max(900),
    colour: hexColourSchema,
    textAlign: z.enum(TEXT_ALIGNMENTS),
    verticalAlign: z.enum(VERTICAL_ALIGNMENTS),
    lineHeight: z.number().min(0.5).max(4),
  }),
});

export const shapeElementSchema = z.object({
  ...elementBaseShape,
  type: z.literal('shape'),
  content: z.object({
    shape: shapeKindSchema,
    /** Only used by `roundedRectangle`. */
    cornerRadius: z.number().min(0).max(10000),
  }),
  style: z.object({
    fill: hexColourSchema.nullable(),
    stroke: hexColourSchema.nullable(),
    strokeWidth: z.number().min(0).max(1000),
  }),
});

export const imageElementSchema = z.object({
  ...elementBaseShape,
  type: z.literal('image'),
  content: z.object({
    /** References `KomaProject.assets[].id`. Images never carry filesystem paths. */
    assetId: idSchema,
    altText: z.string().max(500),
  }),
  style: z.object({
    fit: z.enum(IMAGE_FITS),
    cornerRadius: z.number().min(0).max(10000),
  }),
});

export const leafElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  shapeElementSchema,
  imageElementSchema,
]);

/**
 * A group positions its children in a local coordinate space of
 * `referenceSize`. When the size of the group differs from `referenceSize`,
 * the children are scaled with it. Groups cannot be nested in schema version 1.
 */
export const groupElementSchema = z.object({
  ...elementBaseShape,
  type: z.literal('group'),
  content: z.object({
    referenceSize: sizeSchema,
    children: z.array(leafElementSchema).max(200),
  }),
  style: z.object({}),
});

export const komaElementSchema = z.discriminatedUnion('type', [
  textElementSchema,
  shapeElementSchema,
  imageElementSchema,
  groupElementSchema,
]);

export type TextElement = z.infer<typeof textElementSchema>;
export type ShapeElement = z.infer<typeof shapeElementSchema>;
export type ImageElement = z.infer<typeof imageElementSchema>;
export type GroupElement = z.infer<typeof groupElementSchema>;
export type LeafElement = z.infer<typeof leafElementSchema>;
export type KomaElement = z.infer<typeof komaElementSchema>;
