import {
  BRAND_COLOUR_ROLES,
  brandKitSchema,
  formatPath,
  parseColour,
  type BrandColourRole,
  type BrandKit,
} from '@koma-motion/core';

/**
 * The Brand Kit as it is being typed. Colours and topics are raw text until
 * they validate, so the editor can show half-finished input without ever
 * storing an invalid Brand Kit in the project.
 */
export interface BrandKitDraft {
  readonly name: string;
  readonly colours: Readonly<Record<BrandColourRole, string>>;
  readonly headingFont: string;
  readonly bodyFont: string;
  readonly logoAssetId: string | null;
  readonly tone: string;
  readonly visualStyle: string;
  readonly iconStyle: string;
  readonly preferredImagery: string;
  /** Comma or line separated. */
  readonly preferredTopics: string;
  readonly referenceNotes: string;
}

/** Field name (for example `colours.primary`) to message. */
export type BrandKitFieldErrors = Readonly<Record<string, string>>;

export type BrandKitDraftResult =
  | { readonly ok: true; readonly brandKit: BrandKit }
  | { readonly ok: false; readonly errors: BrandKitFieldErrors };

export function toBrandKitDraft(brandKit: BrandKit): BrandKitDraft {
  return {
    name: brandKit.name,
    colours: { ...brandKit.colours },
    headingFont: brandKit.typography.headingFont,
    bodyFont: brandKit.typography.bodyFont,
    logoAssetId: brandKit.logoAssetId,
    tone: brandKit.tone,
    visualStyle: brandKit.visualStyle,
    iconStyle: brandKit.iconStyle,
    preferredImagery: brandKit.preferredImagery,
    preferredTopics: brandKit.preferredTopics.join(', '),
    referenceNotes: brandKit.referenceNotes,
  };
}

export function parseTopics(input: string): string[] {
  const topics = input
    .split(/[,\n]/)
    .map((topic) => topic.trim())
    .filter((topic) => topic !== '');
  return [...new Set(topics)];
}

const DRAFT_FIELD_BY_SCHEMA_PATH: Readonly<Record<string, string>> = {
  'typography.headingFont': 'headingFont',
  'typography.bodyFont': 'bodyFont',
};

/** Validates a draft. Colours are normalised to the stored `#RRGGBB` format. */
export function validateBrandKitDraft(draft: BrandKitDraft): BrandKitDraftResult {
  const errors: Record<string, string> = {};

  const colours: Record<string, string> = {};
  for (const role of BRAND_COLOUR_ROLES) {
    const parsed = parseColour(draft.colours[role]);
    if (parsed.ok) {
      colours[role] = parsed.value;
    } else {
      errors[`colours.${role}`] = parsed.error;
    }
  }

  const candidate = {
    name: draft.name.trim(),
    colours,
    typography: { headingFont: draft.headingFont.trim(), bodyFont: draft.bodyFont.trim() },
    logoAssetId: draft.logoAssetId,
    tone: draft.tone,
    visualStyle: draft.visualStyle,
    iconStyle: draft.iconStyle,
    preferredImagery: draft.preferredImagery,
    preferredTopics: parseTopics(draft.preferredTopics),
    referenceNotes: draft.referenceNotes,
  };

  const result = brandKitSchema.safeParse(candidate);
  if (!result.success) {
    for (const issue of result.error.issues) {
      const schemaPath = formatPath(issue.path);
      const topLevel = String(issue.path[0] ?? schemaPath);
      const field =
        DRAFT_FIELD_BY_SCHEMA_PATH[schemaPath] ??
        (topLevel === 'preferredTopics' ? topLevel : schemaPath);
      errors[field] ??= issue.message;
    }
  }

  if (!result.success || Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }
  return { ok: true, brandKit: result.data };
}
