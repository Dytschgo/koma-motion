import {
  assessBrandKitContrast,
  editBrandKitField,
  FONT_SUGGESTIONS,
  pruneBrandKitRawDraft,
  validateBrandKitDraft,
  withBrandKitRawDraft,
  type BrandKitDraft,
  type BrandKitDraftField,
} from '@koma-motion/brand-kit';
import {
  BRAND_COLOUR_ROLES,
  parseColour,
  type BrandColourRole,
  type BrandKit,
  type KomaProject,
} from '@koma-motion/core';
import { createAssetResolver } from '@koma-motion/renderer';
import { useId, useLayoutEffect, useMemo, useState, type ReactElement } from 'react';
import { chooseProjectLogo } from '../lib/projectActions';
import { changeBrandKit, changeLogo } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { selectBrandKitRawDraft, useUiStore } from '../state/uiStore';
import { BrandKitSource } from './BrandKitLibrary';
import { CheckIcon, WarningIcon } from './icons';
import { Button, Field, TextArea, TextInput } from './ui';

const COLOUR_LABELS: Readonly<Record<BrandColourRole, string>> = {
  primary: 'Primary colour',
  secondary: 'Secondary colour',
  accent: 'Accent colour',
  background: 'Background colour',
  text: 'Text colour',
};

/** Shows how the Brand Kit looks on a Koma. It always shows the last valid Brand Kit. */
export function BrandPreview({
  brandKit,
  logoUrl,
}: {
  readonly brandKit: BrandKit;
  readonly logoUrl: string | null;
}): ReactElement {
  const { colours, typography } = brandKit;
  return (
    <div
      role="img"
      aria-label="Preview of the Brand Kit"
      className="@container relative aspect-video w-full overflow-hidden rounded-lg border border-desk-600"
      style={{ background: colours.background, color: colours.text }}
    >
      <div className="absolute inset-0 flex flex-col justify-between p-[7%]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p
              className="text-[clamp(1rem,7cqw,2rem)] leading-tight font-bold"
              style={{ fontFamily: `${typography.headingFont}, system-ui, sans-serif` }}
            >
              {brandKit.name.trim() === '' ? 'Your brand' : brandKit.name}
            </p>
            <p
              className="mt-2 max-w-[28ch] text-[clamp(0.65rem,3.4cqw,0.95rem)] opacity-80"
              style={{ fontFamily: `${typography.bodyFont}, system-ui, sans-serif` }}
            >
              Body text uses the body font and the text colour on the background colour.
            </p>
          </div>
          {logoUrl !== null && (
            <img
              src={logoUrl}
              alt=""
              className="max-h-[22%] max-w-[26%] flex-none object-contain"
            />
          )}
        </div>
        <div className="flex items-end gap-[4%]">
          <div className="h-[14cqw] w-[38%] rounded-md" style={{ background: colours.primary }} />
          <div className="h-[9cqw] w-[22%] rounded-md" style={{ background: colours.secondary }} />
          <div className="size-[11cqw] rounded-full" style={{ background: colours.accent }} />
        </div>
      </div>
    </div>
  );
}

function coalesceKey(field: BrandKitDraftField): string {
  switch (field) {
    case 'name':
      return 'brand-kit:name';
    case 'headingFont':
      return 'brand-kit:heading-font';
    case 'bodyFont':
      return 'brand-kit:body-font';
    case 'tone':
      return 'brand-kit:tone';
    case 'visualStyle':
      return 'brand-kit:visualStyle';
    case 'iconStyle':
      return 'brand-kit:iconStyle';
    case 'preferredImagery':
      return 'brand-kit:preferredImagery';
    case 'preferredTopics':
      return 'brand-kit:topics';
    case 'referenceNotes':
      return 'brand-kit:notes';
    case 'colours.primary':
      return 'brand-kit:colour-primary';
    case 'colours.secondary':
      return 'brand-kit:colour-secondary';
    case 'colours.accent':
      return 'brand-kit:colour-accent';
    case 'colours.background':
      return 'brand-kit:colour-background';
    case 'colours.text':
      return 'brand-kit:colour-text';
  }
}

