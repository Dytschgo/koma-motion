import {
  brandKitAnalysisRequestSchema,
  brandKitAnalysisResponseSchema,
} from '@koma-motion/agent-runtime';
import { brandKitLogoDataSchema } from '@koma-motion/brand-kit';
import { z } from 'zod';

export const deckSessionIdSchema = z.uuid();
export const deckProgressSchema = z
  .object({
    sessionId: deckSessionIdSchema,
    phase: z.enum([
      'opening',
      'checking',
      'converting',
      'rendering',
      'ready',
      'analyzing',
      'validating',
    ]),
    message: z.string().max(500),
    completed: z.number().int().min(0).max(200),
    total: z.number().int().min(0).max(200),
  })
  .strict();
export const renderedDeckSchema = z
  .object({
    slides: brandKitAnalysisRequestSchema.shape.slides,
    totalSlides: brandKitAnalysisRequestSchema.shape.totalSlides,
  })
  .strict();
export const preparedDeckSchema = renderedDeckSchema
  .extend({
    sessionId: deckSessionIdSchema,
    fileName: z.string().min(1).max(120),
    warnings: z.array(z.string().max(500)).max(30),
    logos: z
      .array(
        z
          .object({
            id: z.string().regex(/^logo-[a-f0-9]{32}$/),
            slides: z.array(z.number().int().min(1).max(200)).max(200),
            image: brandKitLogoDataSchema,
          })
          .strict(),
      )
      .max(8),
  })
  .strict();
export const deckProposalSchema = z
  .object({
    proposal: brandKitAnalysisResponseSchema,
    analyzedAt: z.iso.datetime(),
    provider: z.enum(['claude-code', 'mock']),
    model: z.enum(['opus', 'mock']),
  })
  .strict();
export type PreparedDeck = z.infer<typeof preparedDeckSchema>;
export type DeckProgress = z.infer<typeof deckProgressSchema>;
export type DeckProposal = z.infer<typeof deckProposalSchema>;

export const MAX_DECK_BYTES = 32 * 1024 * 1024;
export const MAX_DECK_PAGES = 200;
export const MAX_ANALYZED_SLIDES = 20;
