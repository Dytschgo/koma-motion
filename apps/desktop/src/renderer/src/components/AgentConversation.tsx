import type { GenerationInput } from '@koma-motion/agent-runtime';
import type { KomaProject } from '@koma-motion/core';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
} from 'react';
import { useAgentStore, type ConversationEntry } from '../state/agentStore';
import { generationFailureSummary } from '../lib/generationFeedback';
import { ChevronIcon, KomaMark, WarningIcon } from './icons';
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
      <summary
        aria-label={`${name} output`}
        className="cursor-pointer text-ink-400 hover:text-ink-100"
      >
        Output
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
  canRetry,
}: {
  readonly entry: ConversationEntry;
  readonly onRetry: (input: GenerationInput) => void;
  readonly canRetry: boolean;
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
              {[...new Set(entry.warnings)].map((warning, index) => (
                <li key={index} className="flex gap-2">
                  <span className="flex-none">
                    <WarningIcon size={14} />
                  </span>
                  <span className="sr-only">Warning: </span>
                  {warning}
                </li>
              ))}
            </ul>
          )}
        </div>
      </li>
    );
  }
  if (entry.kind === 'notApplied' || entry.kind === 'proposalReady') {
    return (
      <li className="chat-message chat-message-agent">
        <div className="min-w-0 flex-1 pt-0.5">
          <p className="mb-1 text-xs text-ink-400">{entry.providerName}</p>
          <p className="font-semibold">
            {entry.kind === 'proposalReady' ? 'Proposal ready' : 'Generated Komas were not applied'}
          </p>
          <p>{entry.text}</p>
          {entry.kind === 'notApplied' && (
            <p className="mt-2 text-sm text-ink-400">Your edits remain in the presentation.</p>
          )}
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
      role={entry.status === 'cancelled' ? 'status' : 'alert'}
      className={`max-w-full rounded-lg border-l-2 py-1 ps-3 wrap-break-word select-text ${entry.status === 'cancelled' ? 'border-line-strong' : 'border-motion/70'}`}
    >
      <p className="text-sm text-ink-400">{entry.providerName}</p>
      <p
        className={`font-semibold ${entry.status === 'cancelled' ? 'text-ink-300' : 'text-motion'}`}
      >
        {FAILURE_TITLES[entry.status]}
      </p>
      {entry.status !== 'cancelled' && (
        <p className="whitespace-pre-wrap">{generationFailureSummary(error)}</p>
      )}
      <p className="mt-2 text-sm text-ink-400">Your presentation was not changed.</p>
      <details className="mt-1 text-sm text-ink-400">
        <summary className="cursor-pointer hover:text-ink-100">Diagnostics</summary>
        <p className="my-2 whitespace-pre-wrap">{error.message}</p>
        {entry.output !== undefined && (
          <section aria-label="Provider output" className="my-2">
            <h4 className="font-medium">Output</h4>
            <p className="whitespace-pre-wrap">{entry.output}</p>
          </section>
        )}
        {error.issues.length > 0 && (
          <ul
            aria-label="Response validation details"
            className="my-2 list-disc ps-5 text-sm text-ink-300"
          >
            {error.issues.slice(0, 8).map((issue, index) => (
              <li key={index}>
                {issue.path}: {issue.message}
              </li>
            ))}
            {error.issues.length > 8 && <li>and {error.issues.length - 8} more</li>}
          </ul>
        )}
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
        disabled={!canRetry}
        className="mt-2"
        onClick={() => {
          onRetry(entry.input);
        }}
      >
        Recheck
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
  canRetry,
  onExample,
  onRetry,
  onReviewed,
}: {
  readonly project: KomaProject;
  readonly sessionId: number;
  readonly open: boolean;
  readonly selectedId: string;
  readonly scope: 'entire' | 'selected';
  readonly canRetry: boolean;
  readonly onExample: (scope?: 'selected') => void;
  readonly onRetry: (input: GenerationInput) => void;
  readonly onReviewed: () => void;
}): ReactElement {
  const conversation = useAgentStore((state) => state.conversation);
  const proposal = useAgentStore((state) => state.scopedProposal);
  const execution = useAgentStore((state) => state.execution);
  const lastRun = useAgentStore((state) => state.lastRun);
  const running = execution !== null;
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [showJump, setShowJump] = useState(false);
  const logId = useId();
  const log = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const readingPosition = useRef(0);
  const previousSession = useRef(sessionId);
  const logSize = useRef({ width: 0, height: 0 });
  const lastRequestId = conversation.findLast((entry) => entry.kind === 'request')?.id;
  const previousRequestId = useRef(lastRequestId);
  const hasKomas = project.presentation.komas.length > 0;
  const selectedExample = hasKomas && scope === 'entire';
  const followLatest = useCallback((): void => {
    if (log.current === null) return;
    log.current.scrollTop = log.current.scrollHeight;
    following.current = true;
    setShowJump(false);
  }, []);

  useLayoutEffect(() => {
    if (previousSession.current !== sessionId) {
      previousSession.current = sessionId;
      following.current = true;
      readingPosition.current = 0;
    }
    if (!open || log.current === null) return;
    if (following.current) followLatest();
    else log.current.scrollTop = readingPosition.current;
  }, [open, sessionId, followLatest]);

  useEffect(() => {
    if (!open || log.current === null) return;
    // A growing draft or window resize changes the visible transcript height
    // without adding output. Keep its end visible only while already following.
    const observer = new ResizeObserver(() => {
      if (log.current === null) return;
      logSize.current = { width: log.current.clientWidth, height: log.current.clientHeight };
      if (following.current) followLatest();
    });
    observer.observe(log.current);
    return () => observer.disconnect();
  }, [open, followLatest]);

  useEffect(() => {
    // Follow a request the person sent, but keep their reading position when
    // a result or proposal arrives while they are looking through history.
    const sent = previousRequestId.current !== lastRequestId;
    previousRequestId.current = lastRequestId;
    if (open && (sent || following.current)) followLatest();
  }, [open, lastRequestId, conversation.length, proposal, followLatest]);

  useEffect(() => {
    // Growing output and new phases follow only while the person is at the
    // bottom, so reading earlier text is not interrupted.
    if (open && following.current) followLatest();
  }, [open, execution?.events.length, execution?.output.text, followLatest]);

  return (
    <>
      <div className="chat-conversation-panel">
        <div
          ref={log}
          id={logId}
          role="log"
          tabIndex={-1}
          aria-label="Conversation"
          className="chat-conversation"
          onScroll={(event) => {
            // Hiding a dock context can dispatch a layout scroll. It is not a
            // request to leave the reader's place or resume following output.
            if (!open) return;
            const element = event.currentTarget;
            // Layout can dispatch scroll before ResizeObserver. Let the observer
            // restore following before interpreting a changed viewport as reading.
            if (
              following.current &&
              (element.clientWidth !== logSize.current.width ||
                element.clientHeight !== logSize.current.height)
            )
              return;
            readingPosition.current = element.scrollTop;
            following.current =
              element.scrollHeight - element.scrollTop - element.clientHeight < 48;
            setShowJump(!following.current);
          }}
        >
          {conversation.length === 0 && !running ? (
            <div className="chat-empty">
              <span className="chat-empty-mark" aria-hidden="true">
                <KomaMark size={30} />
              </span>
              <h3>
                {hasKomas ? 'What would you like to change?' : 'What would you like to present?'}
              </h3>
              {!hasKomas && selectedId === 'mock' && <p>Try the three-Koma demo.</p>}
              <Button
                variant="quiet"
                className="chat-example"
                onClick={() => {
                  onExample(selectedExample ? 'selected' : undefined);
                }}
              >
                {selectedExample ? 'Try a selected-Koma proposal' : 'Use the example request'}
              </Button>
            </div>
          ) : (
            <ol className="chat-messages">
              {conversation.map((entry) => (
                <Entry
                  key={entry.id}
                  entry={entry}
                  canRetry={canRetry}
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
        {showJump && (
          <button
            type="button"
            className="chat-jump-latest"
            aria-label="Jump to latest"
            aria-controls={logId}
            onClick={() => {
              followLatest();
              log.current?.focus({ preventScroll: true });
            }}
          >
            <ChevronIcon direction="down" size={16} />
            Latest
          </button>
        )}
      </div>

      <RunMonitor
        run={execution ?? lastRun}
        open={monitorOpen}
        onClose={() => setMonitorOpen(false)}
      />
    </>
  );
}
