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
 * The right sidebar keeps the conversation beside the canvas and the composer
 * at its bottom. Both stay mounted, so hiding the transcript keeps the draft,
 * choices, consent, reading position and run state.
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
      : showFailure
        ? 'Failed'
        : latestOutcome?.kind === 'result' && latestOutcome.warnings.length > 0
          ? 'Warnings to review'
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
  // Every project opens with its conversation beside the canvas.
  const sessionId = draft.sessionId;
  const openedSession = useRef<number | null>(null);
  useEffect(() => {
    if (openedSession.current === sessionId) return;
    openedSession.current = sessionId;
    setChatOpen(true);
  }, [sessionId, setChatOpen]);

  const collapse = (): void => {
    setChatOpen(false);
    requestAnimationFrame(() => panel.requestField.current?.focus());
  };

  return (
    <section aria-label="Agent chat" className="prompt-dock">
      <h2 className="chat-sidebar-title">Chat</h2>
      <div
        id={sheetId}
        // Not a control: Escape bubbles here from the conversation inside.
        role="presentation"
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
              <span className="block wrap-break-word text-ink-300" title={detail}>
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
