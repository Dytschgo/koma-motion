import {
  brandProfileAnalysisRequestSchema,
  brandProfileAnalysisResponseSchema,
  MAX_BRAND_PROFILE_EXHIBITS,
  MAX_BRAND_PROFILE_FILES,
} from '@koma-motion/agent-runtime';
import { brandKitLogoDataSchema } from '@koma-motion/brand-kit';
import { z } from 'zod';

/** Limits of one brand profile draft. The main process enforces all of them. */
export { MAX_BRAND_PROFILE_EXHIBITS, MAX_BRAND_PROFILE_FILES };
export const MAX_BRAND_PROFILE_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_BRAND_PROFILE_TOTAL_BYTES = 64 * 1024 * 1024;
/** Largest side of an uploaded image, in pixels, and its largest area. */
export const MAX_BRAND_PROFILE_IMAGE_SIDE = 12000;
export const MAX_BRAND_PROFILE_IMAGE_PIXELS = 40_000_000;
/** Prepared previews and text of one analysis. Leaves room below the 24 MiB request limit. */
export const MAX_BRAND_PROFILE_REQUEST_CHARACTERS = 22 * 1024 * 1024;
/** Local preparation of all files, and the analysis by the provider. */
export const BRAND_PROFILE_PREPARATION_TIMEOUT_MS = 180_000;
export const BRAND_PROFILE_ANALYSIS_TIMEOUT_MS = 180_000;

export const brandProfileSessionIdSchema = z.uuid();
const fileOrdinal = z.number().int().min(1).max(MAX_BRAND_PROFILE_FILES);
const exhibitNumber = z.number().int().min(1).max(MAX_BRAND_PROFILE_EXHIBITS);

export const renderedImageSchema = z
  .object({
    image: z
      .object({
        mediaType: z.enum(['image/png', 'image/jpeg']),
        preview: brandProfileAnalysisRequestSchema.shape.exhibits.element.shape.preview,
      })
      .strict(),
  })
  .strict();

export const brandProfileProgressSchema = z
  .object({
    sessionId: brandProfileSessionIdSchema,
    phase: z.enum(['opening', 'preparing', 'ready', 'analyzing', 'validating']),
    message: z.string().max(500),
    completed: z.number().int().min(0).max(200),
    total: z.number().int().min(0).max(200),
  })
  .strict();

/** Attached files as the window may know them: display names and prepared content, no paths. */
export const preparedMaterialSchema = z
  .object({
    sessionId: brandProfileSessionIdSchema,
    files: z
      .array(
        z
          .object({
            file: fileOrdinal,
            name: z.string().min(1).max(120),
            kind: z.enum(['image', 'pdf', 'pptx']),
            /** Slides or pages in the file. 1 for an image. */
            total: z.number().int().min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_BRAND_PROFILE_FILES),
    exhibits: brandProfileAnalysisRequestSchema.shape.exhibits,
    logos: z
      .array(
        z
          .object({
            id: z.string().regex(/^logo-[a-f0-9]{32}$/),
            file: fileOrdinal,
            exhibits: z.array(exhibitNumber).min(1).max(MAX_BRAND_PROFILE_EXHIBITS),
            image: brandKitLogoDataSchema,
          })
          .strict(),
      )
      .max(8),
    warnings: z.array(z.string().max(500)).max(40),
  })
  .strict();

export const brandProfileProposalSchema = z
  .object({
    proposal: brandProfileAnalysisResponseSchema,
    /** False when the proposed fonts are a guess from appearance. */
    fontsNamedInMaterial: z.boolean(),
    analyzedAt: z.iso.datetime(),
    provider: z.enum(['claude-code', 'mock']),
    model: z.enum(['opus', 'mock']),
  })
  .strict();

export type PreparedMaterial = z.infer<typeof preparedMaterialSchema>;
export type BrandProfileProgress = z.infer<typeof brandProfileProgressSchema>;
export type BrandProfileProposal = z.infer<typeof brandProfileProposalSchema>;
