/**
 * The Brand Kit library: saved Brand Kits that belong to the person using
 * Koma Motion, not to a project. The main process stores it in the data
 * folder of the application; this module only describes and parses the
 * stored document, so it runs everywhere and holds no file access.
 */
import {
  BRAND_COLOUR_ROLES,
  brandKitSchema,
  idSchema,
  imageMediaTypeSchema,
  MAX_EMBEDDED_ASSET_BYTES,
  MAX_EMBEDDED_ASSET_CHARACTERS,
  type BrandKit,
  type ImageMediaType,
} from '@koma-motion/core';
import { z } from 'zod';

export const BRAND_KIT_LIBRARY_FORMAT = 'koma-motion/brand-kit-library';
export const BRAND_KIT_LIBRARY_VERSION = 1;
/** Saved Brand Kits a library may hold. */
export const MAX_SAVED_BRAND_KITS = 100;
/**
 * Largest library document, in bytes. Logos are stored as separate files,
 * so the document holds text only.
 */
export const MAX_BRAND_KIT_LIBRARY_BYTES = 4 * 1024 * 1024;

/** File extension of a stored image, by media type. */
export const IMAGE_EXTENSION_BY_MEDIA_TYPE: Readonly<Record<ImageMediaType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const savedBrandKitNameSchema = z
  .string()
  .trim()
  .min(1, 'A saved Brand Kit needs a name.')
  .max(120, 'A saved Brand Kit name can have up to 120 characters.');

const timestampSchema = z.iso.datetime({ offset: true });
export const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * The logo of a saved Brand Kit. The image lives in the library, named by the
 * SHA-256 of its bytes. No path, neither of the library nor of the file the
 * image once came from, is recorded.
 */
export const savedBrandKitLogoSchema = z.object({
  name: z.string().min(1).max(260),
  mediaType: imageMediaTypeSchema,
  sha256: sha256Schema,
  byteLength: z.number().int().positive().max(MAX_EMBEDDED_ASSET_BYTES),
});

/** A Brand Kit outside a project: there is no asset for `logoAssetId` to refer to. */
export const libraryBrandKitSchema = brandKitSchema.extend({ logoAssetId: z.null() });

export const deckProvenanceSchema = z
  .object({
    fileName: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[^/\\:]+$/)
      .refine((value) => [...value].every((character) => character.charCodeAt(0) >= 32)),
    analyzedAt: timestampSchema,
    provider: z.enum(['claude-code', 'mock']),
    model: z.string().max(120),
    analyzedSlides: z.array(z.number().int().min(1).max(200)).min(1).max(20),
    totalSlides: z.number().int().min(1).max(200),
  })
  .strict();

export const savedBrandKitSchema = z.object({
  id: idSchema,
  name: savedBrandKitNameSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  brandKit: libraryBrandKitSchema,
  logo: savedBrandKitLogoSchema.nullable(),
  provenance: deckProvenanceSchema.optional(),
});

export type SavedBrandKitLogo = z.infer<typeof savedBrandKitLogoSchema>;
export type SavedBrandKit = z.infer<typeof savedBrandKitSchema>;

/**
 * Image bytes of a logo as they cross from a project to the library and
 * back. The main process checks the bytes before it stores them.
 */
export const brandKitLogoDataSchema = z.object({
  name: z.string().trim().min(1).max(260),
  mediaType: imageMediaTypeSchema,
  data: z
    .string()
    .min(1)
    .max(MAX_EMBEDDED_ASSET_CHARACTERS)
    .regex(/^[A-Za-z0-9+/]*={0,2}$/, 'Logo data must be base64'),
});

export type BrandKitLogoData = z.infer<typeof brandKitLogoDataSchema>;

const envelopeSchema = z.object({
  format: z.literal(BRAND_KIT_LIBRARY_FORMAT),
  version: z.number().int().positive(),
  kits: z.array(z.unknown()),
});

