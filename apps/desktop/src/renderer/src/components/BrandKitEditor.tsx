import {
  assessBrandKitContrast,
  FONT_SUGGESTIONS,
  toBrandKitDraft,
  validateBrandKitDraft,
  type BrandKitDraft,
} from '@koma-motion/brand-kit';
import {
  BRAND_COLOUR_ROLES,
  parseColour,
  type BrandColourRole,
  type BrandKit,
  type KomaProject,
} from '@koma-motion/core';
import { createAssetResolver } from '@koma-motion/renderer';
import { useId, useMemo, useState, type ReactElement } from 'react';
import { chooseProjectLogo } from '../lib/projectActions';
import { changeBrandKit, changeLogo } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
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
function BrandPreview({
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
      className="relative aspect-video w-full overflow-hidden rounded-lg border border-desk-600"
      style={{ background: colours.background, color: colours.text }}
    >
      <div className="absolute inset-0 flex flex-col justify-between p-[7%]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p
              className="text-[clamp(1.1rem,2.4vw,2rem)] leading-tight font-bold"
              style={{ fontFamily: `${typography.headingFont}, system-ui, sans-serif` }}
            >
              {brandKit.name.trim() === '' ? 'Your brand' : brandKit.name}
            </p>
            <p
              className="mt-2 max-w-[28ch] text-[clamp(0.7rem,1.1vw,0.95rem)] opacity-80"
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
          <div className="h-[3.2rem] w-[38%] rounded-md" style={{ background: colours.primary }} />
          <div
            className="h-[2.2rem] w-[22%] rounded-md"
            style={{ background: colours.secondary }}
          />
          <div className="size-[2.6rem] rounded-full" style={{ background: colours.accent }} />
        </div>
      </div>
    </div>
  );
}

export function BrandKitEditor({ project }: { readonly project: KomaProject }): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const setView = useUiStore((state) => state.setView);
  const fontListId = useId();

  /** Text that does not validate yet. Fields without a draft show the project. */
  const [pending, setPending] = useState<Partial<BrandKitDraft>>({});
  const [selectingLogo, setSelectingLogo] = useState(false);

  const draft: BrandKitDraft = { ...toBrandKitDraft(project.brandKit), ...pending };
  const validation = validateBrandKitDraft(draft);
  const errors = validation.ok ? {} : validation.errors;
  const contrast = useMemo(() => assessBrandKitContrast(project.brandKit), [project.brandKit]);

  const logo = useMemo(() => {
    const { logoAssetId } = project.brandKit;
    if (logoAssetId === null) {
      return null;
    }
    const resolved = createAssetResolver(project.assets)(logoAssetId);
    return resolved.status === 'available' ? resolved : null;
  }, [project.assets, project.brandKit]);

  const update = (patch: Partial<BrandKitDraft>, field: string): void => {
    const nextPending = { ...pending, ...patch };
    const next = validateBrandKitDraft({ ...toBrandKitDraft(project.brandKit), ...nextPending });
    if (next.ok) {
      // Only valid Brand Kits reach the project.
      apply(changeBrandKit(next.brandKit), { coalesceKey: `brand-kit:${field}` });
      setPending(
        // Colours keep their typed form until the field is left.
        nextPending.colours === undefined ? {} : { colours: nextPending.colours },
      );
    } else {
      setPending(nextPending);
    }
  };

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
          onChange={(event) => {
            update({ [key]: event.target.value }, key);
          }}
        />
      )}
    </Field>
  );

  return (
    <section aria-label="Brand Kit" className="flex min-h-0 min-w-0 flex-1 flex-col bg-desk-900">
      <div className="flex h-14 flex-none items-center justify-between border-b border-desk-600 px-6">
        <div>
          <h1 className="text-xl font-semibold">Brand Kit</h1>
        </div>
        <Button
          variant="outline"
          onClick={() => {
            setView('canvas');
          }}
        >
          Back to the canvas
        </Button>
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(320px,0.8fr)] gap-8 overflow-y-auto p-6">
        <form
          className="flex max-w-2xl flex-col gap-6"
          onSubmit={(event) => {
            event.preventDefault();
          }}
        >
          <p className="max-w-[62ch] text-ink-300">
            The Brand Kit is sent with every request, so generated Komas use your colours and fonts.
            Changing it does not change Komas that already exist.
          </p>

          <Field label="Brand name" error={errors['name']}>
            {(ids) => (
              <TextInput
                {...ids}
                value={draft.name}
                maxLength={120}
                onChange={(event) => {
                  update({ name: event.target.value }, 'name');
                }}
              />
            )}
          </Field>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-lg font-semibold">Colours</legend>
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
                          onChange={(event) => {
                            update(
                              { colours: { ...draft.colours, [role]: event.target.value } },
                              `colour-${role}`,
                            );
                          }}
                          onBlur={() => {
                            // Show the stored format once the field is valid and left.
                            if (validation.ok) {
                              setPending({});
                            }
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
            <legend className="mb-2 text-lg font-semibold">Fonts</legend>
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
                    onChange={(event) => {
                      update({ headingFont: event.target.value }, 'heading-font');
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
                    onChange={(event) => {
                      update({ bodyFont: event.target.value }, 'body-font');
                    }}
                  />
                )}
              </Field>
            </div>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-lg font-semibold">Logo</legend>
            <div className="flex items-center gap-3">
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
              <span className="truncate text-ink-400">
                {logo?.name ?? 'PNG, JPEG, WebP or GIF, up to 2 MB'}
              </span>
            </div>
            <p className="text-sm text-ink-400">
              The image is copied into the project. Koma Motion does not remember where the file
              came from.
            </p>
          </fieldset>

          <fieldset className="flex flex-col gap-3">
            <legend className="mb-2 text-lg font-semibold">Voice and style</legend>
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
                  onChange={(event) => {
                    setPending({ ...pending, preferredTopics: event.target.value });
                  }}
                  onBlur={() => {
                    update({ preferredTopics: draft.preferredTopics }, 'topics');
                    setPending(({ preferredTopics: _topics, ...rest }) => rest);
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
                  onChange={(event) => {
                    update({ referenceNotes: event.target.value }, 'notes');
                  }}
                />
              )}
            </Field>
          </fieldset>
        </form>

        <div className="sticky top-0 flex flex-col gap-4 self-start">
          <h2 className="text-lg font-semibold">Preview</h2>
          <BrandPreview brandKit={project.brandKit} logoUrl={logo?.url ?? null} />
          {!validation.ok && (
            <p role="status" className="text-sm text-signal-warn">
              The preview shows the last valid Brand Kit. Correct the marked fields to update it.
            </p>
          )}
          <div>
            <h3 className="mb-2 text-base font-semibold">Readability</h3>
            <ul className="flex flex-col gap-1.5">
              {contrast.map((finding) => (
                <li key={finding.id} className="flex items-center justify-between gap-3">
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
      </div>
    </section>
  );
}
