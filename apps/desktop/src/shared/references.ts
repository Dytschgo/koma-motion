import { referenceTextsSchema } from '@koma-motion/agent-runtime';
import { z } from 'zod';

/** File paths stay in the main process; the window receives extracted text only. */
export const referenceSelectionOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('selected'), references: referenceTextsSchema }).strict(),
  z.object({ status: z.literal('cancelled') }).strict(),
  z.object({ status: z.literal('failed'), message: z.string().min(1).max(500) }).strict(),
]);

export type ReferenceSelectionOutcome = z.infer<typeof referenceSelectionOutcomeSchema>;