export type BrandKitLibraryReadResult =
  | {
      readonly status: 'ready';
      readonly kits: readonly SavedBrandKit[];
      /**
       * Entries that could not be read. They are written back unchanged, so a
       * damaged entry is never discarded without the user deciding to.
       */
      readonly unreadable: readonly unknown[];
    }
  | { readonly status: 'damaged'; readonly reason: string }
  | { readonly status: 'newer'; readonly version: number };

/** Reads the text of a library document. It never throws. */
export function parseBrandKitLibrary(text: string): BrandKitLibraryReadResult {
  if (text.length > MAX_BRAND_KIT_LIBRARY_BYTES) {
    return { status: 'damaged', reason: 'The library file is larger than expected.' };
  }
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return { status: 'damaged', reason: 'The library file is not valid JSON.' };
  }
  const envelope = envelopeSchema.safeParse(document);
  if (!envelope.success) {
    return {
      status: 'damaged',
      reason: 'The library file is not a Koma Motion Brand Kit library.',
    };
  }
  if (envelope.data.version > BRAND_KIT_LIBRARY_VERSION) {
    return { status: 'newer', version: envelope.data.version };
  }

  const kits: SavedBrandKit[] = [];
  const unreadable: unknown[] = [];
  const ids = new Set<string>();
  for (const entry of envelope.data.kits) {
    const parsed = savedBrandKitSchema.safeParse(entry);
    if (parsed.success && !ids.has(parsed.data.id)) {
      ids.add(parsed.data.id);
      kits.push(parsed.data);
    } else {
      unreadable.push(entry);
    }
  }
  return { status: 'ready', kits, unreadable };
}

/** Deterministic text of a library document. Unreadable entries follow the readable ones. */
export function serialiseBrandKitLibrary(
  kits: readonly SavedBrandKit[],
  unreadable: readonly unknown[] = [],
): string {
  const document = {
    format: BRAND_KIT_LIBRARY_FORMAT,
    version: BRAND_KIT_LIBRARY_VERSION,
    kits: [...kits.map((kit) => savedBrandKitSchema.parse(kit)), ...unreadable],
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

/** The Brand Kit without its project-specific logo reference. */
export function toLibraryBrandKit(brandKit: BrandKit): z.infer<typeof libraryBrandKitSchema> {
  return libraryBrandKitSchema.parse({ ...brandKit, logoAssetId: null });
}

/** True when two Brand Kits have the same settings. The logo reference is not compared. */
export function sameBrandKitSettings(left: BrandKit, right: BrandKit): boolean {
  return (
    left.name === right.name &&
    BRAND_COLOUR_ROLES.every((role) => left.colours[role] === right.colours[role]) &&
    left.typography.headingFont === right.typography.headingFont &&
    left.typography.bodyFont === right.typography.bodyFont &&
    left.tone === right.tone &&
    left.visualStyle === right.visualStyle &&
    left.iconStyle === right.iconStyle &&
    left.preferredImagery === right.preferredImagery &&
    left.preferredTopics.length === right.preferredTopics.length &&
    left.preferredTopics.every((topic, index) => topic === right.preferredTopics[index]) &&
    left.referenceNotes === right.referenceNotes
  );
}

/**
 * The first saved kit with the same settings and the same logo bytes as the
 * project. `logoSha256` is the SHA-256 of the project's logo, or null when
 * it has none.
 */
export function findMatchingSavedKit<
  T extends { readonly brandKit: BrandKit; readonly logo: { readonly sha256: string } | null },
>(kits: readonly T[], brandKit: BrandKit, logoSha256: string | null): T | undefined {
  return kits.find(
    (kit) =>
      (kit.logo?.sha256 ?? null) === logoSha256 && sameBrandKitSettings(kit.brandKit, brandKit),
  );
}

/** A name for a copy that is not already used in the library. */
export function copyName(name: string, existing: readonly string[]): string {
  const taken = new Set(existing);
  const base = `${name} copy`.slice(0, 120);
  if (!taken.has(base)) {
    return base;
  }
  for (let number = 2; number < 1000; number += 1) {
    const suffix = ` ${String(number)}`;
    const candidate = `${`${name} copy`.slice(0, 120 - suffix.length)}${suffix}`;
    if (!taken.has(candidate)) {
      return candidate;
    }
  }
  return base;
}
