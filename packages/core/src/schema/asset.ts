import { z } from 'zod';
import { idSchema } from '../ids';

export const IMAGE_MEDIA_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export const imageMediaTypeSchema = z.enum(IMAGE_MEDIA_TYPES);
export type ImageMediaType = z.infer<typeof imageMediaTypeSchema>;

/** Largest image that may be embedded in a project file, before base64 encoding. */
export const MAX_EMBEDDED_ASSET_BYTES = 2 * 1024 * 1024;
const MAX_EMBEDDED_ASSET_CHARACTERS = Math.ceil(MAX_EMBEDDED_ASSET_BYTES / 3) * 4;

/**
 * A path inside the project, never on the host filesystem: relative, forward
 * slashes only, no `.` or `..` segments.
 */
export const projectPathSchema = z
  .string()
  .min(1)
  .max(260)
  .regex(
    /^(?!\/)(?!.*(?:^|\/)\.{1,2}(?:\/|$))[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/,
    'Project path must be relative, use "/" separators and must not contain "." or ".." segments',
  );

const metadataValueSchema = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);

export const assetReferenceSchema = z.object({
  id: idSchema,
  type: z.literal('image'),
  name: z.string().min(1).max(260),
  mediaType: imageMediaTypeSchema,
  /** Location the asset will have inside a future packaged project. */
  projectPath: projectPathSchema,
  metadata: z.record(z.string().max(100), metadataValueSchema),
  /**
   * Schema version 1 stores asset bytes inside the project file. `null` means
   * the bytes are not available, which the application reports as a missing asset.
   */
  embeddedData: z
    .object({
      encoding: z.literal('base64'),
      data: z
        .string()
        .max(MAX_EMBEDDED_ASSET_CHARACTERS)
        .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Embedded data must be base64'),
    })
    .nullable(),
});

export type AssetReference = z.infer<typeof assetReferenceSchema>;
