import { z } from 'zod';

export const powerPointOptionsSchema = z
  .object({
    motion: z.enum(['static', 'fade', 'morph']),
    autoAdvance: z.boolean(),
  })
  .strict();

export const exportIssueSchema = z.object({
  severity: z.enum(['error', 'warning']),
  code: z.string(),
  message: z.string(),
});

export const exportValidationSchema = z.object({
  exportable: z.boolean(),
  issues: z.array(exportIssueSchema),
});

export type PowerPointOptions = z.infer<typeof powerPointOptionsSchema>;
export type ExportValidation = z.infer<typeof exportValidationSchema>;
