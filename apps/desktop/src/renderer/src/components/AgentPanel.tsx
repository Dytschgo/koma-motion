import type { KomaProject } from '@koma-motion/core';
import { useId, type ReactElement } from 'react';
import { detectProviders } from '../lib/agentActions';
import type { ChatLayout } from '../lib/chatLayout';
import { EXAMPLE_REQUEST, useComposerDraft } from '../lib/useComposerDraft';
import { useComposerPanel } from '../lib/useComposerPanel';
import { useUiStore } from '../state/uiStore';
import { ChevronIcon, RefreshIcon, SettingsIcon } from './icons';
import { BrandProfileDialogHost } from './BrandMaterial';
import { AgentConversation } from './AgentConversation';
import { AgentComposer } from './AgentComposer';
import { ChatResizeHandle } from './ChatResizeHandle';
import { IconButton } from './ui';

export { EXAMPLE_REQUEST } from '../lib/useComposerDraft';

export function AgentPanel({
  project,
  layout,
}: {
  readonly project: KomaProject;
  readonly layout: ChatLayout;
}): ReactElement {
  const open = useUiStore((state) => state.agentPanelOpen);
  const setOpen = useUiStore((state) => state.setAgentPanelOpen);
  const setWidth = useUiStore((state) => state.setAgentPanelWidth);
  const openSettings = useUiStore((state) => state.openSettings);
  const bodyId = useId();
  const draft = useComposerDraft(project);
  const panel = useComposerPanel(project.id, open);
  const { section, header, showButton } = panel;
  const { detection, running } = draft;
  return (
    <section
      ref={section}
      aria-label="Agent chat"
      className="chat-panel relative flex min-h-0 flex-none flex-col border-l border-line bg-surface-2"
      style={open ? { width: layout.width } : undefined}
    >
      {open ? (
        <ChatResizeHandle
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

        <AgentConversation
          project={project}
          sessionId={draft.sessionId}
          open={open}
          selectedId={draft.selectedId}
          scope={draft.scope}
          onExample={() => draft.setRequest(EXAMPLE_REQUEST)}
          onRetry={draft.submit}
          onReviewed={() => panel.requestField.current?.focus()}
        />
        <BrandProfileDialogHost />

        <AgentComposer project={project} draft={draft} panel={panel} />
      </div>
    </section>
  );
}
