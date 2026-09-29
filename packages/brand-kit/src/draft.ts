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

const TEXT_FIELDS = [
  'name',
  'headingFont',
  'bodyFont',
  'tone',
  'visualStyle',
  'iconStyle',
  'preferredImagery',
  'preferredTopics',
  'referenceNotes',
] as const;

export type BrandKitTextField = (typeof TEXT_FIELDS)[number];

/** One field the editor can commit. Logo changes use a separate path. */
export type BrandKitDraftField = BrandKitTextField | `colours.${BrandColourRole}`;

/**
 * Raw text for fields the user is editing. It is not part of the stored Brand
 * Kit. Name and fonts are trimmed only when committed, so the raw string may
 * keep leading or trailing spaces. A failed commit must not clear this text.
 * Drop a field only once it normalises and the control is no longer focused,
 * including when undo or redo changes the stored kit. Invalid text, including
 * topics, stays. The draft is scoped to one project and must not be saved
 * into a different one.
 */
export interface BrandKitRawDraft {
  readonly name?: string;
  readonly colours?: Partial<Readonly<Record<BrandColourRole, string>>>;
  readonly headingFont?: string;
  readonly bodyFont?: string;
  readonly tone?: string;
  readonly visualStyle?: string;
  readonly iconStyle?: string;
  readonly preferredImagery?: string;
  /** Comma or line separated, still unparsed. */
  readonly preferredTopics?: string;
  readonly referenceNotes?: string;
}

export interface BrandKitFieldCommit {
  /** The previous kit when the field does not normalise. */
  readonly brandKit: BrandKit;
  /** Set when the raw text cannot be stored. */
  readonly error: string | null;
}

export interface BrandKitFieldEdit extends BrandKitFieldCommit {
  /** Raw text including the edit, whether or not the commit succeeded. */
  readonly raw: BrandKitRawDraft;
}

type VerbatimField = 'tone' | 'visualStyle' | 'iconStyle' | 'preferredImagery' | 'referenceNotes';

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

function colourRole(field: BrandKitDraftField): BrandColourRole | null {
  for (const role of BRAND_COLOUR_ROLES) {
    if (field === `colours.${role}`) {
      return role;
    }
  }
  return null;
}

function isColourField(field: BrandKitDraftField): field is `colours.${BrandColourRole}` {
  return colourRole(field) !== null;
}

function textField(field: BrandKitDraftField): BrandKitTextField | null {
  for (const candidate of TEXT_FIELDS) {
    if (candidate === field) {
      return candidate;
    }
  }
  return null;
}

function isVerbatimField(field: BrandKitDraftField): field is VerbatimField {
  return (
    field === 'tone' ||
    field === 'visualStyle' ||
    field === 'iconStyle' ||
    field === 'preferredImagery' ||
    field === 'referenceNotes'
  );
}

function sameList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/** Merges raw overrides onto the values derived from the stored Brand Kit. */
export function withBrandKitRawDraft(brandKit: BrandKit, raw: BrandKitRawDraft): BrandKitDraft {
  const draft = toBrandKitDraft(brandKit);
  const colours = { ...draft.colours };
  for (const role of BRAND_COLOUR_ROLES) {
    const value = raw.colours?.[role];
    if (value !== undefined) {
      colours[role] = value;
    }
  }
  return {
    ...draft,
    name: raw.name ?? draft.name,
    colours,
    headingFont: raw.headingFont ?? draft.headingFont,
    bodyFont: raw.bodyFont ?? draft.bodyFont,
    tone: raw.tone ?? draft.tone,
    visualStyle: raw.visualStyle ?? draft.visualStyle,
    iconStyle: raw.iconStyle ?? draft.iconStyle,
    preferredImagery: raw.preferredImagery ?? draft.preferredImagery,
    preferredTopics: raw.preferredTopics ?? draft.preferredTopics,
    referenceNotes: raw.referenceNotes ?? draft.referenceNotes,
  };
}

export function setBrandKitRawField(
  raw: BrandKitRawDraft,
  field: BrandKitDraftField,
  value: string,
): BrandKitRawDraft {
  const role = colourRole(field);
  if (role !== null) {
    if (raw.colours?.[role] === value) {
      return raw;
    }
    return { ...raw, colours: { ...raw.colours, [role]: value } };
  }
  const key = textField(field);
  if (key === null || raw[key] === value) {
    return raw;
  }
  return { ...raw, [key]: value };
}

function clearBrandKitRawField(raw: BrandKitRawDraft, field: BrandKitDraftField): BrandKitRawDraft {
  const role = colourRole(field);
  if (role !== null) {
    if (raw.colours?.[role] === undefined) {
      return raw;
    }
    const colours: Partial<Record<BrandColourRole, string>> = {};
    for (const item of BRAND_COLOUR_ROLES) {
      const value = raw.colours[item];
      if (item !== role && value !== undefined) {
        colours[item] = value;
      }
    }
    if (BRAND_COLOUR_ROLES.every((item) => colours[item] === undefined)) {
      const { colours: _colours, ...rest } = raw;
      return rest;
    }
    return { ...raw, colours };
  }
  const key = textField(field);
  if (key === null || raw[key] === undefined) {
    return raw;
  }
  let next: BrandKitRawDraft = raw.colours === undefined ? {} : { colours: raw.colours };
  for (const item of TEXT_FIELDS) {
    if (item === key) {
      continue;
    }
    const value = raw[item];
    if (value !== undefined) {
      next = { ...next, [item]: value };
    }
  }
  return next;
}

