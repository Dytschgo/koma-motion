import { userRequestSchema } from '@koma-motion/agent-runtime';
import type { KomaProject } from '@koma-motion/core';
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { detectProviders, generate } from '../lib/agentActions';
import {
  CHAT_DEFAULT_WIDTH,
  CHAT_MIN_WIDTH,
  CHAT_RESIZE_STEP,
  clampChatWidth,
  type ChatLayout,
} from '../lib/chatLayout';
import { DEFAULT_KOMA_COUNT, parseKomaCount } from '../lib/composerChoices';
import { useAgentStore, type ConversationEntry, type DetectedProvider } from '../state/agentStore';
import { changeAgentConfiguration } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useReferenceStore } from '../state/referenceStore';
import { useUiStore } from '../state/uiStore';
import {
  CheckIcon,
  ChevronIcon,
  KomaMark,
  RefreshIcon,
  SendIcon,
  SettingsIcon,
  WarningIcon,
} from './icons';
import { ModelPicker, useModelChoices } from './ModelPicker';
import { CompactModelPicker } from './CompactModelPicker';
import { ProviderLogo } from './ProviderLogo';
import { RunActivity, RunMonitor } from './RunActivity';
import { ReferenceFiles, ReferenceAttachmentButton } from './ReferenceFiles';
import { ChatBrandKitPicker } from './ChatBrandKitPicker';
import { useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { Button, Help, IconButton, Select, TextInput } from './ui';

export const EXAMPLE_REQUEST =
  'Create three Komas introducing Koma Motion. Start with the complete system, focus on the motion engine, then show how the result stays editable in Koma Motion.';

const FAILURE_TITLES = {
  failed: 'Generation failed',
  cancelled: 'Generation stopped',
  timedOut: 'Generation took too long',
} as const;

function describeAvailability(provider: DetectedProvider): string {
  switch (provider.detection.availability) {
    case 'available':
      return provider.detection.version === null
        ? 'available'
        : `version ${provider.detection.version}`;
    case 'unavailable':
      return 'not installed';
    case 'error':
      return 'not working';
  }
}

function Availability({ provider }: { readonly provider: DetectedProvider }): ReactElement {
  const available = provider.detection.availability === 'available';
  return (
    <p
      role="status"
      className={`flex items-center gap-0.5 ${available ? 'text-signal-ok' : 'text-signal-warn'}`}
    >
      {available ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
      <span>{available ? 'Ready' : 'Not available'}</span>
      <Help label="Provider details">{provider.detection.message}</Help>
    </p>
  );
}

/** Text a provider wrote during a finished run, kept with its outcome. */
function KeptOutput({
  text,
  name,
}: {
  readonly text: string;
  readonly name: string;
}): ReactElement {
  return (
    <details className="mt-2 text-sm">
      <summary className="cursor-pointer text-ink-400 hover:text-ink-100">
        What {name} wrote
      </summary>
      <p className="mt-1 border-l-2 border-line-strong pl-3 leading-relaxed whitespace-pre-wrap text-ink-300">
        {text}
      </p>
    </details>
  );
}

function Entry({
  entry,
  onRetry,
}: {
  readonly entry: ConversationEntry;
  readonly onRetry: (request: string) => void;
}): ReactElement {
  if (entry.kind === 'request') {
    return (
      <li className="ml-auto flex max-w-full items-start justify-end gap-2 wrap-break-word select-text">
        <div className="max-w-[calc(100%-2rem)] whitespace-pre-wrap rounded-card rounded-tr-sm border border-line bg-surface-3 px-3.5 py-2.5 text-ink-100">
          <span className="sr-only">You asked: </span>
          {entry.text}
          {entry.referenceNames !== undefined && (
            <p className="mt-2 text-xs text-ink-400">
              References: {entry.referenceNames.join(', ')}
            </p>
          )}
        </div>
        <span
          aria-hidden="true"
          className="flex size-6 flex-none items-center justify-center rounded-full border border-line-strong bg-surface-2 text-ink-300"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
          >
            <circle cx="8" cy="5" r="2.2" />
            <path d="M3.5 13c.3-2.3 2-3.5 4.5-3.5s4.2 1.2 4.5 3.5" />
          </svg>
        </span>
      </li>
    );
  }
  if (entry.kind === 'result') {
    return (
      <li className="flex max-w-full items-start gap-2.5 wrap-break-word select-text">
        <span
          aria-hidden="true"
          className="flex size-6 flex-none items-center justify-center rounded-full border border-line bg-surface-2"
        >
          <KomaMark size={15} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="mb-1 text-xs font-medium text-ink-400">{entry.providerName}</p>
          <p className="whitespace-pre-wrap leading-relaxed">{entry.text}</p>
          {entry.output !== undefined && (
            <KeptOutput text={entry.output} name={entry.providerName} />
          )}
          {entry.warnings.length > 0 && (
            <ul className="mt-2 flex flex-col gap-1 text-sm text-signal-warn">
              {entry.warnings.map((warning, index) => (
                <li key={index} className="flex gap-2">
                  <span className="flex-none">
                    <WarningIcon size={14} />
                  </span>
                  Warning: {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      </li>
    );
  }
  if (entry.kind === 'notApplied') {
    return (
      <li className="flex max-w-full items-start gap-2.5 wrap-break-word select-text">
        <span
          aria-hidden="true"
          className="flex size-6 flex-none items-center justify-center rounded-full border border-line bg-surface-2"
        >
          <KomaMark size={15} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="mb-1 text-xs text-ink-400">{entry.providerName}</p>
          <p className="font-semibold">Generated Komas were not applied</p>
          <p>{entry.text}</p>
          <p className="mt-2 text-sm text-ink-400">Your edits remain in the presentation.</p>
          {entry.output !== undefined && (
            <KeptOutput text={entry.output} name={entry.providerName} />
          )}
        </div>
      </li>
    );
  }
  const { error, diagnostics } = entry;
  const lastAttempt = diagnostics.attempts.at(-1);
  return (
    <li
      role="alert"
      className="max-w-full rounded-lg border-l-2 border-motion/70 py-1 pl-3 wrap-break-word select-text"
    >
      <p className="text-sm text-ink-400">{entry.providerName}</p>
      <p className="font-semibold text-motion">{FAILURE_TITLES[entry.status]}</p>
      <p className="whitespace-pre-wrap">{error.message.split('\n')[0]}</p>
      {error.issues.length > 0 && (
        <ul className="mt-2 list-disc pl-5 text-sm text-ink-300">
          {error.issues.slice(0, 8).map((issue, index) => (
            <li key={index}>
              {issue.path}: {issue.message}
            </li>
          ))}
          {error.issues.length > 8 && <li>and {error.issues.length - 8} more</li>}
        </ul>
      )}
      <p className="mt-2 text-sm text-ink-400">Your presentation was not changed.</p>
      {entry.output !== undefined && <KeptOutput text={entry.output} name={entry.providerName} />}
      <details className="mt-1 text-sm text-ink-400">
        <summary className="cursor-pointer hover:text-ink-100">Diagnostics</summary>
        <dl className="mt-1 grid grid-cols-[auto_minmax(0,1fr)] gap-x-3">
          <dt>Error code</dt>
          <dd>{error.code}</dd>
          <dt>Duration</dt>
          <dd>{(diagnostics.durationMs / 1000).toFixed(1)} s</dd>
          <dt>Attempts</dt>
          <dd>{diagnostics.attempts.length}</dd>
          {lastAttempt?.exitCode != null && (
            <>
              <dt>Exit code</dt>
              <dd>{lastAttempt.exitCode}</dd>
            </>
          )}
          {lastAttempt !== undefined && lastAttempt.errorOutput !== '' && (
            <>
              <dt>Error output</dt>
              <dd className="min-w-0 whitespace-pre-wrap">{lastAttempt.errorOutput}</dd>
            </>
          )}
        </dl>
      </details>
      <Button
        variant="outline"
        className="mt-2"
        onClick={() => {
          onRetry(entry.request);
        }}
      >
        Try again
      </Button>
    </li>
  );
}

/**
 * The vertical divider on the left edge of the chat. It is a focusable window
 * splitter: drag it, or use the arrow keys, Home and End. Double-click
 * restores the default width.
 */
function ResizeHandle({
  width,
  maxWidth,
  controls,
  onResize,
}: {
  readonly width: number;
  readonly maxWidth: number;
  readonly controls: string;
  readonly onResize: (width: number) => void;
}): ReactElement {
  const drag = useRef<{ pointerId: number; startX: number; startWidth: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const resize = (next: number): void => {
    onResize(clampChatWidth(next, maxWidth));
  };
  const endDrag = (): void => {
    drag.current = null;
    setDragging(false);
  };

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label="Resize the chat"
      aria-controls={controls}
      aria-valuemin={CHAT_MIN_WIDTH}
      aria-valuemax={maxWidth}
      aria-valuenow={width}
      aria-valuetext={`${String(width)} pixels wide`}
      tabIndex={0}
      title="Drag to resize the chat. Double-click to restore the default width."
      data-dragging={dragging ? '' : undefined}
      className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none focus-visible:outline-none"
      onPointerDown={(event) => {
        if (event.button !== 0) {
          return;
        }
        // Keeps the drag from selecting text in the conversation.
        event.preventDefault();
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { pointerId: event.pointerId, startX: event.clientX, startWidth: width };
        setDragging(true);
      }}
      onPointerMove={(event) => {
        const current = drag.current;
        if (current?.pointerId === event.pointerId) {
          // The chat is on the right: moving the divider left makes it wider.
          resize(current.startWidth + current.startX - event.clientX);
        }
      }}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
      onDoubleClick={() => {
        resize(CHAT_DEFAULT_WIDTH);
      }}
      onKeyDown={(event) => {
        const step = CHAT_RESIZE_STEP * (event.shiftKey ? 4 : 1);
        const next =
          event.key === 'ArrowLeft'
            ? width + step
            : event.key === 'ArrowRight'
              ? width - step
              : event.key === 'Home'
                ? CHAT_MIN_WIDTH
                : event.key === 'End'
                  ? maxWidth
                  : null;
        if (next !== null) {
          event.preventDefault();
          resize(next);
        }
      }}
    >
      <span
        aria-hidden="true"
        className={
          'pointer-events-none absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 transition-colors ' +
          'group-hover:bg-line-strong group-focus-visible:w-1 group-focus-visible:bg-accent ' +
          'group-data-dragging:bg-accent'
        }
      />
    </div>
  );
}

export function AgentPanel({
  project,
  layout,
}: {
  readonly project: KomaProject;
  readonly layout: ChatLayout;
}): ReactElement {
  const providers = useAgentStore((state) => state.providers);
  const detection = useAgentStore((state) => state.detection);
  const execution = useAgentStore((state) => state.execution);
  const lastRun = useAgentStore((state) => state.lastRun);
  const [monitorOpen, setMonitorOpen] = useState(false);
  const conversation = useAgentStore((state) => state.conversation);
  const apply = useProjectStore((state) => state.apply);
  const sessionId = useProjectStore((state) => state.sessionId);
  const referenceState = useReferenceStore();
  const references = referenceState.sessionId === sessionId ? referenceState.references : [];
  const [referenceConsent, setReferenceConsent] = useState<string | null>(null);
  const open = useUiStore((state) => state.agentPanelOpen);
  const setOpen = useUiStore((state) => state.setAgentPanelOpen);
  const setWidth = useUiStore((state) => state.setAgentPanelWidth);
  const openSettings = useUiStore((state) => state.openSettings);

  const [request, setRequest] = useState('');
  const [komaCount, setKomaCount] = useState(String(DEFAULT_KOMA_COUNT));
  const [autoKomaCount, setAutoKomaCount] = useState(false);
  const [choice, setChoice] = useState<'model' | 'count' | 'brand' | null>(null);
  const count = parseKomaCount(autoKomaCount, komaCount);
  const validCount = count !== undefined;
  const requestValidation = userRequestSchema.safeParse(request);
  const requestError =
    request.trim() === '' || requestValidation.success
      ? undefined
      : requestValidation.error.issues[0]?.message;
  const bodyId = useId();
  const requestId = useId();
  const requestErrorId = useId();
  const providerId = useId();
  const countId = useId();
  const countErrorId = useId();
  const modelChoicesId = useId();
  const countChoicesId = useId();
  const section = useRef<HTMLElement>(null);
  const header = useRef<HTMLDivElement>(null);
  const composer = useRef<HTMLFormElement>(null);
  const [pickerMaxHeight, setPickerMaxHeight] = useState<number>();
  const log = useRef<HTMLDivElement>(null);
  const requestField = useRef<HTMLTextAreaElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  const modelButton = useRef<HTMLButtonElement>(null);
  const countButton = useRef<HTMLButtonElement>(null);
  const choicesPanel = useRef<HTMLDivElement>(null);
  const wasOpen = useRef(open);
  /** Whether the conversation is scrolled to its end. */
  const following = useRef(true);
  const choiceProject = useRef(project.id);

  const selectedId = project.agentConfiguration.selectedProviderId;
  const selected = providers.find((provider) => provider.metadata.id === selectedId);
  const available = selected?.detection.availability === 'available';
  const models = useModelChoices(project, selected);
  const providerName = selected?.metadata.displayName ?? selectedId;
  const running = execution !== null;
  const brandBusy = useBrandKitLibraryStore((state) => state.busy);
  const trimmed = request.trim();
  const consentKey = `${String(sessionId)}:${selectedId}:${references.map((reference) => reference.id).join(',')}`;
  const needsReferenceConsent =
    references.length > 0 && selected?.metadata.usesExternalService === true;
  const referencesReady =
    !referenceState.selecting && (!needsReferenceConsent || referenceConsent === consentKey);
  const canSubmit =
    trimmed !== '' &&
    requestValidation.success &&
    validCount &&
    !running &&
    !brandBusy &&
    available &&
    referencesReady;

  useEffect(() => {
    if (!open || choiceProject.current !== project.id) {
      setChoice(null);
    }
    choiceProject.current = project.id;
  }, [open, project.id]);

  // A long request in a short window leaves less room above the composer.
  // Bound the popup to that actual space so it never covers the chat header.
  useLayoutEffect(() => {
    if (choice === null || composer.current === null || header.current === null) return;
    const measure = (): void => {
      const top = composer.current?.getBoundingClientRect().top;
      const bottom = header.current?.getBoundingClientRect().bottom;
      if (top !== undefined && bottom !== undefined) {
        setPickerMaxHeight(Math.max(64, Math.floor(top - bottom - 12)));
      }
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(composer.current);
    if (section.current !== null) observer.observe(section.current);
    return () => observer.disconnect();
  }, [choice]);

  useEffect(() => {
    if (choice === null || choice === 'brand') return;
    const trigger = choice === 'model' ? modelButton.current : countButton.current;
    choicesPanel.current
      ?.querySelector<HTMLElement>(
        choice === 'model'
          ? 'input[type="search"]:not(:disabled)'
          : 'select:not(:disabled), input:not(:disabled), button:not(:disabled)',
      )
      ?.focus();
    const dismiss = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !trigger?.contains(event.target) &&
        !choicesPanel.current?.contains(event.target)
      ) {
        setChoice(null);
      }
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [choice]);

  useEffect(() => {
    // Scrolls the conversation only, never the window around it. A new
    // entry always scrolls; see the effect below for growing output.
    if (open && log.current !== null) {
      log.current.scrollTop = log.current.scrollHeight;
      following.current = true;
    }
  }, [open, conversation.length]);

  useEffect(() => {
    // Growing output and new phases follow only while the person is at the
    // bottom, so reading earlier text is not interrupted.
    if (open && log.current !== null && following.current) {
      log.current.scrollTop = log.current.scrollHeight;
    }
  }, [open, execution?.events.length, execution?.output.text]);

  // Opening moves focus to the request. Closing moves it to the control that
  // opens the chat again, so focus is never lost in the hidden panel.
  useEffect(() => {
    if (wasOpen.current === open) {
      return;
    }
    wasOpen.current = open;
    if (open) {
      requestField.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (active === null || active === document.body || section.current?.contains(active)) {
      showButton.current?.focus();
    }
  }, [open]);

  const submit = (text: string): void => {
    if (
      !userRequestSchema.safeParse(text).success ||
      count === undefined ||
      running ||
      brandBusy ||
      !available ||
      !referencesReady
    ) {
      return;
    }
    setRequest('');
    setReferenceConsent(null);
    void generate({
      userRequest: text.trim(),
      objective: null,
      // The agent infers the audience from the request.
      audience: null,
      requestedKomaCount: count,
      ...(references.length > 0 ? { references: [...references] } : {}),
    });
  };

  return (
    <section
      ref={section}
      aria-label="Agent chat"
      className="chat-panel relative flex min-h-0 flex-none flex-col border-l border-line bg-surface-2"
      style={open ? { width: layout.width } : undefined}
    >
      {open ? (
        <ResizeHandle
          width={layout.width}
          maxWidth={layout.maxWidth}
          controls={bodyId}
          onResize={setWidth}
        />
      ) : (
        // The panel stays mounted while it is closed, so an unsent request is kept.
        <button
          ref={showButton}
          type="button"
          aria-label={running ? 'Show the chat. Komas are being generated.' : 'Show the chat'}
          aria-expanded={false}
          aria-controls={bodyId}
          title="Show the chat"
          className="flex w-11 flex-col items-center gap-3 py-3 text-ink-300 transition-colors hover:bg-surface-3 hover:text-ink-100"
          onClick={() => {
            setOpen(true);
          }}
        >
          <ChevronIcon direction="left" />
          <span aria-hidden="true" className="rotate-180 font-semibold [writing-mode:vertical-rl]">
            Chat
          </span>
          {running && (
            <span
              aria-hidden="true"
              className="working-dot size-2 flex-none rounded-full bg-motion"
            />
          )}
        </button>
      )}

      <div id={bodyId} hidden={!open} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div
          ref={header}
          data-testid="chat-header"
          className="flex h-11 flex-none flex-col justify-center border-b border-line bg-surface-1 pr-1.5 pl-3.5"
        >
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 text-base font-semibold">Chat</h2>
            <IconButton
              label="Instructions & templates"
              aria-description={
                project.systemInstructions.trim() === ''
                  ? 'No project instructions'
                  : 'Instructions active'
              }
              title={
                project.systemInstructions.trim() === ''
                  ? 'Instructions & templates'
                  : 'Instructions active · Instructions & templates'
              }
              className="relative"
              onClick={() => openSettings('instructions')}
            >
              <SettingsIcon />
              {project.systemInstructions.trim() !== '' && (
                <span
                  className="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-accent"
                  aria-hidden="true"
                />
              )}
            </IconButton>
            <IconButton
              label="Check again"
              disabled={detection === 'running' || running}
              onClick={() => void detectProviders()}
            >
              <RefreshIcon />
            </IconButton>
            <IconButton
              label="Hide the chat"
              aria-expanded={open}
              aria-controls={bodyId}
              onClick={() => {
                setOpen(false);
              }}
            >
              <ChevronIcon direction="right" />
            </IconButton>
          </div>
        </div>

        <div
          ref={log}
          role="log"
          aria-label="Conversation"
          className="flex min-h-32 flex-1 flex-col overflow-y-auto bg-surface-2 px-4 py-5"
          onScroll={(event) => {
            const element = event.currentTarget;
            following.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 48;
          }}
        >
          {conversation.length === 0 && !running ? (
            <div className="m-auto flex max-w-48 flex-col items-center text-center text-ink-300">
              <p>
                {selectedId === 'mock'
                  ? 'Try the three-Koma demo.'
                  : 'What would you like to present?'}
              </p>
              <Button
                variant="outline"
                className="mt-3"
                onClick={() => {
                  setRequest(EXAMPLE_REQUEST);
                }}
              >
                Use the example request
              </Button>
            </div>
          ) : (
            <ol className="flex flex-col gap-6">
              {conversation.map((entry) => (
                <Entry
                  key={entry.id}
                  entry={entry}
                  onRetry={(text) => {
                    submit(text);
                  }}
                />
              ))}
            </ol>
          )}
          {execution !== null ? (
            <RunActivity run={execution} onOpenMonitor={() => setMonitorOpen(true)} />
          ) : (
            lastRun !== null && (
              <RunActivity run={lastRun} onOpenMonitor={() => setMonitorOpen(true)} />
            )
          )}
        </div>

        <RunMonitor
          run={execution ?? lastRun}
          open={monitorOpen}
          onClose={() => setMonitorOpen(false)}
        />

        <form
          ref={composer}
          className="relative flex min-h-0 flex-none flex-col gap-2 overflow-visible bg-surface-2 px-3 pt-2 pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit(request);
          }}
        >
          <div className="relative flex flex-col gap-2 rounded-card border border-line-strong bg-surface-1 p-2 shadow-raised transition-[border-color,box-shadow] duration-150 focus-within:border-accent/70 focus-within:shadow-[0_0_0_3px_rgb(124_196_232/0.12)]">
            <label htmlFor={requestId} className="sr-only">
              Your request
            </label>
            <textarea
              id={requestId}
              ref={requestField}
              rows={1}
              className="min-h-16 max-h-36 w-full min-w-0 field-sizing-content resize-none bg-transparent px-2 py-2 text-ink-100 placeholder:text-ink-400 focus-visible:outline-none"
              aria-invalid={requestError === undefined ? undefined : true}
              aria-describedby={requestError === undefined ? undefined : requestErrorId}
              value={request}
              placeholder="Describe the presentation…"
              onChange={(event) => setRequest(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                  event.preventDefault();
                  submit(request);
                }
              }}
            />
            {requestError !== undefined && (
              <p id={requestErrorId} role="alert" className="text-sm text-motion">
                Error: {requestError}
              </p>
            )}

            <div
              role="group"
              aria-label="Generation choices"
              className="chat-composer-toolbar relative"
            >
              <ReferenceAttachmentButton disabled={running} />
              <button
                ref={modelButton}
                type="button"
                aria-label="Model"
                aria-description={
                  models.selectable
                    ? `Next run uses ${models.effectiveLabel}${models.availability === 'notListed' ? ', not listed for your sign-in' : ''}`
                    : `${providerName} has no model choice`
                }
                aria-haspopup="dialog"
                aria-expanded={choice === 'model'}
                aria-controls={choice === 'model' ? modelChoicesId : undefined}
                disabled={running}
                title={`${providerName}: next run uses ${models.effectiveLabel}`}
                className="chat-model-trigger flex h-9 min-w-0 items-center gap-1 rounded-control bg-accent-deep px-2 text-left text-sm text-accent hover:bg-accent/20 disabled:opacity-50"
                onClick={() => setChoice(choice === 'model' ? null : 'model')}
              >
                <ProviderLogo providerId={selectedId} size={15} />
                <span className="min-w-0 flex-1 truncate">
                  {models.effectiveModel === null
                    ? `${providerName} · ${models.selectable ? 'Default' : 'Demo'}`
                    : (models.options
                        .find((option) => option.value === models.value)
                        ?.label.split(' · ')[0] ?? models.effectiveModel)}
                </span>
                {(models.availability === 'notListed' ||
                  detection === 'failed' ||
                  (detection === 'done' && !available)) && (
                  <span className="flex-none text-signal-warn" aria-hidden="true">
                    <WarningIcon size={14} />
                  </span>
                )}
                <ChevronIcon direction="down" size={14} />
              </button>
              <ChatBrandKitPicker
                project={project}
                maxHeight={pickerMaxHeight}
                disabled={running}
                open={choice === 'brand'}
                onOpenChange={(next) => setChoice(next ? 'brand' : null)}
              />
              <button
                ref={countButton}
                type="button"
                aria-label="Koma count"
                aria-description={
                  validCount
                    ? autoKomaCount
                      ? 'Automatic Koma count'
                      : `${komaCount} Komas`
                    : 'Invalid Koma count. Enter a whole number from 1.'
                }
                aria-haspopup="dialog"
                aria-expanded={choice === 'count'}
                aria-controls={choice === 'count' ? countChoicesId : undefined}
                aria-invalid={validCount ? undefined : true}
                aria-describedby={validCount ? undefined : countErrorId}
                className={`chat-count-trigger flex h-9 flex-none items-center gap-1 rounded-md px-2 text-sm hover:bg-surface-3 ${validCount ? 'text-ink-300 hover:text-ink-100' : 'text-motion'}`}
                onClick={() => setChoice(choice === 'count' ? null : 'count')}
              >
                <span>
                  {validCount ? (autoKomaCount ? 'Auto Komas' : `${komaCount} Komas`) : 'Set Komas'}
                </span>
                <ChevronIcon direction="down" size={14} />
              </button>
              <button
                type="submit"
                aria-label="Generate Komas"
                title="Generate Komas (Ctrl/Command+Enter)"
                disabled={!canSubmit}
                className="chat-send flex size-9 flex-none items-center justify-center rounded-control bg-accent text-surface-0 transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:bg-surface-3 disabled:text-ink-400"
              >
                <SendIcon size={18} />
              </button>
              {!validCount && (
                <span id={countErrorId} className="sr-only">
                  Enter a whole number from 1.
                </span>
              )}
            </div>
          </div>
          {project.agentConfiguration.timeoutSeconds !== null && (
            <p className="px-2 text-xs text-ink-400">
              Stops after {String(project.agentConfiguration.timeoutSeconds)} seconds. Change the
              limit under Settings, Generation.
            </p>
          )}

          <ReferenceFiles disabled={running} showButton={false} />
          {needsReferenceConsent && (
            <label className="flex items-start gap-2 text-xs text-ink-300">
              <input
                type="checkbox"
                checked={referenceConsent === consentKey}
                disabled={running}
                onChange={(event) => setReferenceConsent(event.target.checked ? consentKey : null)}
              />
              <span>Send the extracted reference text to {providerName} with this request.</span>
            </label>
          )}
          {references.length > 0 && selectedId === 'mock' && (
            <p className="text-xs text-ink-400">
              Mock repeats its demo and does not use reference content.
            </p>
          )}

          {choice === 'model' && (
            <div
              ref={choicesPanel}
              id={modelChoicesId}
              role="dialog"
              aria-label="Model"
              style={{ maxHeight: Math.min(pickerMaxHeight ?? 448, 448) }}
              className="absolute bottom-[calc(100%+0.5rem)] left-3 z-30 flex max-h-[min(28rem,60vh)] w-[min(22rem,calc(100vw-2rem))] max-w-[calc(100%-1.5rem)] flex-col overflow-hidden rounded-card border border-line-strong bg-surface-2 shadow-popover"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setChoice(null);
                  modelButton.current?.focus();
                }
              }}
              onBlur={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  !event.currentTarget.contains(event.relatedTarget) &&
                  !modelButton.current?.contains(event.relatedTarget)
                )
                  setChoice(null);
              }}
            >
              <CompactModelPicker
                project={project}
                disabled={running}
                onClose={() => {
                  setChoice(null);
                  modelButton.current?.focus();
                }}
              >
                <label htmlFor={providerId} className="text-xs font-medium text-ink-300">
                  Provider
                </label>
                <Select
                  id={providerId}
                  value={selectedId}
                  disabled={running}
                  onChange={(event) =>
                    apply(
                      changeAgentConfiguration({
                        ...project.agentConfiguration,
                        selectedProviderId: event.target.value,
                      }),
                    )
                  }
                >
                  {providers.length === 0 && <option value={selectedId}>{selectedId}</option>}
                  {providers.map((provider) => (
                    <option key={provider.metadata.id} value={provider.metadata.id}>
                      {provider.metadata.displayName} ({describeAvailability(provider)})
                    </option>
                  ))}
                </Select>
                {detection === 'running' && (
                  <p role="status" className="text-xs text-ink-300">
                    Checking providers
                  </p>
                )}
                {detection === 'failed' && (
                  <p role="alert" className="text-xs text-motion">
                    Error: the providers could not be checked.
                  </p>
                )}
                {detection === 'done' && selected !== undefined && (
                  <Availability provider={selected} />
                )}
                {selectedId === 'mock' && (
                  <p className="text-xs text-ink-300">Demo only · 3 Komas</p>
                )}
                {selected?.metadata.usesExternalService === true && (
                  <p className="text-xs leading-snug text-ink-300">
                    {selected.metadata.displayName} sends your request, instructions, Brand Kit,
                    Koma text and asset names online.
                  </p>
                )}
                <ModelPicker
                  key={selectedId}
                  project={project}
                  provider={selected}
                  label="Model"
                  disabled={running}
                />
              </CompactModelPicker>
            </div>
          )}
          {choice === 'count' && (
            <div
              ref={choicesPanel}
              id={countChoicesId}
              role="dialog"
              aria-label="Koma count"
              className="absolute right-3 bottom-[calc(100%+0.5rem)] z-30 flex w-[min(16rem,calc(100vw-2rem))] max-w-[calc(100%-1.5rem)] flex-col gap-2 rounded-card border border-line-strong bg-surface-2 p-3 shadow-popover"
              onKeyDown={(event) => {
                if (event.key === 'Escape') {
                  event.preventDefault();
                  event.stopPropagation();
                  setChoice(null);
                  countButton.current?.focus();
                }
              }}
              onBlur={(event) => {
                if (
                  event.relatedTarget instanceof Node &&
                  !event.currentTarget.contains(event.relatedTarget) &&
                  !countButton.current?.contains(event.relatedTarget)
                )
                  setChoice(null);
              }}
            >
              <label htmlFor={countId} className="text-xs font-medium text-ink-300">
                Komas
              </label>
              <div className="flex gap-2">
                <TextInput
                  id={countId}
                  type="number"
                  className="min-w-0 w-full tabular-nums"
                  min={1}
                  step={1}
                  aria-invalid={validCount ? undefined : true}
                  aria-describedby={validCount ? undefined : countErrorId}
                  disabled={autoKomaCount}
                  value={autoKomaCount ? '' : komaCount}
                  onChange={(event) => setKomaCount(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    if (validCount) {
                      setChoice(null);
                      countButton.current?.focus();
                    }
                  }}
                />
                <Button
                  variant="outline"
                  compact
                  active={autoKomaCount}
                  aria-pressed={autoKomaCount}
                  title="Let the agent choose a suitable number of Komas"
                  onClick={() => setAutoKomaCount(!autoKomaCount)}
                >
                  Auto
                </Button>
              </div>
              {!validCount && (
                <p role="alert" className="text-xs text-motion">
                  Enter a whole number from 1.
                </p>
              )}
              {project.presentation.komas.length > 0 && (
                <p className="text-xs text-ink-300">Replaces current Komas. Undo is available.</p>
              )}
            </div>
          )}
        </form>
      </div>
    </section>
  );
}
