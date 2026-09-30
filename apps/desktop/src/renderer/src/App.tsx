import { useEffect, type ReactElement } from 'react';
import { AgentPanel } from './components/AgentPanel';
import { BrandKitPanel } from './components/BrandKitPanel';
import { Inspector } from './components/Inspector';
import { KomaStrip } from './components/KomaStrip';
import { ConfirmDialog, Notices } from './components/Overlays';
import { SettingsDialog } from './components/SettingsDialog';
import { TopBar } from './components/TopBar';
import { Welcome } from './components/Welcome';
import { Workspace } from './components/Workspace';
import { detectProviders } from './lib/agentActions';
import { invoke, subscribe } from './lib/api';
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
    });
    const unsubscribeClose = subscribe('koma:app:save-and-close', () => {
      void saveAndClose();
    });
    const unfollowUpdates = followUpdates();
    return () => {
      unsubscribeStatus();
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

export function App(): ReactElement {
  const project = useProjectStore(selectProject);
  const view = useUiStore((state) => state.view);
  useApplicationEvents();

  return (
    <div className="flex h-full flex-col">
      <TopBar />
      {project === null ? (
        <Welcome />
      ) : (
        <div className="flex min-h-0 flex-1">
          <KomaStrip project={project} />
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <main className="flex min-h-0 flex-1">
              <Workspace project={project} />
              {view === 'brandKit' ? (
                <BrandKitPanel project={project} />
              ) : (
                <Inspector project={project} />
              )}
            </main>
            <AgentPanel project={project} />
          </div>
        </div>
      )}
      <SettingsDialog project={project} />
      <ConfirmDialog />
      <Notices />
    </div>
  );
}
