import type { KomaProject } from '@koma-motion/core';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { EXAMPLE_REQUEST, useComposerDraft } from '../lib/useComposerDraft';
import { useComposerPanel } from '../lib/useComposerPanel';
import { describeFailure, failureDetail } from '../lib/generationFeedback';
import { useAgentStore } from '../state/agentStore';
import { useUiStore } from '../state/uiStore';
import { BrandProfileDialogHost } from './BrandMaterial';
import { AgentConversation } from './AgentConversation';
import { AgentComposer } from './AgentComposer';
import { CloseIcon, WarningIcon } from './icons';
import { Button, IconButton } from './ui';
import { isNestedEscape } from './Menu';

/**
 * The one way to ask for changes: a floating prompt above the filmstrip.
 * The conversation opens upward on demand into a bounded sheet. Both stay
 * mounted, so collapsing keeps the draft, choices, consent, reading
 * position and run state.
 */
export function PromptDock({ project }: { readonly project: KomaProject }): ReactElement {
  const chatOpen = useUiStore((state) => state.chatOpen);
  const setChatOpen = useUiStore((state) => state.setChatOpen);
  const draft = useComposerDraft(project);
  const panel = useComposerPanel(project.id, true);
  const execution = useAgentStore((state) => state.execution);
  const conversation = useAgentStore((state) => state.conversation);
  const sheetId = useId();
  const running = execution !== null;
  const latestOutcome = conversation.findLast((entry) => entry.kind !== 'request');
  const failure =
    latestOutcome?.kind === 'failure' && latestOutcome.status !== 'cancelled'
      ? latestOutcome
      : undefined;
  const [dismissedFailure, setDismissedFailure] = useState<number | null>(null);
  const showFailure = failure !== undefined && !running && dismissedFailure !== failure.id;
  const detail = failure === undefined ? undefined : failureDetail(failure.error);
  const status = running
    ? 'Generating'
    : draft.proposal !== null
      ? 'Proposal to review'
      : failure !== undefined
        ? 'Failed'
        : null;

  // A new run and a proposal to review open the conversation, so progress,
  // Stop and Apply or Discard are visible where the request was made.
  const executionId = execution?.executionId ?? null;
  const hasProposal = draft.proposal !== null;
  const previousExecution = useRef(executionId);
  useEffect(() => {
    if (executionId !== null && previousExecution.current !== executionId) setChatOpen(true);
    previousExecution.current = executionId;
  }, [executionId, setChatOpen]);
  useEffect(() => {
    if (hasProposal) setChatOpen(true);
  }, [hasProposal, setChatOpen]);
  // A new, empty project has nothing on the canvas yet: the conversation
  // shows how to start. A project with Komas opens canvas first.
  const sessionId = draft.sessionId;
  const empty = project.presentation.komas.length === 0 && conversation.length === 0;
  const openedSession = useRef<number | null>(null);
  useEffect(() => {
    if (openedSession.current === sessionId) return;
    openedSession.current = sessionId;
    if (empty) setChatOpen(true);
  }, [sessionId, empty, setChatOpen]);

  const collapse = (): void => {
    setChatOpen(false);
    requestAnimationFrame(() => panel.requestField.current?.focus());
  };

  return (
    <section aria-label="Agent chat" className="prompt-dock">
      <div
        id={sheetId}
        hidden={!chatOpen}
        className="prompt-sheet"
        onKeyDown={(event) => {
          if (event.key === 'Escape' && !event.defaultPrevented && !isNestedEscape(event.target)) {
            event.preventDefault();
            collapse();
          }
        }}
      >
        <AgentConversation
          project={project}
          sessionId={draft.sessionId}
          open={chatOpen}
          selectedId={draft.selectedId}
          scope={draft.scope}
          canRetry={draft.canRetry}
          onExample={(exampleScope) => {
            if ((exampleScope ?? draft.scope) === 'selected') {
              draft.setScope('selected');
              draft.setRequest('Make this Koma clearer while keeping its main idea and styling.');
            } else {
              draft.setRequest(EXAMPLE_REQUEST);
              draft.setKomaCount('3');
              draft.setAutoKomaCount(false);
            }
            panel.requestField.current?.focus();
          }}
          onRetry={(input) => {
            draft.recheck(input);
            panel.requestField.current?.focus();
          }}
          onReviewed={() => panel.requestField.current?.focus()}
        />
      </div>

      {showFailure && !chatOpen && (
        <div role="alert" className="prompt-failure">
          <span aria-hidden="true" className="flex-none">
            <WarningIcon size={14} />
          </span>
          <p className="min-w-0 flex-1">
            <span className="font-semibold">{describeFailure(failure.status)}</span>
            {detail !== undefined && (
              <span className="block truncate text-ink-300" title={detail}>
                {detail}
              </span>
            )}
          </p>
          <Button
            variant="primary"
            compact
            disabled={!draft.canRetry}
            onClick={() => {
              draft.recheck(failure.input);
              panel.requestField.current?.focus();
            }}
          >
            Recheck
          </Button>
          <Button compact variant="quiet" onClick={() => setChatOpen(true)}>
            Details
          </Button>
          <IconButton
            label="Dismiss"
            className="size-7"
            onClick={() => setDismissedFailure(failure.id)}
          >
            <CloseIcon size={14} />
          </IconButton>
        </div>
      )}

      <AgentComposer
        project={project}
        draft={draft}
        panel={panel}
        chat={{
          open: chatOpen,
          controls: sheetId,
          status,
          failed: showFailure,
          toggle: () => {
            if (chatOpen) collapse();
            else setChatOpen(true);
          },
        }}
      />
      <BrandProfileDialogHost />
    </section>
  );
}
