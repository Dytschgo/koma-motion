import { MAX_REQUESTED_KOMAS, MAX_USER_REQUEST_LENGTH } from '@koma-motion/agent-runtime';
import type { KomaProject } from '@koma-motion/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { cancelGeneration, detectProviders, generate } from '../lib/agentActions';
import { useAgentStore, type ConversationEntry, type DetectedProvider } from '../state/agentStore';
import { changeAgentConfiguration } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { CheckIcon, ChevronIcon, WarningIcon } from './icons';
import { Button, Field, IconButton, Select, TextArea, TextInput } from './ui';

export const EXAMPLE_REQUEST =
  'Create a three-frame presentation introducing Koma Motion. Start with the complete system, focus on the motion engine, then reveal how it exports an editable presentation.';

const KOMA_COUNTS = Array.from({ length: MAX_REQUESTED_KOMAS }, (_, index) => index + 1);

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
      <li className="ml-auto max-w-[80%] rounded-lg rounded-br-sm bg-desk-700 px-3 py-2 select-text">
        <span className="sr-only">You asked: </span>
        {entry.text}
      </li>
    );
  }
  if (entry.kind === 'result') {
    return (
      <li className="max-w-[80%] rounded-lg rounded-bl-sm border border-desk-600 px-3 py-2 select-text">
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
      <li className="max-w-[80%] rounded-lg rounded-bl-sm border border-desk-600 px-3 py-2 select-text">
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
      className="max-w-[80%] rounded-lg rounded-bl-sm border border-pencil-red/60 px-3 py-2 select-text"
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
        <dl className="mt-1 grid grid-cols-[auto_1fr] gap-x-3">
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
              <dd className="whitespace-pre-wrap">{lastAttempt.errorOutput}</dd>
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

export function AgentPanel({ project }: { readonly project: KomaProject }): ReactElement {
  const providers = useAgentStore((state) => state.providers);
  const detection = useAgentStore((state) => state.detection);
  const execution = useAgentStore((state) => state.execution);
  const conversation = useAgentStore((state) => state.conversation);
  const apply = useProjectStore((state) => state.apply);
  const open = useUiStore((state) => state.agentPanelOpen);
  const setOpen = useUiStore((state) => state.setAgentPanelOpen);

  const [request, setRequest] = useState('');
  const [audience, setAudience] = useState('');
  const [komaCount, setKomaCount] = useState(3);
  const logEnd = useRef<HTMLDivElement>(null);

  const selectedId = project.agentConfiguration.selectedProviderId;
  const selected = providers.find((provider) => provider.metadata.id === selectedId);
  const available = selected?.detection.availability === 'available';
  const running = execution !== null;
  const trimmed = request.trim();
  const latestStatus = execution?.events.at(-1);

  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' });
  }, [conversation.length, execution?.events.length]);

  const submit = (text: string): void => {
    if (text.trim() === '' || running || !available) {
      return;
    }
    setRequest('');
    void generate({
      userRequest: text.trim(),
      objective: null,
      audience: audience.trim() === '' ? null : audience.trim(),
      requestedKomaCount: komaCount,
    });
  };

  return (
    <section
      aria-label="Agent chat"
      className="flex flex-none flex-col border-t border-desk-600 bg-desk-800"
    >
      <div className="flex h-11 flex-none items-center gap-3 px-3">
        <h2 className="text-base font-semibold">Agent</h2>
        <label className="flex items-center gap-2 text-ink-300">
          Provider
          <Select
            className="w-64"
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
        <div className="min-w-0 flex-1">
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
        </div>
        <Button
          disabled={detection === 'running' || running}
          onClick={() => void detectProviders()}
        >
          Check again
        </Button>
        <IconButton
          label={open ? 'Hide the chat' : 'Show the chat'}
          aria-expanded={open}
          onClick={() => {
            setOpen(!open);
          }}
        >
          <ChevronIcon direction={open ? 'down' : 'up'} />
        </IconButton>
      </div>

      {open && (
        <div className="flex h-60 min-h-0 gap-3 border-t border-desk-600 p-3">
          <div
            className="flex min-w-0 flex-1 flex-col overflow-y-auto rounded-lg bg-desk-900 p-3"
            aria-live="polite"
          >
            {conversation.length === 0 && !running ? (
              <div className="m-auto max-w-lg text-center text-ink-300">
                <p>
                  Describe the presentation you want. The Brand Kit of this project is sent along
                  with your request.
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
                className="mt-2 flex max-w-[80%] items-center gap-3 rounded-lg rounded-bl-sm border border-desk-600 px-3 py-2"
              >
                <span
                  aria-hidden="true"
                  className="working-dot size-2 flex-none rounded-full bg-pencil-red"
                />
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-ink-400">{execution.providerName}</p>
                  <p className="truncate">
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
            <div ref={logEnd} />
          </div>

          <form
            className="flex w-[420px] flex-none flex-col gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              submit(request);
            }}
          >
            <Field label="Your request" className="min-h-0 flex-1">
              {(ids) => (
                <TextArea
                  {...ids}
                  className="min-h-0 flex-1"
                  value={request}
                  maxLength={MAX_USER_REQUEST_LENGTH}
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
              <Field label="Komas" className="w-20">
                {(ids) => (
                  <Select
                    {...ids}
                    value={komaCount}
                    onChange={(event) => {
                      setKomaCount(Number(event.target.value));
                    }}
                  >
                    {KOMA_COUNTS.map((count) => (
                      <option key={count} value={count}>
                        {count}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Button
                type="submit"
                variant="primary"
                disabled={trimmed === '' || running || !available}
              >
                Generate Komas
              </Button>
            </div>
            {selected?.metadata.usesExternalService === true && (
              <p className="text-sm text-ink-400">
                {selected.metadata.displayName} sends your request and Brand Kit to an online
                service.
              </p>
            )}
            {project.presentation.komas.length > 0 && (
              <p className="text-sm text-ink-400">
                Generating replaces the current Komas. You can undo it.
              </p>
            )}
          </form>
        </div>
      )}
    </section>
  );
}
