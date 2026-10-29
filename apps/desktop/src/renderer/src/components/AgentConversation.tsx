import type { KomaProject } from '@koma-motion/core';
import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useAgentStore, type ConversationEntry } from '../state/agentStore';
import { KomaMark, WarningIcon } from './icons';
import { Button } from './ui';
import { RunActivity, RunMonitor } from './RunActivity';
import { ScopedProposal } from './ScopedProposal';

const FAILURE_TITLES = {
  failed: 'Generation failed',
  cancelled: 'Generation stopped',
  timedOut: 'Generation took too long',
} as const;

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
      <li className="chat-message chat-message-user">
        <div className="chat-user-bubble">
          <span className="sr-only">You asked: </span>
          {entry.text}
          {entry.referenceNames !== undefined && (
            <p className="mt-2 text-xs text-ink-400">
              References: {entry.referenceNames.join(', ')}
            </p>
          )}
        </div>
      </li>
    );
  }
  if (entry.kind === 'result') {
    return (
      <li className="chat-message chat-message-agent">
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
      <li className="chat-message chat-message-agent">
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

export function AgentConversation({
  project,
  sessionId,
  open,
  selectedId,
  scope,
  onExample,
  onRetry,
  onReviewed,
}: {
  readonly project: KomaProject;
  readonly sessionId: number;
  readonly open: boolean;
  readonly selectedId: string;
  readonly scope: 'entire' | 'selected';
  readonly onExample: () => void;
  readonly onRetry: (text: string) => void;
  readonly onReviewed: () => void;
}): ReactElement {
  const conversation = useAgentStore((state) => state.conversation);
  const proposal = useAgentStore((state) => state.scopedProposal);
  const execution = useAgentStore((state) => state.execution);
  const lastRun = useAgentStore((state) => state.lastRun);
  const running = execution !== null;
  const [monitorOpen, setMonitorOpen] = useState(false);
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  useEffect(() => {
    // Scrolls the conversation only, never the window around it. A new
    // entry always scrolls; see the effect below for growing output.
    if (open && log.current !== null) {
      log.current.scrollTop = log.current.scrollHeight;
      following.current = true;
    }
  }, [open, conversation.length, proposal]);

  useEffect(() => {
    // Growing output and new phases follow only while the person is at the
    // bottom, so reading earlier text is not interrupted.
    if (open && log.current !== null && following.current) {
      log.current.scrollTop = log.current.scrollHeight;
    }
  }, [open, execution?.events.length, execution?.output.text]);

  return (
    <>
      <div
        ref={log}
        role="log"
        aria-label="Conversation"
        className="chat-conversation"
        onScroll={(event) => {
          const element = event.currentTarget;
          following.current = element.scrollHeight - element.scrollTop - element.clientHeight < 48;
        }}
      >
        {conversation.length === 0 && !running ? (
          <div className="chat-empty">
            <span className="chat-empty-mark" aria-hidden="true">
              <KomaMark size={30} />
            </span>
            <h3>What would you like to present?</h3>
            <p>
              {selectedId === 'mock'
                ? scope === 'selected'
                  ? 'Try a selected-Koma proposal.'
                  : 'Try the three-Koma demo.'
                : 'Describe your idea. Build the story together.'}
            </p>
            <Button
              variant="quiet"
              className="chat-example"
              onClick={() => {
                onExample();
              }}
            >
              Use the example request
            </Button>
          </div>
        ) : (
          <ol className="chat-messages">
            {conversation.map((entry) => (
              <Entry
                key={entry.id}
                entry={entry}
                onRetry={(text) => {
                  onRetry(text);
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
        <ScopedProposal project={project} sessionId={sessionId} onReviewed={onReviewed} />
      </div>

      <RunMonitor
        run={execution ?? lastRun}
        open={monitorOpen}
        onClose={() => setMonitorOpen(false)}
      />
    </>
  );
}
