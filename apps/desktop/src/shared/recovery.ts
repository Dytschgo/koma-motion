import { komaProjectSchema } from '@koma-motion/core';
import { z } from 'zod';

export const recoverySessionSchema = z.string().uuid();
export const recoveryOfferSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('none') }),
  z.object({ status: z.literal('available'), name: z.string(), capturedAt: z.string() }),
  z.object({ status: z.literal('damaged'), message: z.string() }),
]);
export const recoveryCaptureSchema = z
  .object({
    sessionId: recoverySessionSchema,
    revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    project: komaProjectSchema,
    dirty: z.boolean(),
  })
  .strict();
export const recoveryResultSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('stored') }),
  z.object({ status: z.literal('clean') }),
  z.object({ status: z.literal('stale') }),
  z.object({ status: z.literal('failed'), message: z.string() }),
]);
export type RecoveryOffer = z.infer<typeof recoveryOfferSchema>;
export type RecoveryCapture = z.infer<typeof recoveryCaptureSchema>;
export type RecoveryResult = z.infer<typeof recoveryResultSchema>;
