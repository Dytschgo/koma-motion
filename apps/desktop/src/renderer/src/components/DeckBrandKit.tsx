import { useEffect, useRef, useState, type ReactElement } from 'react';
import { BRAND_COLOUR_ROLES, brandKitSchema, type BrandKit } from '@koma-motion/core';
import { savedBrandKitNameSchema } from '@koma-motion/brand-kit';
import type { DeckProgress, DeckProposal, PreparedDeck } from '../../../shared/deckAnalysis';
import { invoke, subscribe } from '../lib/api';
import { useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { Button, Field, Modal, Select, TextArea, TextInput } from './ui';
import { BrandPreview } from './BrandKitEditor';

const descriptions = [
  ['tone', 'Tone'],
  ['visualStyle', 'Visual style'],
  ['iconStyle', 'Icon style'],
  ['preferredImagery', 'Preferred imagery'],
  ['referenceNotes', 'Reference notes'],
] as const;

export function DeckBrandKit({ onClose }: { readonly onClose: () => void }): ReactElement {
  const [sessionId] = useState(() => crypto.randomUUID());
  const alive = useRef(true);
  const [deck, setDeck] = useState<PreparedDeck | null>(null);
  const [result, setResult] = useState<DeckProposal | null>(null);
  const [draft, setDraft] = useState<BrandKit | null>(null);
  const [name, setName] = useState('');
  const [topics, setTopics] = useState('');
  const [logo, setLogo] = useState<string | null>(null);
  const [provider, setProvider] = useState<'claude-code' | 'mock'>('claude-code');
  const [capabilities, setCapabilities] = useState<Awaited<
    ReturnType<typeof getCapabilities>
  > | null>(null);
  const [progress, setProgress] = useState<DeckProgress | null>(null);
  const [busy, setBusy] = useState<'preparing' | 'analyzing' | 'saving' | null>(null);
  const [error, setError] = useState('');
  const [started, setStarted] = useState(0);
  const [elapsed, setElapsed] = useState(0);

  useEffect(() => {
    alive.current = true;
    const unsubscribe = subscribe('koma:deck:progress', (event) => {
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
      void invoke('koma:deck:cancel', { sessionId }).catch(() => undefined);
    };
  }, [sessionId]);
  useEffect(() => {
    if (busy === null) return;
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [busy, started]);

  const close = (): void => {
    if (busy === 'saving') return;
    alive.current = false;
    void invoke('koma:deck:cancel', { sessionId })
      .catch(() => undefined)
      .finally(onClose);
  };
  const begin = (phase: 'preparing' | 'analyzing' | 'saving') => {
    setError('');
    setBusy(phase);
    setStarted(Date.now());
    setElapsed(0);
  };
  const select = async (): Promise<void> => {
    begin('preparing');
    try {
      const response = await invoke('koma:deck:prepare', { sessionId });
      if (!alive.current) return;
      if (response.status === 'prepared') setDeck(response.deck);
      else if (response.status === 'failed') setError(response.message);
    } catch {
      if (alive.current)
        setError('The selected deck could not be prepared. Retry with a PDF or PPTX.');
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const analyze = async (): Promise<void> => {
    begin('analyzing');
    try {
      const response = await invoke('koma:deck:analyze', { sessionId, provider, consent: true });
      if (!alive.current) return;
      if (response.status === 'proposed') {
        setResult(response);
        setDraft(response.proposal.brandKit);
        setName(response.proposal.brandKit.name || 'Brand Kit from deck');
        setTopics(response.proposal.brandKit.preferredTopics.join('\n'));
      } else if (response.status === 'failed') setError(response.message);
    } catch {
      if (alive.current)
        setError('Analysis failed. No Brand Kit was saved. Retry or choose another deck.');
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const kit =
    draft === null
      ? null
      : {
          ...draft,
          preferredTopics: topics
            .split('\n')
            .map((topic) => topic.trim())
            .filter(Boolean),
        };
  const validation = kit === null ? null : brandKitSchema.safeParse(kit);
  const nameValidation = savedBrandKitNameSchema.safeParse(name);
  const save = async (): Promise<void> => {
    if (!validation?.success || !nameValidation.success) return;
    begin('saving');
    try {
      const response = await invoke('koma:deck:save', {
        sessionId,
        name: nameValidation.data,
        brandKit: validation.data,
        logoCandidateId: logo,
      });
      if (!alive.current) return;
      if (response.status === 'ready') {
        useBrandKitLibraryStore.getState().receive(response);
        if (response.kitId) useBrandKitLibraryStore.getState().select(response.kitId);
        onClose();
      } else setError(response.message);
    } catch {
      if (alive.current)
        setError(
          'The Brand Kit could not be saved. Your reviewed draft is still here; try saving again.',
        );
    } finally {
      if (alive.current) setBusy(null);
    }
  };
  const selectedLogo = deck?.logos.find((candidate) => candidate.id === logo);
  const modelLabel =
    provider === 'mock'
      ? 'Mock provider · local demonstration'
      : 'Claude Code · Opus (opus, latest alias)';
  const change = (field: keyof BrandKit, value: string) =>
    setDraft((current) => (current === null ? null : { ...current, [field]: value }));

  return (
    <Modal
      open
      title={result ? 'Review Brand Kit proposal' : 'Create Brand Kit from deck'}
      width="wide"
      onClose={close}
      footer={
        <>
          <Button variant="outline" disabled={busy === 'saving'} onClick={close}>
            {busy ? 'Cancel' : 'Close'}
          </Button>
          {!deck && (
            <Button variant="primary" disabled={busy !== null} onClick={() => void select()}>
              Choose PPTX or PDF
            </Button>
          )}
          {deck && !result && (
            <Button
              variant="primary"
              disabled={
                busy !== null ||
                capabilities === null ||
                (provider === 'claude-code' && capabilities.claude.availability !== 'available')
              }
              onClick={() => void analyze()}
            >
              {provider === 'mock' ? 'Create mock proposal' : 'Send selected content and analyze'}
            </Button>
          )}
          {result && (
            <Button
              variant="primary"
              disabled={busy !== null || !validation?.success || !nameValidation.success}
              onClick={() => void save()}
            >
              Save new Brand Kit
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-300">
          Create a reusable library entry. Your current project stays unchanged. You can apply the
          saved kit afterward.
        </p>
        {!result && (
          <>
            <p className="text-sm text-ink-300">
              PPTX needs LibreOffice installed locally. PDF processing is included. Maximum 32 MiB
              and 200 slides; up to 20 evenly spaced slides are prepared for analysis.
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
            <p className="text-sm">{modelLabel}</p>
            {provider === 'claude-code' && (
              <p className="text-sm text-ink-300">
                {capabilities?.claude.message ?? 'Checking the connected Claude Code provider…'}
              </p>
            )}
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
              {progress && progress.total > 0
                ? ` · ${progress.completed}/${progress.total} selected slides`
                : ''}
            </p>
          </div>
        )}
        {error && (
          <p role="alert" className="text-motion">
            {error}
          </p>
        )}
        {deck && (
          <>
            <p className="font-semibold">{deck.fileName}</p>
            <p className="text-sm">
              {result ? 'Analyzed' : 'Prepared'} slides:{' '}
              {deck.slides.map((slide) => slide.number).join(', ')} of {deck.totalSlides}.
            </p>
            {deck.warnings.map((warning) => (
              <p key={warning} className="text-sm text-signal-warn">
                {warning}
              </p>
            ))}
            {!result && (
              <>
                <div className="rounded-lg border border-line-strong p-3 text-sm">
                  {provider === 'claude-code' ? (
                    <p>
                      When you choose “Send selected content and analyze”, the extracted text and
                      PNG previews of the listed slides, plus {deck.logos.length} extracted logo
                      candidates, are sent to Anthropic through your existing Claude Code sign-in
                      and processed by Opus. The original deck stays local. Your current project and
                      unrelated files are not included.
                    </p>
                  ) : (
                    <p>
                      The mock provider works locally and returns a demonstration proposal. It does
                      not analyze the visual identity or send content to Anthropic.
                    </p>
                  )}
                </div>
                <details>
                  <summary className="cursor-pointer">
                    Inspect the content prepared for analysis
                  </summary>
                  <div className="mt-3 flex flex-col gap-3">
                    {deck.slides.map((slide) => (
                      <div key={slide.number}>
                        <p>Slide {slide.number}</p>
                        <img
                          alt={`Prepared slide ${slide.number}`}
                          src={`data:image/png;base64,${slide.preview}`}
                          className="w-full rounded border border-line"
                        />
                        <pre className="max-h-36 overflow-auto whitespace-pre-wrap text-xs text-ink-300">
                          {slide.text || 'No extractable text; the preview will be analyzed.'}
                        </pre>
                      </div>
                    ))}
                  </div>
                </details>
              </>
            )}
          </>
        )}
        {result && draft && (
          <>
            <p className="text-sm text-ink-300">
              {result.provider === 'mock' ? 'Mock demonstration' : 'Claude Code · Opus'} ·{' '}
              {new Date(result.analyzedAt).toLocaleString()}
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
                    <strong>
                      {evidence.field} · {evidence.confidence} confidence
                    </strong>{' '}
                    · Slides {evidence.slides.join(', ')}: {evidence.observation}
                  </li>
                ))}
              </ul>
            </details>
            <Field
              label="Library name"
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
            {validation?.success && (
              <BrandPreview
                brandKit={validation.data}
                logoUrl={selectedLogo ? `data:image/png;base64,${selectedLogo.image.data}` : null}
              />
            )}
            <div className="grid grid-cols-2 gap-3">
              {BRAND_COLOUR_ROLES.map((role) => (
                <Field key={role} label={`${role[0]?.toUpperCase()}${role.slice(1)} colour`}>
                  {(ids) => (
                    <TextInput
                      {...ids}
                      value={draft.colours[role]}
                      maxLength={7}
                      onChange={(event) =>
                        setDraft({
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
                    setDraft({
                      ...draft,
                      typography: { ...draft.typography, headingFont: event.target.value },
                    })
                  }
                />
              )}
            </Field>
            <Field label="Body font">
              {(ids) => (
                <TextInput
                  {...ids}
                  value={draft.typography.bodyFont}
                  onChange={(event) =>
                    setDraft({
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
                <TextArea
                  {...ids}
                  value={topics}
                  onChange={(event) => setTopics(event.target.value)}
                />
              )}
            </Field>
            {validation && !validation.success && (
              <p role="alert" className="text-motion">
                {validation.error.issues
                  .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
                  .join('; ')}
              </p>
            )}
            <fieldset className="flex flex-col gap-3">
              <legend className="font-semibold">Logo</legend>
              <label>
                <input
                  type="radio"
                  name="deck-logo"
                  checked={logo === null}
                  onChange={() => setLogo(null)}
                />{' '}
                No logo
              </label>
              {deck?.logos
                .filter((candidate) => candidate.id === result.proposal.logoCandidateId)
                .map((candidate) => (
                  <label
                    key={candidate.id}
                    className="flex flex-col gap-2 rounded border border-line-strong p-3"
                  >
                    <img
                      alt="Extracted logo candidate"
                      src={`data:image/png;base64,${candidate.image.data}`}
                      className="max-h-24 object-contain"
                    />
                    <span>
                      <input
                        type="radio"
                        name="deck-logo"
                        checked={logo === candidate.id}
                        onChange={() => setLogo(candidate.id)}
                      />{' '}
                      I confirm this extracted image is the brand logo
                    </span>
                  </label>
                ))}
              {result.proposal.logoCandidateId === null && (
                <p className="text-sm text-ink-300">
                  No reliable logo was identified. The kit can be saved without one.
                </p>
              )}
            </fieldset>
          </>
        )}
      </div>
    </Modal>
  );
}
async function getCapabilities() {
  return invoke('koma:deck:capabilities', {});
}
