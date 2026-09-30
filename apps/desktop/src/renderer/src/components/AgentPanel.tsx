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
import { useAgentStore, type ConversationEntry, type DetectedProvider } from '../state/agentStore';
import { changeAgentConfiguration } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { CheckIcon, ChevronIcon, WarningIcon } from './icons';
import { Button, Field, IconButton, Select, TextArea, TextInput } from './ui';

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
      className={`flex items-center gap-1.5 text-sm ${available ? 'text-signal-ok' : 'text-signal-warn'}`}
    >
      {available ? <CheckIcon size={14} /> : <WarningIcon size={14} />}
      <span>
        {available ? 'Available' : 'Not available'}: {provider.detection.message}
      </span>
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
      <li className="ml-auto max-w-[90%] rounded-lg rounded-br-sm bg-desk-700 px-3 py-2 wrap-break-word select-text">
        <span className="sr-only">You asked: </span>
        {entry.text}
      </li>
    );
  }
  if (entry.kind === 'result') {
    return (
      <li className="max-w-[90%] rounded-lg rounded-bl-sm border border-desk-600 px-3 py-2 wrap-break-word select-text">
        <p className="text-sm text-ink-400">{entry.providerName}</p>
        <p>{entry.text}</p>
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
      </li>
    );
  }
  if (entry.kind === 'notApplied') {
    return (
      <li className="max-w-[90%] rounded-lg rounded-bl-sm border border-desk-600 px-3 py-2 wrap-break-word select-text">
        <p className="text-sm text-ink-400">{entry.providerName}</p>
        <p className="font-semibold">Generated Komas were not applied</p>
        <p>{entry.text}</p>
        <p className="mt-2 text-sm text-ink-400">Your edits remain in the presentation.</p>
      </li>
    );
  }
  const { error, diagnostics } = entry;
  const lastAttempt = diagnostics.attempts.at(-1);
  return (
    <li
      role="alert"
      className="max-w-[90%] rounded-lg rounded-bl-sm border border-pencil-red/60 px-3 py-2 wrap-break-word select-text"
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
  const [audience, setAudience] = useState('');
  const [komaCount, setKomaCount] = useState('3');
  const count = komaCount.trim() === '' ? null : Number(komaCount);
  const validCount = count === null || (Number.isSafeInteger(count) && count > 0);
  const requestValidation = userRequestSchema.safeParse(request);
  const requestError =
    request.trim() === '' || requestValidation.success
      ? undefined
      : requestValidation.error.issues[0]?.message;
  const bodyId = useId();
  const section = useRef<HTMLElement>(null);
  const log = useRef<HTMLDivElement>(null);
  const requestField = useRef<HTMLTextAreaElement>(null);
  const showButton = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);

  const selectedId = project.agentConfiguration.selectedProviderId;
  const selected = providers.find((provider) => provider.metadata.id === selectedId);
  const available = selected?.detection.availability === 'available';
  const running = execution !== null;
  const trimmed = request.trim();
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
    if (!userRequestSchema.safeParse(text).success || !validCount || running || !available) {
      return;
    }
    setRequest('');
    void generate({
      userRequest: text.trim(),
      objective: null,
      audience: audience.trim() === '' ? null : audience.trim(),
      requestedKomaCount: count,
    });
  };

  return (
    <section
      ref={section}
      aria-label="Agent chat"
      className="relative flex min-h-0 flex-none flex-col border-l border-desk-600 bg-desk-800"
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
            Agent
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
        <div className="flex flex-none flex-col gap-2 border-b border-desk-600 p-3">
          <div className="flex items-center gap-2">
            <h2 className="min-w-0 flex-1 text-base font-semibold">Agent</h2>
            <Button
              disabled={detection === 'running' || running}
              onClick={() => void detectProviders()}
            >
              Check again
            </Button>
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
          <label className="flex items-center gap-2 text-ink-300">
            Provider
            <Select
              className="min-w-0 flex-1"
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
          </label>
          {detection === 'running' && (
            <p role="status" className="text-sm text-ink-400">
              Checking providers
            </p>
          )}
          {detection === 'failed' && (
            <p role="alert" className="text-sm text-pencil-red">
              Error: the providers could not be checked.
            </p>
          )}
          {detection === 'done' && selected !== undefined && <Availability provider={selected} />}
          {layout.replacesInspector && (
            <p className="text-sm text-ink-400">
              The window is narrow: hide the chat to see the Inspector.
            </p>
          )}
        </div>

        <div
          ref={log}
          className="flex min-h-32 flex-1 flex-col overflow-y-auto bg-desk-900 p-3"
          aria-live="polite"
        >
          {conversation.length === 0 && !running ? (
            <div className="m-auto max-w-lg text-center text-ink-300">
              <p>
                {selectedId === 'mock'
                  ? 'Try the built-in three-Koma demo to see how Koma Motion works. Your Brand Kit colours are applied.'
                  : 'Describe the presentation you want. Your request includes the Brand Kit, a text summary of existing Komas, and asset names.'}
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
            <ol className="flex flex-col gap-2">
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
              className="mt-2 flex items-start gap-3 rounded-lg rounded-bl-sm border border-desk-600 px-3 py-2 wrap-break-word"
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
          className="flex flex-none flex-col gap-2 border-t border-desk-600 p-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit(request);
          }}
        >
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-ink-400">
              {project.systemInstructions.trim() === ''
                ? 'No project instructions'
                : 'Project instructions active'}
            </span>
            <Button onClick={() => setSettingsOpen(true)}>Instructions &amp; templates</Button>
          </div>
          <Field label="Your request" error={requestError}>
            {(ids) => (
              <TextArea
                {...ids}
                ref={requestField}
                rows={4}
                className="max-h-60 min-h-24 field-sizing-content"
                value={request}
                placeholder="What should the presentation show, and in which order?"
                onChange={(event) => {
                  setRequest(event.target.value);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
                    event.preventDefault();
                    submit(request);
                  }
                }}
              />
            )}
          </Field>
          <div className="flex items-end gap-2">
            <Field label="Audience (optional)" className="flex-1">
              {(ids) => (
                <TextInput
                  {...ids}
                  value={audience}
                  maxLength={1000}
                  onChange={(event) => {
                    setAudience(event.target.value);
                  }}
                />
              )}
            </Field>
            <p className="text-sm text-ink-400">
              {project.agentConfiguration.timeoutSeconds === null
                ? 'Generation runs until completion or cancellation. No automatic time limit.'
                : `Generation stops after ${String(project.agentConfiguration.timeoutSeconds)} seconds unless it finishes or you cancel first.`}{' '}
              Change the time limit in Settings.
            </p>
            <Field
              label="Komas"
              className="w-24 flex-none"
              error={validCount ? undefined : 'Enter a positive whole number.'}
            >
              {(ids) => (
                <TextInput
                  {...ids}
                  type="number"
                  min={1}
                  step={1}
                  placeholder="Auto"
                  value={komaCount}
                  onChange={(event) => setKomaCount(event.target.value)}
                />
              )}
            </Field>
          </div>
          <Button
            type="submit"
            variant="primary"
            className="w-full"
            disabled={
              trimmed === '' || !requestValidation.success || !validCount || running || !available
            }
          >
            Generate Komas
          </Button>
          {selectedId === 'mock' && (
            <p className="text-sm text-ink-400">
              Mock always creates the same three-Koma demo, whatever you ask. To generate from your
              request, choose an installed agent above.
            </p>
          )}
          {selected?.metadata.usesExternalService === true && (
            <p className="text-sm text-ink-400">
              {selected.metadata.displayName} sends your request, project instructions, Brand Kit, a
              text summary of existing Komas, and asset names to an online service.
            </p>
          )}
          {project.presentation.komas.length > 0 && (
            <p className="text-sm text-ink-400">
              Generating replaces the current Komas. You can undo it.
            </p>
          )}
        </form>
      </div>
    </section>
  );
}