export function BrandKitEditor({ project }: { readonly project: KomaProject }): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const setBrandKitDraft = useUiStore((state) => state.setBrandKitDraft);
  const raw = useUiStore((state) => selectBrandKitRawDraft(state, project.id));
  const fontListId = useId();

  /**
   * The field being typed. Its raw text stays put through undo/redo. A valid
   * field that is not focused is dropped so the control shows the stored value.
   */
  const [focused, setFocused] = useState<BrandKitDraftField | null>(null);
  const [selectingLogo, setSelectingLogo] = useState(false);

  const draft: BrandKitDraft = withBrandKitRawDraft(project.brandKit, raw);
  const validation = validateBrandKitDraft(draft);
  const errors = validation.ok ? {} : validation.errors;
  const contrast = useMemo(() => assessBrandKitContrast(project.brandKit), [project.brandKit]);

  useLayoutEffect(() => {
    const current = selectBrandKitRawDraft(useUiStore.getState(), project.id);
    const pruned = pruneBrandKitRawDraft(project.brandKit, current, focused);
    if (pruned !== current) {
      setBrandKitDraft(project.id, pruned);
    }
  }, [focused, project.brandKit, project.id, setBrandKitDraft]);

  const logo = useMemo(() => {
    const { logoAssetId } = project.brandKit;
    if (logoAssetId === null) {
      return null;
    }
    const resolved = createAssetResolver(project.assets)(logoAssetId);
    return resolved.status === 'available' ? resolved : null;
  }, [project.assets, project.brandKit]);

  const edit = (field: BrandKitDraftField, value: string): void => {
    const existing = selectBrandKitRawDraft(useUiStore.getState(), project.id);
    const edited = editBrandKitField(project.brandKit, existing, field, value);
    // Keep the raw text even when this field cannot be stored.
    setBrandKitDraft(project.id, edited.raw);
    if (edited.brandKit !== project.brandKit) {
      apply(changeBrandKit(edited.brandKit), { coalesceKey: coalesceKey(field) });
    }
  };

  const focusField = (field: BrandKitDraftField) => ({
    onFocus: () => {
      setFocused(field);
    },
    onBlur: () => {
      setFocused((current) => (current === field ? null : current));
      // Show the normalised value as soon as a valid field is left. Invalid text stays.
      const current = selectBrandKitRawDraft(useUiStore.getState(), project.id);
      const pruned = pruneBrandKitRawDraft(project.brandKit, current, null);
      if (pruned !== current) {
        setBrandKitDraft(project.id, pruned);
      }
    },
  });

  const chooseLogo = async (): Promise<void> => {
    setSelectingLogo(true);
    try {
      await chooseProjectLogo();
    } finally {
      setSelectingLogo(false);
    }
  };

  const textField = (
    key: 'tone' | 'visualStyle' | 'iconStyle' | 'preferredImagery',
    label: string,
    placeholder: string,
  ): ReactElement => (
    <Field label={label} error={errors[key]}>
      {(ids) => (
        <TextArea
          {...ids}
          rows={2}
          value={draft[key]}
          maxLength={1000}
          placeholder={placeholder}
          {...focusField(key)}
          onChange={(event) => {
            edit(key, event.target.value);
          }}
        />
      )}
    </Field>
  );

  return (
    <div className="flex flex-col gap-6 p-4">
      <BrandKitSource project={project} />

      <div className="flex flex-col gap-3">
        <h3 className="text-base font-semibold">Preview</h3>
        <BrandPreview brandKit={project.brandKit} logoUrl={logo?.url ?? null} />
        {!validation.ok && (
          <p role="status" className="text-sm text-signal-warn">
            The preview shows the last valid Brand Kit. Correct the marked fields to update it.
          </p>
        )}
        <div>
          <h4 className="mb-2 text-sm font-semibold text-ink-300">Readability</h4>
          <ul className="flex flex-col gap-1.5">
            {contrast.map((finding) => (
              <li key={finding.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-ink-300">{finding.label}</span>
                <span
                  className={`flex flex-none items-center gap-1.5 tabular-nums ${
                    finding.passes ? 'text-signal-ok' : 'text-signal-warn'
                  }`}
                >
                  {finding.passes ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
                  {finding.ratio.toFixed(1)} to 1, {finding.passes ? 'readable' : 'hard to read'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <form
        className="flex flex-col gap-6"
        onSubmit={(event) => {
          event.preventDefault();
        }}
      >
        <p className="text-sm text-ink-300">
          The Brand Kit is sent with every request, so generated Komas use your colours and fonts.
          Changing it does not change Komas that already exist.
        </p>

        <Field label="Brand name" error={errors['name']}>
          {(ids) => (
            <TextInput
              {...ids}
              value={draft.name}
              maxLength={120}
              {...focusField('name')}
              onChange={(event) => {
                edit('name', event.target.value);
              }}
            />
          )}
        </Field>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-base font-semibold">Colours</legend>
          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            {BRAND_COLOUR_ROLES.map((role) => {
              const parsed = parseColour(draft.colours[role]);
              return (
                <Field key={role} label={COLOUR_LABELS[role]} error={errors[`colours.${role}`]}>
                  {(ids) => (
                    <div className="flex items-center gap-2">
                      <span
                        aria-hidden="true"
                        className="size-8 flex-none rounded-md border border-desk-500"
                        style={{ background: parsed.ok ? parsed.value : 'transparent' }}
                      />
                      <TextInput
                        {...ids}
                        value={draft.colours[role]}
                        spellCheck={false}
                        placeholder="#RRGGBB"
                        {...focusField(`colours.${role}`)}
                        onChange={(event) => {
                          edit(`colours.${role}`, event.target.value);
                        }}
                      />
                    </div>
                  )}
                </Field>
              );
            })}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-base font-semibold">Fonts</legend>
          <datalist id={fontListId}>
            {FONT_SUGGESTIONS.map((font) => (
              <option key={font} value={font} />
            ))}
          </datalist>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Heading font"
              error={errors['headingFont']}
              hint="A font installed on this computer."
            >
              {(ids) => (
                <TextInput
                  {...ids}
                  list={fontListId}
                  value={draft.headingFont}
                  maxLength={120}
                  {...focusField('headingFont')}
                  onChange={(event) => {
                    edit('headingFont', event.target.value);
                  }}
                />
              )}
            </Field>
            <Field label="Body font" error={errors['bodyFont']}>
              {(ids) => (
                <TextInput
                  {...ids}
                  list={fontListId}
                  value={draft.bodyFont}
                  maxLength={120}
                  {...focusField('bodyFont')}
                  onChange={(event) => {
                    edit('bodyFont', event.target.value);
                  }}
                />
              )}
            </Field>
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-base font-semibold">Logo</legend>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" disabled={selectingLogo} onClick={() => void chooseLogo()}>
              {logo === null ? 'Choose a logo' : 'Replace the logo'}
            </Button>
            {project.brandKit.logoAssetId !== null && (
              <Button
                onClick={() => {
                  apply(changeLogo(null));
                }}
              >
                Remove the logo
              </Button>
            )}
            <span className="max-w-full truncate text-sm text-ink-400">
              {logo?.name ?? 'PNG, JPEG, WebP or GIF, up to 2 MB'}
            </span>
          </div>
          <p className="text-sm text-ink-400">
            The image is copied into the project, and into your library when you save the kit there.
            Koma Motion does not remember where the file came from.
          </p>
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-2 text-base font-semibold">Voice and style</legend>
          {textField('tone', 'Tone', 'For example: calm, precise, a little playful')}
          {textField(
            'visualStyle',
            'Visual style',
            'For example: generous space, geometric shapes',
          )}
          {textField('iconStyle', 'Icon style', 'For example: outlined, rounded corners')}
          {textField(
            'preferredImagery',
            'Preferred imagery',
            'For example: abstract diagrams, no stock photos',
          )}
          <Field
            label="Preferred topics"
            error={errors['preferredTopics']}
            hint="Separate topics with commas."
          >
            {(ids) => (
              <TextInput
                {...ids}
                value={draft.preferredTopics}
                {...focusField('preferredTopics')}
                onChange={(event) => {
                  edit('preferredTopics', event.target.value);
                }}
              />
            )}
          </Field>
          <Field label="Reference notes" error={errors['referenceNotes']}>
            {(ids) => (
              <TextArea
                {...ids}
                rows={4}
                value={draft.referenceNotes}
                maxLength={5000}
                placeholder="Anything else a designer should know about the brand"
                {...focusField('referenceNotes')}
                onChange={(event) => {
                  edit('referenceNotes', event.target.value);
                }}
              />
            )}
          </Field>
        </fieldset>
      </form>
    </div>
  );
}
