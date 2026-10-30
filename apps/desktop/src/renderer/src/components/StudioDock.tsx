import type { KomaProject } from '@koma-motion/core';
import { useId, type KeyboardEvent, type ReactElement } from 'react';
import { detectProviders } from '../lib/agentActions';
import type { ChatLayout } from '../lib/chatLayout';
import { EXAMPLE_REQUEST, useComposerDraft } from '../lib/useComposerDraft';
import { useComposerPanel } from '../lib/useComposerPanel';
import { useUiStore } from '../state/uiStore';
import { useAgentStore } from '../state/agentStore';
import { ChevronIcon, RefreshIcon, SettingsIcon } from './icons';
import { BrandProfileDialogHost } from './BrandMaterial';
import { AgentConversation } from './AgentConversation';
import { AgentComposer } from './AgentComposer';
import { BrandKitPanel } from './BrandKitPanel';
import { ChatResizeHandle } from './ChatResizeHandle';
import { Inspector } from './Inspector';
import { IconButton } from './ui';

/** One resizable dock. Hidden contexts stay mounted, including the chat draft. */
export function StudioDock({
  project,
  layout,
}: {
  readonly project: KomaProject;
  readonly layout: ChatLayout;
}): ReactElement {
  const open = useUiStore((state) => state.agentPanelOpen);
  const mode = useUiStore((state) => state.studioPanel);
  const view = useUiStore((state) => state.view);
  const setMode = useUiStore((state) => state.setStudioPanel);
  const setOpen = useUiStore((state) => state.setAgentPanelOpen);
  const setWidth = useUiStore((state) => state.setAgentPanelWidth);
  const openSettings = useUiStore((state) => state.openSettings);
  const id = useId();
  const chatVisible = open && mode === 'chat';
  const draft = useComposerDraft(project);
  const panel = useComposerPanel(project.id, chatVisible);
  const { section, header, showButton } = panel;
  const { detection, running } = draft;
  const lastRun = useAgentStore((state) => state.lastRun);
  const chatStatus = running
    ? 'Generating'
    : draft.proposal !== null
      ? 'Review'
      : lastRun === null
        ? null
        : lastRun.result === 'completed'
          ? 'Complete'
          : lastRun.result === 'cancelled'
            ? 'Stopped'
            : 'Failed';

  const reveal = (next: 'chat' | 'inspect'): void => {
    setMode(next);
    // Rail activation enters the panel. Tab switching keeps focus on the tab;
    // canvas selection keeps focus on the canvas.
    requestAnimationFrame(() => {
      if (next === 'chat') panel.requestField.current?.focus();
      else document.getElementById(`${id}-inspect-tab`)?.focus();
    });
  };
  const moveTab = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const next =
      event.key === 'Home'
        ? 'chat'
        : event.key === 'End'
          ? 'inspect'
          : event.key === 'ArrowLeft' || event.key === 'ArrowRight'
            ? mode === 'chat'
              ? 'inspect'
              : 'chat'
            : null;
    if (next === null) return;
    event.preventDefault();
    setMode(next);
    document.getElementById(`${id}-${next}-tab`)?.focus();
  };

  return (
    <aside
      ref={section}
      aria-label="Studio dock"
      className="chat-panel relative flex min-h-0 flex-none flex-col border-s border-line"
      style={{ width: open ? layout.width : 44 }}
    >
      {open ? (
        <ChatResizeHandle
          width={layout.width}
          maxWidth={layout.maxWidth}
          controls={`${id}-body`}
          onResize={setWidth}
        />
      ) : (
        <div className="studio-dock-rail">
          <button
            ref={showButton}
            type="button"
            aria-label={running ? 'Show the chat. Komas are being generated.' : 'Show the chat'}
            aria-description={chatStatus ?? undefined}
            aria-expanded={false}
            aria-controls={`${id}-body`}
            onClick={() => reveal('chat')}
          >
            <ChevronIcon direction="left" />
            <span>Chat</span>
            {chatStatus !== null && <span className="studio-dock-status">{chatStatus}</span>}
          </button>
          <button
            type="button"
            aria-label="Show Inspect panel"
            aria-expanded={false}
            aria-controls={`${id}-body`}
            onClick={() => reveal('inspect')}
          >
            <span>Inspect</span>
          </button>
        </div>
      )}

      <div id={`${id}-body`} hidden={!open} className="studio-dock-body">
        <div ref={header} data-testid="chat-header" className="studio-dock-header">
          <div role="tablist" aria-label="Studio panel" className="studio-dock-tabs">
            {(['chat', 'inspect'] as const).map((item) => (
              <button
                key={item}
                type="button"
                role="tab"
                id={`${id}-${item}-tab`}
                aria-label={item === 'chat' ? 'Chat' : 'Inspect'}
                aria-description={item === 'chat' && chatStatus !== null ? chatStatus : undefined}
                aria-controls={`${id}-${item}-panel`}
                aria-selected={mode === item}
                tabIndex={mode === item ? 0 : -1}
                onKeyDown={moveTab}
                onClick={() => setMode(item)}
              >
                {item === 'chat' ? 'Chat' : 'Inspect'}
                {item === 'chat' && mode !== 'chat' && chatStatus !== null && (
                  <span className="studio-dock-status">{chatStatus}</span>
                )}
              </button>
            ))}
          </div>
          {mode === 'chat' && (
            <div className="flex items-center gap-0.5">
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
                    className="absolute end-0.5 bottom-0.5 size-1.5 rounded-full bg-accent"
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
            </div>
          )}
          <IconButton
            label={mode === 'chat' ? 'Hide the chat' : 'Hide Inspect panel'}
            aria-expanded={open}
            aria-controls={`${id}-body`}
            onClick={() => {
              setOpen(false);
              requestAnimationFrame(() => showButton.current?.focus());
            }}
          >
            <ChevronIcon direction="right" />
          </IconButton>
        </div>

        <div
          id={`${id}-chat-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-chat-tab`}
          hidden={mode !== 'chat'}
          className="studio-dock-context"
        >
          <section aria-label="Agent chat" className="chat-body">
            <AgentConversation
              project={project}
              sessionId={draft.sessionId}
              open={chatVisible}
              selectedId={draft.selectedId}
              scope={draft.scope}
              canRetry={draft.canRetry}
              onExample={(exampleScope) => {
                if ((exampleScope ?? draft.scope) === 'selected') {
                  draft.setScope('selected');
                  draft.setRequest(
                    'Make this Koma clearer while keeping its main idea and styling.',
                  );
                } else {
                  draft.setRequest(EXAMPLE_REQUEST);
                  draft.setKomaCount('3');
                  draft.setAutoKomaCount(false);
                }
                panel.requestField.current?.focus();
              }}
              onRetry={(text) => {
                draft.submit(text, { preserveDraft: true });
                panel.requestField.current?.focus();
              }}
              onReviewed={() => panel.requestField.current?.focus()}
            />
            <BrandProfileDialogHost />
            <AgentComposer project={project} draft={draft} panel={panel} />
          </section>
        </div>
        <div
          id={`${id}-inspect-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-inspect-tab`}
          hidden={mode !== 'inspect'}
          className="studio-dock-context"
        >
          <div hidden={view !== 'canvas'} className="studio-dock-context">
            <Inspector project={project} />
          </div>
          {view === 'brandKit' && (
            <BrandKitPanel project={project} active={open && mode === 'inspect'} />
          )}
        </div>
      </div>
    </aside>
  );
}
