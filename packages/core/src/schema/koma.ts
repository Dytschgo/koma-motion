import { z } from 'zod';
import { hexColourSchema } from '../colour';
import { idSchema } from '../ids';
import { komaElementSchema, type KomaElement, type LeafElement } from './element';

/** Top-level rendering safety budget; groups retain their separate child budget; see docs/GENERATION_LIMITS.md. */
export const MAX_ELEMENTS_PER_KOMA = 2000;

/** At-rest autoplay time, separate from transition animation duration. */
export const MIN_KOMA_HOLD_DURATION_MS = 1000;
export const MAX_KOMA_HOLD_DURATION_MS = 60_000;
export const DEFAULT_KOMA_HOLD_DURATION_MS = 5000;
export const komaHoldDurationSchema = z
  .number()
  .int()
  .min(MIN_KOMA_HOLD_DURATION_MS)
  .max(MAX_KOMA_HOLD_DURATION_MS);

export const komaBackgroundSchema = z.object({
  type: z.literal('solid'),
  colour: hexColourSchema,
});

export interface ElementIdentity {
  readonly id: string;
  readonly persistentId: string;
  /** Path of the element relative to the Koma. */
  readonly path: readonly (string | number)[];
}

/** Lists the identity of every element of a Koma, including the children of groups. */
export function collectElementIdentities(elements: readonly KomaElement[]): ElementIdentity[] {
  const identities: ElementIdentity[] = [];
  elements.forEach((element, index) => {
    identities.push({
      id: element.id,
      persistentId: element.persistentId,
      path: ['elements', index],
    });
    if (element.type === 'group') {
      element.content.children.forEach((child, childIndex) => {
        identities.push({
          id: child.id,
          persistentId: child.persistentId,
          path: ['elements', index, 'content', 'children', childIndex],
        });
      });
    }
  });
  return identities;
}

/** Returns every element of a Koma including the children of groups. */
export function flattenElements(
  elements: readonly KomaElement[],
): Array<KomaElement | LeafElement> {
  return elements.flatMap((element) =>
    element.type === 'group' ? [element, ...element.content.children] : [element],
  );
}

/**
 * A Koma is one visual state of the presentation. Element identifiers and
 * persistent identifiers must be unique within a Koma.
 */
export const komaSchema = z
  .object({
    id: idSchema,
    title: z.string().max(300),
    purpose: z.string().max(2000),
    speakerNotes: z.string().max(20000),
    /** null uses the presentation or export global hold time. */
    holdDurationMs: komaHoldDurationSchema.nullable().default(null),
    background: komaBackgroundSchema,
    elements: z
      .array(komaElementSchema)
      .max(
        MAX_ELEMENTS_PER_KOMA,
        'This Koma exceeds the 2,000-element rendering safety budget. Split it across Komas.',
      ),
  })
  .superRefine((koma, context) => {
    const seenIds = new Set<string>();
    const seenPersistentIds = new Set<string>();
    for (const identity of collectElementIdentities(koma.elements)) {
      if (seenIds.has(identity.id)) {
        context.addIssue({
          code: 'custom',
          path: [...identity.path, 'id'],
          message: `Element id "${identity.id}" is used more than once in this Koma`,
        });
      }
      seenIds.add(identity.id);
      if (seenPersistentIds.has(identity.persistentId)) {
        context.addIssue({
          code: 'custom',
          path: [...identity.path, 'persistentId'],
          message: `Persistent id "${identity.persistentId}" is used more than once in this Koma`,
        });
      }
      seenPersistentIds.add(identity.persistentId);
    }
  });

export type KomaBackground = z.infer<typeof komaBackgroundSchema>;
export type Koma = z.infer<typeof komaSchema>;
