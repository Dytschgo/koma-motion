import type { ReactElement } from 'react';
import { BRAND_COLOUR_ROLES, brandKitSchema, type BrandKit } from '@koma-motion/core';
import { BrandPreview } from './BrandKitEditor';
import { Field, TextArea, TextInput } from './ui';

const descriptions = [
  ['tone', 'Tone'],
  ['visualStyle', 'Visual style'],
  ['iconStyle', 'Icon style'],
  ['preferredImagery', 'Preferred imagery'],
  ['referenceNotes', 'Reference notes'],
] as const;

/** The reviewed kit as it would be stored, with topics taken from their text field. */
export function validateProposalDraft(draft: BrandKit, topics: string) {
  return brandKitSchema.safeParse({
    ...draft,
    preferredTopics: topics
      .split('\n')
      .map((topic) => topic.trim())
      .filter(Boolean),
  });
}

/** The editable fields of a proposed Brand Kit, shared by every analysis review. */
export function BrandKitProposalFields({
  draft,
  onDraft,
  topics,
  onTopics,
  logoUrl,
  fontHint,
}: {
  readonly draft: BrandKit;
  readonly onDraft: (draft: BrandKit) => void;
  readonly topics: string;
  readonly onTopics: (topics: string) => void;
  readonly logoUrl: string | null;
  /** Shown under the font fields, for example when the fonts are a guess. */
  readonly fontHint?: string | undefined;
}): ReactElement {
  const validation = validateProposalDraft(draft, topics);
  const change = (field: keyof BrandKit, value: string) => onDraft({ ...draft, [field]: value });
  return (
    <>
      <Field label="Brand name">
        {(ids) => (
          <TextInput
            {...ids}
            value={draft.name}
            maxLength={120}
            onChange={(event) => change('name', event.target.value)}
          />
        )}
      </Field>
      {validation.success && <BrandPreview brandKit={validation.data} logoUrl={logoUrl} />}
      <div className="grid grid-cols-2 gap-3">
        {BRAND_COLOUR_ROLES.map((role) => (
          <Field key={role} label={`${role[0]?.toUpperCase()}${role.slice(1)} colour`}>
            {(ids) => (
              <TextInput
                {...ids}
                value={draft.colours[role]}
                maxLength={7}
                onChange={(event) =>
                  onDraft({
                    ...draft,
                    colours: { ...draft.colours, [role]: event.target.value },
                  })
                }
              />
            )}
          </Field>
        ))}
      </div>
      <Field label="Heading font">
        {(ids) => (
          <TextInput
            {...ids}
            value={draft.typography.headingFont}
            onChange={(event) =>
              onDraft({
                ...draft,
                typography: { ...draft.typography, headingFont: event.target.value },
              })
            }
          />
        )}
      </Field>
      <Field label="Body font" hint={fontHint}>
        {(ids) => (
          <TextInput
            {...ids}
            value={draft.typography.bodyFont}
            onChange={(event) =>
              onDraft({
                ...draft,
                typography: { ...draft.typography, bodyFont: event.target.value },
              })
            }
          />
        )}
      </Field>
      {descriptions.map(([field, label]) => (
        <Field key={field} label={label}>
          {(ids) => (
            <TextArea
              {...ids}
              value={draft[field]}
              maxLength={field === 'referenceNotes' ? 5000 : 1000}
              onChange={(event) => change(field, event.target.value)}
            />
          )}
        </Field>
      ))}
      <Field label="Preferred topics (one per line)">
        {(ids) => (
          <TextArea {...ids} value={topics} onChange={(event) => onTopics(event.target.value)} />
        )}
      </Field>
      {!validation.success && (
        <p role="alert" className="text-motion">
          {validation.error.issues
            .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
            .join('; ')}
        </p>
      )}
    </>
  );
}