function issueMessage(
  issues: readonly { readonly path: readonly PropertyKey[]; readonly message: string }[],
  field: BrandKitDraftField,
): string {
  for (const issue of issues) {
    const path = formatPath(issue.path);
    const top = String(issue.path[0] ?? '');
    if (
      path === field ||
      path.startsWith(`${field}.`) ||
      path.startsWith(`${field}[`) ||
      top === field ||
      (field === 'headingFont' && path.startsWith('typography.headingFont')) ||
      (field === 'bodyFont' && path.startsWith('typography.bodyFont')) ||
      (field === 'preferredTopics' && top === 'preferredTopics')
    ) {
      return issue.message;
    }
  }
  return issues[0]?.message ?? 'This value cannot be stored.';
}

function sameStoredField(left: BrandKit, right: BrandKit, field: BrandKitDraftField): boolean {
  if (isColourField(field)) {
    const role = colourRole(field);
    return role !== null && left.colours[role] === right.colours[role];
  }
  switch (field) {
    case 'name':
      return left.name === right.name;
    case 'headingFont':
      return left.typography.headingFont === right.typography.headingFont;
    case 'bodyFont':
      return left.typography.bodyFont === right.typography.bodyFont;
    case 'preferredTopics':
      return sameList(left.preferredTopics, right.preferredTopics);
    case 'tone':
    case 'visualStyle':
    case 'iconStyle':
    case 'preferredImagery':
    case 'referenceNotes':
      return left[field] === right[field];
  }
}

function commitCandidate(
  brandKit: BrandKit,
  candidate: BrandKit,
  field: BrandKitDraftField,
): BrandKitFieldCommit {
  const parsed = brandKitSchema.safeParse(candidate);
  if (!parsed.success) {
    return { brandKit, error: issueMessage(parsed.error.issues, field) };
  }
  if (sameStoredField(brandKit, parsed.data, field)) {
    return { brandKit, error: null };
  }
  return { brandKit: parsed.data, error: null };
}

/**
 * Commits one field onto a copy of the stored Brand Kit when that field
 * alone normalises. Other invalid draft fields are irrelevant. A failure
 * returns the previous kit and the field error.
 */
export function commitBrandKitField(
  brandKit: BrandKit,
  field: BrandKitDraftField,
  raw: string,
): BrandKitFieldCommit {
  const role = colourRole(field);
  if (role !== null) {
    const parsed = parseColour(raw);
    if (!parsed.ok) {
      return { brandKit, error: parsed.error };
    }
    if (parsed.value === brandKit.colours[role]) {
      return { brandKit, error: null };
    }
    return commitCandidate(
      brandKit,
      { ...brandKit, colours: { ...brandKit.colours, [role]: parsed.value } },
      field,
    );
  }

  if (field === 'name') {
    const name = raw.trim();
    if (name === brandKit.name) {
      return { brandKit, error: null };
    }
    return commitCandidate(brandKit, { ...brandKit, name }, field);
  }

  if (field === 'headingFont' || field === 'bodyFont') {
    const font = raw.trim();
    const current =
      field === 'headingFont' ? brandKit.typography.headingFont : brandKit.typography.bodyFont;
    if (font === current) {
      return { brandKit, error: null };
    }
    return commitCandidate(
      brandKit,
      { ...brandKit, typography: { ...brandKit.typography, [field]: font } },
      field,
    );
  }

  if (field === 'preferredTopics') {
    const preferredTopics = parseTopics(raw);
    if (sameList(preferredTopics, brandKit.preferredTopics)) {
      return { brandKit, error: null };
    }
    return commitCandidate(brandKit, { ...brandKit, preferredTopics }, field);
  }

  if (isVerbatimField(field)) {
    if (brandKit[field] === raw) {
      return { brandKit, error: null };
    }
    return commitCandidate(brandKit, { ...brandKit, [field]: raw }, field);
  }

  return { brandKit, error: 'This field cannot be stored.' };
}

/**
 * Records the raw text and commits it when that field normalises. The raw
 * draft is kept either way, so a failed commit cannot wipe what was typed.
 */
export function editBrandKitField(
  brandKit: BrandKit,
  raw: BrandKitRawDraft,
  field: BrandKitDraftField,
  value: string,
): BrandKitFieldEdit {
  const committed = commitBrandKitField(brandKit, field, value);
  return { ...committed, raw: setBrandKitRawField(raw, field, value) };
}

/**
 * Drops raw overrides that normalise and are not being edited, so the control
 * shows the stored value after blur or after undo/redo. Invalid text and the
 * focused field stay. Does not commit and does not clear a failed field.
 */
export function pruneBrandKitRawDraft(
  brandKit: BrandKit,
  raw: BrandKitRawDraft,
  focused: BrandKitDraftField | null,
): BrandKitRawDraft {
  let next = raw;
  for (const field of TEXT_FIELDS) {
    const value = raw[field];
    if (field === focused || value === undefined) {
      continue;
    }
    if (commitBrandKitField(brandKit, field, value).error === null) {
      next = clearBrandKitRawField(next, field);
    }
  }
  for (const role of BRAND_COLOUR_ROLES) {
    const field = `colours.${role}` as const;
    const value = raw.colours?.[role];
    if (field === focused || value === undefined) {
      continue;
    }
    if (commitBrandKitField(brandKit, field, value).error === null) {
      next = clearBrandKitRawField(next, field);
    }
  }
  return next;
}
