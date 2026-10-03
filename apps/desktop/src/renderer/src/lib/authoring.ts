import {
  getCanvasSize,
  komaElementSchema,
  type BrandKit,
  type IdGenerator,
  type KomaElement,
  type Presentation,
} from '@koma-motion/core';

export const AUTHORING_KINDS = ['text', 'rectangle', 'circle', 'line'] as const;
export type AuthoringKind = (typeof AUTHORING_KINDS)[number];
export const AUTHORING_LABELS: Readonly<Record<AuthoringKind, string>> = {
  text: 'Text',
  rectangle: 'Rectangle',
  circle: 'Circle',
  line: 'Line',
};

/** A new, independent object. Defaults are copied from the current kit, not linked to it. */
export function createAuthoredElement(
  kind: AuthoringKind,
  brandKit: BrandKit,
  aspectRatio: Presentation['aspectRatio'],
  zIndex: number,
  ids: IdGenerator,
): KomaElement {
  const canvas = getCanvasSize(aspectRatio);
  const diameter = Math.min(canvas.width, canvas.height) / 4;
  const size =
    kind === 'circle'
      ? { width: diameter, height: diameter }
      : { width: canvas.width / 3, height: kind === 'line' ? 1 : canvas.height / 6 };
  const base = {
    id: ids.next('element'),
    persistentId: ids.next('object'),
    name: AUTHORING_LABELS[kind],
    position: { x: (canvas.width - size.width) / 2, y: (canvas.height - size.height) / 2 },
    size,
    rotation: 0,
    opacity: 1,
    zIndex,
    locked: false,
    visible: true,
  };
  return komaElementSchema.parse(
    kind === 'text'
      ? {
          ...base,
          type: 'text',
          content: { text: 'Your text' },
          style: {
            fontFamily: brandKit.typography.bodyFont,
            fontSize: 48,
            fontWeight: 400,
            colour: brandKit.colours.text,
            textAlign: 'left',
            verticalAlign: 'middle',
            lineHeight: 1.2,
          },
        }
      : {
          ...base,
          type: 'shape',
          content: { shape: kind, cornerRadius: 0 },
          style: {
            fill: kind === 'line' ? null : brandKit.colours.primary,
            stroke: kind === 'line' ? brandKit.colours.primary : null,
            strokeWidth: kind === 'line' ? 4 : 0,
          },
        },
  );
}
