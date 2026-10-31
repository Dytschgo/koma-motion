import type { KomaProject } from '@koma-motion/core';
import { useEffect, type ReactElement, type SyntheticEvent } from 'react';
import { Recovery } from './components/Recovery';
import { followRecovery } from './lib/recovery';
import { PromptDock } from './components/PromptDock';
import { PropertiesPanel } from './components/PropertiesPanel';
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

/** Tuck completed chat away before the person resumes editing or playback. */
function resumeEditing(event: SyntheticEvent<HTMLElement>): void {
  if (
    !useUiStore.getState().chatOpen ||
    !(event.target instanceof Element) ||
    event.target.closest('[data-guide-target="canvas"], .studio-topbar, .filmstrip') === null
  ) {
    return;
  }
  const agent = useAgentStore.getState();
  const outcome = agent.conversation.findLast((entry) => entry.kind !== 'request');
  // Editing and playback controls signal the return to the canvas before an
  // object can be covered by chat. Keep unresolved outcomes available.
  if (agent.execution === null && agent.scopedProposal === null && outcome?.kind === 'result') {
    useUiStore.getState().setChatOpen(false);
  }
}

/**
 * Canvas first: the stage fills the window, with one floating prompt and the
 * filmstrip below it. Properties open on request and can be pinned beside it.
 */
function ProjectLayout({ project }: { readonly project: KomaProject }): ReactElement {
  const pinned = useUiStore((state) => state.propertiesPinned);
  return (
    <div className="studio-body">
      <main className="studio-main">
        {/* A floating properties panel stays over the canvas, never over the prompt. */}
        <div className="studio-stage">
          <Workspace project={project} />
          {!pinned && <PropertiesPanel project={project} />}
        </div>
        <div className="studio-bottom">
          <PromptDock project={project} />
          <KomaStrip project={project} />
        </div>
      </main>
      {pinned && <PropertiesPanel project={project} />}
    </div>
  );
}

export function App(): ReactElement {
  const project = useProjectStore(selectProject);
  useApplicationEvents();

  return (
    <div
      className="studio-shell"
      onPointerDownCapture={resumeEditing}
      onFocusCapture={resumeEditing}
    >
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
