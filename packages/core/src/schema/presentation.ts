import { z } from 'zod';
import { aspectRatioSchema } from '../geometry';
import { idSchema } from '../ids';
import { komaSchema } from './koma';
import { komaTransitionSchema } from './transition';

export const MAX_KOMAS = 200;

export const presentationSchema = z
  .object({
    id: idSchema,
    title: z.string().max(300),
    objective: z.string().max(2000),
    audience: z.string().max(1000),
    narrative: z.string().max(10000),
    aspectRatio: aspectRatioSchema,
    komas: z.array(komaSchema).max(MAX_KOMAS),
    transitions: z.array(komaTransitionSchema).max(MAX_KOMAS),
  })
  .superRefine((presentation, context) => {
    const komaIds = new Set<string>();
    presentation.komas.forEach((koma, index) => {
      if (komaIds.has(koma.id)) {
        context.addIssue({
          code: 'custom',
          path: ['komas', index, 'id'],
          message: `Koma id "${koma.id}" is used more than once`,
        });
      }
      komaIds.add(koma.id);
    });

    const transitionIds = new Set<string>();
    presentation.transitions.forEach((transition, index) => {
      if (transitionIds.has(transition.id)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'id'],
          message: `Transition id "${transition.id}" is used more than once`,
        });
      }
      transitionIds.add(transition.id);
      if (!komaIds.has(transition.fromKomaId)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'fromKomaId'],
          message: `Transition starts at Koma "${transition.fromKomaId}", which does not exist`,
        });
      }
      if (!komaIds.has(transition.toKomaId)) {
        context.addIssue({
          code: 'custom',
          path: ['transitions', index, 'toKomaId'],
          message: `Transition ends at Koma "${transition.toKomaId}", which does not exist`,
        });
      }
    });
  });

export type Presentation = z.infer<typeof presentationSchema>;
