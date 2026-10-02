import type { KomaProject } from '@koma-motion/core';
import { useElementSize } from '@koma-motion/renderer';
import { useEffect, useRef, type ReactElement } from 'react';
import { AgentPanel } from './components/AgentPanel';
import { BrandKitPanel } from './components/BrandKitPanel';
import { Inspector } from './components/Inspector';
import { KomaStrip } from './components/KomaStrip';
import { ConfirmDialog, Notices } from './components/Overlays';
import { SettingsDialog } from './components/SettingsDialog';
import { TopBar } from './components/TopBar';
import { ProjectHealth } from './components/ProjectHealth';
import { QuickStartGuide } from './components/QuickStartGuide';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import { detectProviders } from './lib/agentActions';
import { invoke, subscribe } from './lib/api';
import { getBrandKitPanelWidth, getChatLayout, INSPECTOR_WIDTH } from './lib/chatLayout';
import { followUpdates } from './lib/updateActions';
import {
  createNewProject,
  openProject,
  saveAndClose,
  saveProject,
  saveProjectAs,
} from './lib/projectActions';
import { useAgentStore } from './state/agentStore';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from './state/projectStore';
import { useTransitionRegenerationStore } from './state/transitionRegenerationStore';
import { useUiStore } from './state/uiStore';

function isEditingText(target: EventTarget | null): boolean {
  // The position slider is not a text field, so document undo still applies.
  if (target instanceof HTMLInputElement && target.type === 'range') {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** Connects the application with the main process and the keyboard. */
function useApplicationEvents(): void {
  const hasUnsavedChanges = useProjectStore(selectHasUnsavedChanges);

  useEffect(() => {
    void detectProviders();
    const unsubscribeStatus = subscribe('koma:providers:status', (event) => {
      useAgentStore.getState().addStatus(event);
      useTransitionRegenerationStore.getState().progress(event.executionId, event.message);
    });
    const unsubscribeOutput = subscribe('koma:providers:output', (event) => {
      useAgentStore.getState().addOutput(event);
    });
    const unsubscribeClose = subscribe('koma:app:save-and-close', () => {
      void saveAndClose();
    });
    const unfollowUpdates = followUpdates();
    return () => {
      unsubscribeStatus();
      unsubscribeOutput();
      unsubscribeClose();
      unfollowUpdates();
    };
  }, []);

  useEffect(() => {
    void invoke('koma:app:set-unsaved-changes', { hasUnsavedChanges }).catch(() => undefined);
  }, [hasUnsavedChanges]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) {
        return;
      }
      const key = event.key.toLowerCase();
      if (key === 's') {
        event.preventDefault();
        void (event.shiftKey ? saveProjectAs() : saveProject());
      } else if (key === 'o') {
        event.preventDefault();
        void openProject();
      } else if (key === 'n') {
        event.preventDefault();
        void createNewProject();
      } else if (key === 'z' && !isEditingText(event.target)) {
        // Text fields keep their own undo while they are being edited.
        event.preventDefault();
        if (event.shiftKey) {
          useProjectStore.getState().redo();
        } else {
          useProjectStore.getState().undo();
        }
      } else if (key === 'y' && !isEditingText(event.target)) {
        event.preventDefault();
        useProjectStore.getState().redo();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}

/**
 * Komas on the left, the canvas in the middle, the Inspector or the Brand Kit
 * beside it and the chat on the right. When the window has no room for the
 * canvas, the side panel and the chat side by side, the open chat takes the
 * place of the Inspector, and the Brand Kit and the chat take turns: opening
 * one collapses the other, and closing the Brand Kit brings the chat back.
 */
function ProjectLayout({ project }: { readonly project: KomaProject }): ReactElement {
  const view = useUiStore((state) => state.view);
  const chatOpen = useUiStore((state) => state.agentPanelOpen);
  const chatWidth = useUiStore((state) => state.agentPanelWidth);
  const [attachArea, area] = useElementSize<HTMLDivElement>();
  const chatLayout = getChatLayout({
    available: area.width,
    preferred: chatWidth,
    inspector: view === 'canvas' ? INSPECTOR_WIDTH : getBrandKitPanelWidth(window.innerWidth),
  });
  const brandKitOpen = view === 'brandKit';
  const crowded = chatOpen && brandKitOpen && chatLayout.replacesInspector;

  const previous = useRef({ chatOpen, brandKitOpen });
  // The chat was collapsed to make room for the Brand Kit and comes back after it.
  const collapsedForBrandKit = useRef(false);
  useEffect(() => {
    const chatJustOpened = !previous.current.chatOpen;
    previous.current = { chatOpen, brandKitOpen };
    const ui = useUiStore.getState();
    if (crowded) {
      collapsedForBrandKit.current = !chatJustOpened;
      if (chatJustOpened) {
        ui.setView('canvas');
      } else {
        ui.setAgentPanelOpen(false);
      }
      return;
    }
    if (!brandKitOpen && collapsedForBrandKit.current) {
      collapsedForBrandKit.current = false;
      if (!chatOpen) {
        ui.setAgentPanelOpen(true);
      }
    }
  }, [crowded, chatOpen, brandKitOpen]);

  return (
    <div className="flex min-h-0 flex-1">
      <KomaStrip project={project} />
      <div ref={attachArea} className="flex min-h-0 min-w-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1">
          <Workspace project={project} />
          {brandKitOpen ? (
            <div className="contents" hidden={crowded}>
              <BrandKitPanel project={project} />
            </div>
          ) : (
            // Hidden, not removed, so that the Inspector keeps its state.
            <div className="contents" hidden={chatOpen && chatLayout.replacesInspector}>
              <Inspector project={project} />
            </div>
          )}
        </main>
        <AgentPanel project={project} layout={chatLayout} />
      </div>
    </div>
  );
}

export function App(): ReactElement {
  const project = useProjectStore(selectProject);
  useApplicationEvents();

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      {project === null ? <Welcome /> : <ProjectLayout project={project} />}
      <SettingsDialog project={project} />
      <QuickStartGuide />
      <ConfirmDialog />
      <ProjectHealth />
      <Notices />
    </div>
  );
}
