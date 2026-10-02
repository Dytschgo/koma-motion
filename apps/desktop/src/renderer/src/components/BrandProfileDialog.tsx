import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { savedBrandKitNameSchema } from '@koma-motion/brand-kit';
import {
  MAX_SYSTEM_INSTRUCTIONS_LENGTH,
  systemInstructionsSchema,
  type BrandKit,
} from '@koma-motion/core';
import type {
  BrandProfileProgress,
  BrandProfileProposal,
  PreparedMaterial,
} from '../../../shared/brandProfile';
import { invoke, subscribe } from '../lib/api';
import { applyBrandProfileToProject } from '../lib/brandProfileActions';
import { confirmReplacingBrandKitDraft } from '../lib/brandKitLibraryActions';
import { useAgentStore } from '../state/agentStore';
import { useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { useUiStore } from '../state/uiStore';
import { BrandKitProposalFields, validateProposalDraft } from './BrandKitProposalFields';
import { Button, Field, Modal, Select, TextArea, TextInput } from './ui';

const FILE_KINDS = { image: 'Image', pdf: 'PDF', pptx: 'PowerPoint' } as const;

/** Where an exhibit comes from, in words the user knows: the file name and its slide. */
function describeExhibit(material: PreparedMaterial, number: number): string {
  const exhibit = material.exhibits.find((candidate) => candidate.number === number);
  const file = material.files.find((candidate) => candidate.file === exhibit?.file);
  if (exhibit === undefined || file === undefined) return `item ${String(number)}`;
  return exhibit.page === null ? file.name : `${file.name}, slide ${String(exhibit.page)}`;
}

/**
 * Discloses what will be sent, runs the analysis, and lets the user review
 * and edit the proposed Brand Kit and project instructions before anything
 * is saved or applied. Closing it never changes the project.
 */
export function BrandProfileDialog({
  material,
  projectSession,
  onClose,
  onFinished,
}: {
  readonly material: PreparedMaterial;
  readonly projectSession: number;
  /** Closes the dialog and keeps the attached material. */
  readonly onClose: () => void;
  /** The draft was saved, applied or discarded: the attached material is gone. */
  readonly onFinished: () => void;
}): ReactElement {
  const { sessionId } = material;
  const alive = useRef(true);
  const [result, setResult] = useState<BrandProfileProposal | null>(null);
  const [draft, setDraft] = useState<BrandKit | null>(null);
  const [name, setName] = useState('');
  const [topics, setTopics] = useState('');
  const [instructions, setInstructions] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [provider, setProvider] = useState<'claude-code' | 'mock'>('claude-code');
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<typeof getCapabilities>
  > | null>(null);
  const [progress, setProgress] = useState<BrandProfileProgress | null>(null);
  const [busy, setBusy] = useState<'analyzing' | 'saving' | null>(null);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const generating = useAgentStore((state) => state.execution !== null);
  const kitHeading = useId();
  const instructionsHeading = useId();

  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribe('koma:brand-profile:progress', (event) => {
      if (event.sessionId === sessionId && alive.current) setProgress(event);
    });
    void getCapabilities()
      .then((value) => {
        if (alive.current) setCapabilities(value);
      })
      .catch(() => {
        if (alive.current)
          setError(
            'The connected Claude provider could not be checked. Close this window and retry.',
          );
      });
    return () => {
      alive.current = false;
      unsubscribe();
    };
  }, [sessionId]);
  useEffect(() => {
    if (busy === null) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy, started]);

  const begin = (phase: 'analyzing' | 'saving') => {
    setError('');
    setBusy(phase);
    setStarted(Date.now());
    setElapsed(0);
  };
  const notify = useUiStore.getState().notify;

  const discard = (): void => {
    alive.current = false;
    void invoke('koma:brand-profile:cancel', { sessionId, scope: 'draft' })
      .catch(() => undefined)
      .finally(onFinished);
  };
  const close = async (): Promise<void> => {
    if (busy === 'saving') return;
    if (busy === 'analyzing') {
      // Stops the provider run. The attached files stay; no proposal is kept.
      await invoke('koma:brand-profile:cancel', { sessionId, scope: 'analysis' }).catch(
        () => undefined,
      );
      return;
    }
    if (result === null) {
      onClose();
      return;
    }
    const confirmed = await useUiStore.getState().confirm({
      title: 'Discard this proposal?',
      message:
        'The proposed Brand Kit, the instructions and your edits are discarded. Nothing was saved or applied, and your project is unchanged.',
      confirmLabel: 'Discard proposal',
      cancelLabel: 'Keep reviewing',
      destructive: true,
    });
    if (confirmed) discard();
  };

  const analyze = async (): Promise<void> => {
    begin('analyzing');
    try {
      const response = await invoke('koma:brand-profile:analyze', {
        sessionId,
        provider,
        consent: true,
      });
      if (!alive.current) return;
      if (response.status === 'proposed') {
        setResult(response);
        setDraft(response.proposal.brandKit);
        setName(response.proposal.brandKit.name || 'Brand profile');
        setTopics(response.proposal.brandKit.preferredTopics.join('\n'));
        setInstructions(response.proposal.instructions);
      } else if (response.status === 'failed') setError(response.message);
      else setError('Analysis was cancelled. Nothing was saved or applied.');
    } catch {
      if (alive.current)
        setError('Analysis failed. Nothing was saved or applied. Retry the analysis.');
    } finally {
      if (alive.current) {
        setBusy(null);
        setProgress(null);
      }
    }
  };

  const validation = draft === null ? null : validateProposalDraft(draft, topics);
  const nameValidation = savedBrandKitNameSchema.safeParse(name);
  const instructionsValidation = systemInstructionsSchema.safeParse(instructions);
  const selectedLogo = material.logos.find((candidate) => candidate.id === logo);
  const reviewed =
    validation?.success && instructionsValidation.success
      ? {
          brandKit: validation.data,
          logo: selectedLogo?.image ?? null,
          instructions: instructionsValidation.data,
        }
      : null;

  const apply = (savedName: string | null): void => {
    if (reviewed === null) return;
    const outcome = applyBrandProfileToProject(projectSession, reviewed);
    if (outcome.status === 'failed') {
      if (savedName === null) {
        setError(outcome.message);
        return;
      }
      // Saved but not applied: say both, and where the saved profile can be applied.
      notify(
        'error',
        `"${savedName}" was saved to your Brand Kit library, but it was not applied. ${outcome.message} Apply it from the Brand Kit library when you are ready.`,
      );
      onFinished();
      return;
    }
    notify(
      'info',
      outcome.status === 'unchanged'
        ? 'This project already uses this Brand Kit and these instructions.'
        : savedName === null
          ? 'Applied the Brand Kit and instructions to this project. Use Undo to go back. They were not saved to the library.'
          : `Saved "${savedName}" and applied its Brand Kit and instructions to this project. Use Undo to go back.`,
    );
    if (savedName === null) discard();
    else onFinished();
  };

  const save = async (thenApply: boolean): Promise<void> => {
    if (reviewed === null || !nameValidation.success) return;
    if (thenApply && !(await confirmReplacingBrandKitDraft())) return;
    begin('saving');
    try {
      const response = await invoke('koma:brand-profile:save', {
        sessionId,
        name: nameValidation.data,
        brandKit: reviewed.brandKit,
        instructions: reviewed.instructions,
        logoCandidateId: logo,
      });
      if (response.status === 'ready') {
        // The library changed even if this dialog is gone by now.
        useBrandKitLibraryStore.getState().receive(response);
        if (!alive.current)
          notify('info', `Saved "${nameValidation.data}" to your Brand Kit library.`);
      }
      if (!alive.current) return;
      if (response.status !== 'ready') {
        // Nothing was saved, so nothing is applied either. The draft stays for a retry.
        setError(
          `${response.message}${thenApply ? ' The project was not changed. Retry, or apply without saving.' : ''}`,
        );
        return;
      }
      if (response.kitId) useBrandKitLibraryStore.getState().select(response.kitId);
      if (thenApply) {
        apply(nameValidation.data);
        return;
      }
      notify(
        'info',
        `Saved "${nameValidation.data}" with its instructions to your Brand Kit library. This project was not changed.`,
      );
      onFinished();
    } catch {
      if (alive.current)
        setError(
          'The brand profile could not be saved. Your reviewed draft is still here; try saving again.',
        );
    } finally {
      if (alive.current) setBusy(null);
    }
  };

  const claudeUnavailable =
    provider === 'claude-code' &&
    capabilities !== null &&
    capabilities.claude.availability !== 'available';
  const modelLabel =
    provider === 'mock'
      ? 'Mock provider · local demonstration'
      : 'Claude Code · Opus (opus, latest alias)';
  const extractedLogos = material.logos.filter(
    (candidate) => material.files.find((file) => file.file === candidate.file)?.kind !== 'image',
  ).length;
  const textLength = material.exhibits.reduce((total, exhibit) => total + exhibit.text.length, 0);

  return (
    <Modal
      open
      title={result ? 'Review Brand Kit and instructions' : 'Create Brand Kit and instructions'}
      width="wide"
      onClose={() => void close()}
      footer={
        <>
          <Button variant="outline" disabled={busy === 'saving'} onClick={() => void close()}>
            {busy === 'analyzing' ? 'Cancel analysis' : result ? 'Discard' : 'Close'}
          </Button>
          {!result && (
            <Button
              variant="primary"
              disabled={busy !== null || capabilities === null || claudeUnavailable}
              onClick={() => void analyze()}
            >
              {provider === 'mock' ? 'Create mock proposal' : 'Send listed content and analyze'}
            </Button>
          )}
          {result && (
            <>
              <Button
                variant="outline"
                disabled={busy !== null || reviewed === null || generating}
                onClick={() =>
                  void confirmReplacingBrandKitDraft().then((confirmed) => {
                    if (confirmed && alive.current) apply(null);
                  })
                }
              >
                Apply without saving
              </Button>
              <Button
                variant="outline"
                disabled={busy !== null || reviewed === null || !nameValidation.success}
                onClick={() => void save(false)}
              >
                Save to library
              </Button>
              <Button
                variant="primary"
                disabled={
                  busy !== null || reviewed === null || !nameValidation.success || generating
                }
                onClick={() => void save(true)}
              >
                Save and apply
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {!result && (
          <>
            <p className="text-sm text-ink-300">
              The selected agent proposes a Brand Kit and matching project instructions from the
              files below. You review and edit both before anything is saved or applied. Until then
              your project stays unchanged.
            </p>
            <Field label="Analysis provider and model">
              {(ids) => (
                <Select
                  {...ids}
                  value={provider}
                  disabled={busy !== null}
                  onChange={(event) =>
                    setProvider(event.target.value === 'mock' ? 'mock' : 'claude-code')
                  }
                >
                  <option value="claude-code">Claude Code · Opus (latest)</option>
                  {capabilities?.allowMock && (
                    <option value="mock">Mock provider · local demonstration</option>
                  )}
                </Select>
              )}
            </Field>
            {provider === 'claude-code' &&
              (claudeUnavailable ? (
                <p role="alert" className="text-sm text-signal-warn">
                  Claude Code is not available, so the analysis cannot run:{' '}
                  {capabilities.claude.message} No other provider is used in its place. Install or
                  sign in to Claude Code, then reopen this window.
                </p>
              ) : (
                <p className="text-sm text-ink-300">
                  {capabilities?.claude.message ?? 'Checking the connected Claude Code provider…'}
                </p>
              ))}
          </>
        )}
        {busy && (
          <div role="status" className="rounded-lg border border-accent p-3">
            <p>
              {busy === 'saving'
                ? 'Saving to the Brand Kit library'
                : (progress?.message ?? 'Preparing analysis')}
            </p>
            <p className="text-sm text-ink-300">
              {modelLabel} · {elapsed}s elapsed
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-motion">
            {error}
          </p>
        )}
        {!result && (
          <>
            <div>
              <p className="font-semibold">
                {material.files.length === 1 ? '1 file' : `${String(material.files.length)} files`}{' '}
                · {String(material.exhibits.length)} prepared{' '}
                {material.exhibits.length === 1 ? 'item' : 'items'}
              </p>
              <ul aria-label="Files to analyze" className="mt-1 flex flex-col gap-1 text-sm">
                {material.files.map((file) => {
                  const pages = material.exhibits.filter((exhibit) => exhibit.file === file.file);
                  return (
                    <li key={file.file}>
                      {file.name} · {FILE_KINDS[file.kind]}
                      {file.kind === 'image'
                        ? ' · 1 preview'
                        : ` · slides ${pages.map((exhibit) => String(exhibit.page)).join(', ')} of ${String(file.total)}`}
                    </li>
                  );
                })}
              </ul>
            </div>
            {material.warnings.map((warning) => (
              <p key={warning} className="text-sm text-signal-warn">
                {warning}
              </p>
            ))}
            <div className="rounded-lg border border-line-strong p-3 text-sm">
              {provider === 'claude-code' ? (
                <p>
                  When you choose “Send listed content and analyze”, the{' '}
                  {String(material.exhibits.length)} prepared previews listed above
                  {textLength > 0
                    ? `, the ${textLength.toLocaleString()} characters of text extracted from them`
                    : ''}
                  {extractedLogos > 0
                    ? ` and ${String(extractedLogos)} extracted logo candidates`
                    : ''}{' '}
                  are sent to Anthropic through your existing Claude Code sign-in and processed by
                  Opus. File names, file paths and the original files stay on this computer. Your
                  current project and other files are not included.
                </p>
              ) : (
                <p>
                  The mock provider works locally and returns a demonstration proposal. It does not
                  analyze your files or send content to Anthropic.
                </p>
              )}
            </div>
            <details>
              <summary className="cursor-pointer">
                Inspect the content prepared for analysis
              </summary>
              <div className="mt-3 flex flex-col gap-3">
                {material.exhibits.map((exhibit) => (
                  <div key={exhibit.number}>
                    <p>{describeExhibit(material, exhibit.number)}</p>
                    <img
                      alt={`Prepared preview of ${describeExhibit(material, exhibit.number)}`}
                      src={`data:${exhibit.mediaType};base64,${exhibit.preview}`}
                      className="max-h-80 rounded border border-line object-contain"
                    />
                    <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-xs text-ink-300">
                      {exhibit.text || 'No extracted text; only the preview is analyzed.'}
                    </pre>
                  </div>
                ))}
              </div>
            </details>
          </>
        )}
        {result && draft && (
          <>
            <p className="text-sm text-ink-300">
              {result.provider === 'mock' ? 'Mock demonstration' : 'Claude Code · Opus'} ·{' '}
              {new Date(result.analyzedAt).toLocaleString()} · from{' '}
              {material.files.map((file) => file.name).join(', ')}
            </p>
            <p className="text-sm text-ink-300">
              This is a proposal drawn from your files, not verified brand facts. Check it against
              the evidence below and correct it before you save or apply it.
            </p>
            {result.proposal.warnings.map((warning) => (
              <p key={warning} className="text-sm text-signal-warn">
                {warning}
              </p>
            ))}
            <details open>
              <summary className="cursor-pointer font-semibold">Evidence and confidence</summary>
              <ul className="mt-2 flex flex-col gap-2 text-sm">
                {result.proposal.evidence.map((evidence, index) => (
                  <li key={index}>
                    <strong className={evidence.confidence === 'low' ? 'text-signal-warn' : ''}>
                      {evidence.field} · {evidence.confidence} confidence
                    </strong>{' '}
                    ·{' '}
                    {evidence.exhibits
                      .map((number) => describeExhibit(material, number))
                      .join('; ')}
                    : {evidence.observation}
                  </li>
                ))}
              </ul>
            </details>
            <Field
              label="Library name"
              hint="The Brand Kit and the instructions are saved together under this name."
              error={nameValidation.success ? undefined : 'Enter a name of 1–120 characters.'}
            >
              {(ids) => (
                <TextInput
                  {...ids}
                  value={name}
                  maxLength={120}
                  onChange={(event) => setName(event.target.value)}
                />
              )}
            </Field>

            <section
              aria-labelledby={kitHeading}
              className="flex flex-col gap-4 rounded-card border border-line-strong p-4"
            >
              <div>
                <h3 id={kitHeading} className="font-semibold">
                  Brand Kit
                </h3>
                <p className="text-sm text-ink-300">
                  Brand data: colours, fonts, logo and descriptions. Agents receive it as data.
                </p>
              </div>
              <BrandKitProposalFields
                draft={draft}
                onDraft={setDraft}
                topics={topics}
                onTopics={setTopics}
                logoUrl={
                  selectedLogo
                    ? `data:${selectedLogo.image.mediaType};base64,${selectedLogo.image.data}`
                    : null
                }
                fontHint={
                  result.fontsNamedInMaterial
                    ? undefined
                    : 'These fonts are not named in your files. They are a suggestion based on appearance, not an identification. Check them against your brand guidelines.'
                }
              />
              <fieldset className="flex flex-col gap-3">
                <legend className="font-semibold">Logo</legend>
                <label>
                  <input
                    type="radio"
                    name="profile-logo"
                    checked={logo === null}
                    onChange={() => setLogo(null)}
                  />{' '}
                  No logo
                </label>
                {material.logos.map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex flex-col gap-2 rounded border border-line-strong p-3"
                  >
                    <img
                      alt={`Logo candidate from ${describeExhibit(material, candidate.exhibits[0] ?? 0)}`}
                      src={`data:${candidate.image.mediaType};base64,${candidate.image.data}`}
                      className="max-h-24 object-contain"
                    />
                    <span>
                      <input
                        type="radio"
                        name="profile-logo"
                        checked={logo === candidate.id}
                        onChange={() => setLogo(candidate.id)}
                      />{' '}
                      Use the image from {describeExhibit(material, candidate.exhibits[0] ?? 0)} as
                      the logo
                      {candidate.id === result.proposal.logoCandidateId
                        ? ' (suggested by the analysis)'
                        : ''}
                    </span>
                  </label>
                ))}
                <p className="text-sm text-ink-300">
                  A logo is only used when you choose one here.
                  {result.proposal.logoCandidateId === null
                    ? ' The analysis did not identify a reliable logo.'
                    : ''}
                </p>
              </fieldset>
            </section>

            <section
              aria-labelledby={instructionsHeading}
              className="flex flex-col gap-3 rounded-card border border-line-strong p-4"
            >
              <div>
                <h3 id={instructionsHeading} className="font-semibold">
                  Project instructions
                </h3>
                <p className="text-sm text-ink-300">
                  Guidance, not data: a project that uses this profile sends this text to its agent
                  as instructions with every generation. Remove anything you do not want an agent to
                  follow.
                </p>
              </div>
              <Field
                label="Instructions for this brand"
                hint={`${instructions.length.toLocaleString()} of ${MAX_SYSTEM_INSTRUCTIONS_LENGTH.toLocaleString()} characters`}
                error={
                  instructionsValidation.success
                    ? undefined
                    : `Use at most ${MAX_SYSTEM_INSTRUCTIONS_LENGTH.toLocaleString()} characters. Your text has been kept.`
                }
              >
                {(ids) => (
                  <TextArea
                    {...ids}
                    rows={6}
                    value={instructions}
                    onChange={(event) => setInstructions(event.target.value)}
                  />
                )}
              </Field>
            </section>
            {generating && (
              <p className="text-sm text-ink-300">
                Komas are being generated. You can save now and apply when the generation has
                finished.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
async function getCapabilities() {
  return invoke('koma:deck:capabilities', {});
}
