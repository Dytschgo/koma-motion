import { userRequestSchema } from '@koma-motion/agent-runtime';
import type { KomaProject } from '@koma-motion/core';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { cancelGeneration, detectProviders, generate } from '../lib/agentActions';
import {
  CHAT_DEFAULT_WIDTH,
  CHAT_MIN_WIDTH,
  CHAT_RESIZE_STEP,
  clampChatWidth,
  type ChatLayout,
} from '../lib/chatLayout';
import {
  DEFAULT_KOMA_COUNT,
  DEFAULT_MODEL_VALUE,
  getModelChoices,
  parseKomaCount,
  withProviderModel,
} from '../lib/composerChoices';
import { useAgentStore, type ConversationEntry, type DetectedProvider } from '../state/agentStore';
import { changeAgentConfiguration } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
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
      <span className="sr-only">{available ? 'Ready' : 'Not available'}</span>
      <Help label="Provider details">{provider.detection.message}</Help>
    </p>
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
        <div className="max-w-[calc(100%-2rem)] whitespace-pre-wrap rounded-2xl rounded-tr-sm border border-desk-600/70 bg-desk-700 px-3.5 py-2.5 text-ink-100">
          <span className="sr-only">You asked: </span>
          {entry.text}
        </div>
        <span
          aria-hidden="true"
          className="flex size-6 flex-none items-center justify-center rounded-full border border-desk-500 bg-desk-800 text-ink-300"
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
          className="flex size-6 flex-none items-center justify-center rounded-full border border-desk-600 bg-desk-800"
        >
          <KomaMark size={15} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="mb-1 text-xs font-medium text-ink-400">{entry.providerName}</p>
          <p className="whitespace-pre-wrap leading-relaxed">{entry.text}</p>
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
          className="flex size-6 flex-none items-center justify-center rounded-full border border-desk-600 bg-desk-800"
        >
          <KomaMark size={15} />
        </span>
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="mb-1 text-xs text-ink-400">{entry.providerName}</p>
          <p className="font-semibold">Generated Komas were not applied</p>
          <p>{entry.text}</p>
          <p className="mt-2 text-sm text-ink-400">Your edits remain in the presentation.</p>
        </div>
      </li>
    );
  }
  const { error, diagnostics } = entry;
  const lastAttempt = diagnostics.attempts.at(-1);
  return (
    <li
      role="alert"
      className="max-w-full rounded-lg border-l-2 border-pencil-red/70 py-1 pl-3 wrap-break-word select-text"
    >
      <p className="text-sm text-ink-400">{entry.providerName}</p>
      <p className="font-semibold text-pencil-red">{FAILURE_TITLES[entry.status]}</p>
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
          'group-hover:bg-desk-500 group-focus-visible:w-1 group-focus-visible:bg-pencil-blue ' +
          'group-data-dragging:bg-pencil-blue'
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
  const conversation = useAgentStore((state) => state.conversation);
  const apply = useProjectStore((state) => state.apply);
  const open = useUiStore((state) => state.agentPanelOpen);
  const setOpen = useUiStore((state) => state.setAgentPanelOpen);
  const setWidth = useUiStore((state) => state.setAgentPanelWidth);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);

  const [request, setRequest] = useState('');
  const [komaCount, setKomaCount] = useState(String(DEFAULT_KOMA_COUNT));
  const [autoKomaCount, setAutoKomaCount] = useState(false);
  /** A model id chosen before Default, per project and provider, so it can be chosen again. */
  const [previousModels, setPreviousModels] = useState<Readonly<Record<string, string>>>({});
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
  const modelId = useId();
  const countId = useId();
  const countErrorId = useId();
  const section = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const requestField = useRef<HTMLTextAreaElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  const selectedId = project.agentConfiguration.selectedProviderId;
  const selected = providers.find((provider) => provider.metadata.id === selectedId);
  const available = selected?.detection.availability === 'available';
  const modelKey = `${project.id}:${selectedId}`;
  const models = getModelChoices(
    selected?.metadata,
    project.agentConfiguration,
    previousModels[modelKey] ?? null,
  );
  const running = execution !== null;
  const trimmed = request.trim();
  const canSubmit =
    trimmed !== '' && requestValidation.success && validCount && !running && available;
  const latestStatus = execution?.events.at(-1);

  useEffect(() => {
    // Scrolls the conversation only, never the window around it.
    if (open && log.current !== null) {
      log.current.scrollTop = log.current.scrollHeight;
    }
  }, [open, conversation.length, execution?.events.length]);

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
      !available
    ) {
      return;
    }
    setRequest('');
    void generate({
      userRequest: text.trim(),
      objective: null,
      // The agent infers the audience from the request.
      audience: null,
      requestedKomaCount: count,
    });
  };

  return (
    <section
      ref={section}
      aria-label="Agent chat"
      className="relative flex min-h-0 flex-none flex-col border-l border-desk-600 bg-desk-950"
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
          className="flex w-11 flex-col items-center gap-3 py-3 text-ink-300 transition-colors hover:bg-desk-700 hover:text-ink-100"
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
              className="working-dot size-2 flex-none rounded-full bg-pencil-red"
            />
          )}
        </button>
      )}

      <div id={bodyId} hidden={!open} className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        <div className="flex h-12 flex-none flex-col justify-center border-b border-desk-600/70 bg-desk-800/70 px-3">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 text-base font-semibold">Chat</h2>
            <IconButton
              label="Check again"
              disabled={detection === 'running' || running}
              onClick={() => void detectProviders()}
            >
              <RefreshIcon />
            </IconButton>
            <Help label="About the chat">
              Describe your presentation, then generate. Hide the chat to see the Inspector in a
              narrow window.
            </Help>
            <Help label="Generation settings">
              {project.agentConfiguration.timeoutSeconds === null
                ? 'No time limit. Cancel generation at any time.'
                : `Stops after ${String(project.agentConfiguration.timeoutSeconds)} seconds. You can cancel earlier.`}{' '}
              Change the time limit in Settings. Project instructions apply to every request; edit
              them or reuse a template from Instructions & templates.
            </Help>
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
          className="chat-conversation flex min-h-32 flex-1 flex-col overflow-y-auto px-4 py-5"
          aria-live="polite"
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
          {execution !== null && (
            <div
              role="status"
              className="mt-5 flex items-start gap-3 rounded-lg border border-desk-600 bg-desk-800/70 px-3 py-2 wrap-break-word"
            >
              <span
                aria-hidden="true"
                className="working-dot mt-1.5 size-2 flex-none rounded-full bg-pencil-red"
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm text-ink-400">{execution.providerName}</p>
                <p>
                  {execution.cancelRequested ? 'Stopping' : (latestStatus?.message ?? 'Starting')}
                </p>
              </div>
              {latestStatus?.phase !== 'succeeded' && (
                <Button
                  variant="outline"
                  disabled={execution.cancelRequested}
                  onClick={() => void cancelGeneration()}
                >
                  Cancel
                </Button>
              )}
            </div>
          )}
        </div>

        <form
          className="flex min-h-0 flex-none flex-col gap-2 overflow-y-auto border-t border-desk-600/70 bg-desk-900 px-3 pt-3 pb-2"
          onSubmit={(event) => {
            event.preventDefault();
            submit(request);
          }}
        >
          <div className="chat-composer-box flex items-end gap-1 rounded-2xl border border-desk-500 bg-desk-800 p-1.5 focus-within:border-pencil-blue/70">
            <label htmlFor={requestId} className="sr-only">
              Your request
            </label>
            <textarea
              id={requestId}
              ref={requestField}
              rows={1}
              className="min-h-9 max-h-36 min-w-0 flex-1 field-sizing-content resize-none bg-transparent px-2 py-2 text-ink-100 placeholder:text-ink-400 focus-visible:outline-none"
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
            <button
              type="submit"
              aria-label="Generate Komas"
              title="Generate Komas (Ctrl/Command+Enter)"
              disabled={!canSubmit}
              className="flex size-10 flex-none items-center justify-center rounded-full bg-pencil-blue text-desk-950 transition-colors hover:bg-[#a4d8f0] disabled:cursor-not-allowed disabled:bg-desk-600 disabled:text-ink-400"
            >
              <SendIcon size={18} />
            </button>
          </div>
          {requestError !== undefined && (
            <p id={requestErrorId} role="alert" className="text-sm text-pencil-red">
              Error: {requestError}
            </p>
          )}

          <div
            role="group"
            aria-label="Generation choices"
            className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2"
          >
            <div className="flex min-w-0 items-center gap-1.5">
              <label htmlFor={modelId} className="flex-none text-xs text-ink-400">
                Model
              </label>
              <Select
                id={modelId}
                className="min-w-24 w-full text-sm"
                value={models.value}
                disabled={running || !models.selectable}
                title={
                  models.selectable
                    ? 'Default lets the provider choose. Set another model id in Settings.'
                    : `${selected?.metadata.displayName ?? selectedId} has no model choice.`
                }
                onChange={(event) => {
                  const value = event.target.value;
                  if (value === DEFAULT_MODEL_VALUE && models.value !== DEFAULT_MODEL_VALUE) {
                    const previous = models.value;
                    setPreviousModels((current) => ({ ...current, [modelKey]: previous }));
                  }
                  apply(
                    changeAgentConfiguration(
                      withProviderModel(project.agentConfiguration, selectedId, value),
                    ),
                  );
                }}
              >
                {models.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex items-center gap-1">
              <label htmlFor={countId} className="text-xs text-ink-400">
                Komas
              </label>
              <TextInput
                id={countId}
                type="number"
                className="w-11 tabular-nums text-center"
                min={1}
                step={1}
                placeholder="Auto"
                aria-invalid={validCount ? undefined : true}
                aria-describedby={validCount ? undefined : countErrorId}
                disabled={autoKomaCount}
                value={autoKomaCount ? '' : komaCount}
                onChange={(event) => setKomaCount(event.target.value)}
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
          </div>
          {!validCount && (
            <p id={countErrorId} role="alert" className="text-sm text-pencil-red">
              Enter a whole number from 1.
            </p>
          )}

          <div className="flex min-w-0 items-center gap-1 border-t border-desk-600/70 pt-2">
            <label htmlFor={providerId} className="sr-only">
              Provider
            </label>
            <Select
              id={providerId}
              className="min-w-0 w-full text-sm"
              value={selectedId}
              disabled={running}
              onChange={(event) => {
                apply(
                  changeAgentConfiguration({
                    ...project.agentConfiguration,
                    selectedProviderId: event.target.value,
                  }),
                );
              }}
            >
              {providers.length === 0 && <option value={selectedId}>{selectedId}</option>}
              {providers.map((provider) => (
                <option key={provider.metadata.id} value={provider.metadata.id}>
                  {provider.metadata.displayName} ({describeAvailability(provider)})
                </option>
              ))}
            </Select>
            {detection === 'done' && selected !== undefined && <Availability provider={selected} />}
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
              onClick={() => setSettingsOpen(true)}
            >
              <SettingsIcon />
              {project.systemInstructions.trim() !== '' && (
                <span
                  className="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-pencil-blue"
                  aria-hidden="true"
                />
              )}
            </IconButton>
          </div>
          {detection === 'running' && (
            <p role="status" className="text-xs text-ink-400">
              Checking providers
            </p>
          )}
          {detection === 'failed' && (
            <p role="alert" className="text-xs text-pencil-red">
              Error: the providers could not be checked.
            </p>
          )}
          {selectedId === 'mock' && (
            <div className="flex items-center gap-1 text-xs text-ink-400">
              <span>Demo only · 3 Komas</span>
              <Help label="About the demo">
                The mock provider creates the same demo for every request, using your Brand Kit
                colours. Choose an installed agent for your own content.
              </Help>
            </div>
          )}
          {selected?.metadata.usesExternalService === true && (
            <p className="text-xs leading-snug text-ink-400">
              {selected.metadata.displayName} sends your request, instructions, Brand Kit, Koma text
              and asset names online.
            </p>
          )}
          {project.presentation.komas.length > 0 && (
            <p className="text-xs text-ink-400">Replaces current Komas. Undo is available.</p>
          )}
        </form>
      </div>
    </section>
  );
}
