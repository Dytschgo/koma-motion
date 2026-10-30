import type { KomaProject } from '@koma-motion/core';
import { useElementSize } from '@koma-motion/renderer';
import { useEffect, type ReactElement } from 'react';
import { Recovery } from './components/Recovery';
import { followRecovery } from './lib/recovery';
import { StudioDock } from './components/StudioDock';
import { KomaStrip } from './components/KomaStrip';
import { ConfirmDialog, Notices } from './components/Overlays';
import { SettingsDialog } from './components/SettingsDialog';
import { TopBar } from './components/TopBar';
import { ProjectHealth } from './components/ProjectHealth';
import { QuickStartGuide } from './components/QuickStartGuide';
import { PresentationMode } from './components/PresentationPlayer';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import { detectProviders } from './lib/agentActions';
import { invoke, subscribe } from './lib/api';
import { getChatLayout } from './lib/chatLayout';
import { followUpdates } from './lib/updateActions';
import { groupSelection, ungroupSelection } from './lib/groupActions';
import { followFullScreen } from './lib/presentationActions';
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
import { usePresenterStore } from './state/presenterStore';
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
    const unfollowRecovery = followRecovery();
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
    const unfollowFullScreen = followFullScreen();
    return () => {
      unfollowRecovery();
      unfollowFullScreen();
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
      // As in PowerPoint: F5 presents from the beginning, Shift+F5 from the selected Koma.
      if (
        event.key === 'F5' &&
        !(event.ctrlKey || event.metaKey || event.altKey) &&
        usePresenterStore.getState().session === null &&
        useProjectStore.getState().history !== null &&
        useUiStore.getState().confirmation === null
      ) {
        event.preventDefault();
        usePresenterStore.getState().start(event.shiftKey ? 'selected' : 'beginning');
        return;
      }
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
      } else if (
        key === 'g' &&
        !isEditingText(event.target) &&
        usePresenterStore.getState().session === null &&
        useUiStore.getState().confirmation === null &&
        !useUiStore.getState().settingsOpen
      ) {
        // Ctrl/Cmd+G groups the selected elements, with Shift it ungroups a group.
        event.preventDefault();
        if (event.shiftKey) {
          ungroupSelection();
        } else {
          groupSelection();
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}

/** Komas, canvas and one shared Chat/Inspect dock at every window size. */
function ProjectLayout({ project }: { readonly project: KomaProject }): ReactElement {
  const chatWidth = useUiStore((state) => state.agentPanelWidth);
  const [attachArea, area] = useElementSize<HTMLDivElement>();
  const chatLayout = getChatLayout({
    available: area.width,
    preferred: chatWidth,
  });

  return (
    <div className="flex min-h-0 flex-1">
      <KomaStrip project={project} />
      <div ref={attachArea} className="flex min-h-0 min-w-0 flex-1">
        <main className="flex min-h-0 min-w-0 flex-1">
          <Workspace
            project={project}
            onInspectSelected={() => {
              useUiStore.getState().inspectSelection();
            }}
          />
        </main>
        <StudioDock project={project} layout={chatLayout} />
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
      <Recovery />
      <SettingsDialog project={project} />
      <QuickStartGuide />
      <ConfirmDialog />
      <ProjectHealth />
      <PresentationMode />
      <Notices />
    </div>
  );
}
