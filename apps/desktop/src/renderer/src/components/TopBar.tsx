import type { ReactElement } from 'react';
import { createNewProject, openProject, saveProject, saveProjectAs } from '../lib/projectActions';
import { getTransitionContext, useCurrentTransition } from '../lib/selectors';
import { assessTransition } from '../lib/transitionIssues';
import {
  selectCanRedo,
  selectCanUndo,
  selectHasUnsavedChanges,
  selectProject,
  useProjectStore,
} from '../state/projectStore';
import { isNightlyVersion } from '../../../shared/updates';
import { downloadUpdate } from '../lib/updateActions';
import { useQuickStartStore } from '../state/quickStartStore';
import { useUiStore } from '../state/uiStore';
import { renameProject } from '../state/commands';
import { useUpdateStore } from '../state/updateStore';
import {
  DownloadIcon,
  KomaMark,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  SettingsIcon,
  UndoIcon,
} from './icons';
import { Button, IconButton, TextInput } from './ui';
import { ProjectHealthButton } from './ProjectHealth';
import { PowerPointExport } from './PowerPointExport';
import { PresentButton } from './PresentButton';

function OpenIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2 4h4l1.4 1.5H14v7.2H2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SaveIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path
        d="M2.5 2.5h9l2 2v9h-11zM5 2.5v4h6v-4M5 13.5V9h6v4.5"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TopBar(): ReactElement {
  const projectName = useProjectStore((state) => selectProject(state)?.name ?? null);
  const hasProject = projectName !== null;
  const hasUnsavedChanges = useProjectStore(selectHasUnsavedChanges);
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const file = useProjectStore((state) => state.file);
  const sessionId = useProjectStore((state) => state.sessionId);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const apply = useProjectStore((state) => state.apply);
  const startPreview = useUiStore((state) => state.startPreview);
  const openSettings = useUiStore((state) => state.openSettings);
  const transition = useCurrentTransition();
  const presentation = useProjectStore((state) => selectProject(state)?.presentation ?? null);
  const context =
    transition === null || presentation === null
      ? null
      : getTransitionContext(presentation, transition.id);
  // The Koma strip explains a transition that cannot play, on that transition.
  const blocked =
    presentation !== null &&
    context !== null &&
    assessTransition(presentation, context.transition, context.from, context.to)?.blocked === true;
  const update = useUpdateStore((state) => state.status);
  const updateBusy = useUpdateStore((state) => state.busy);
  const nightly = update !== null && isNightlyVersion(update.currentVersion);
  const updateReady =
    update !== null && (update.state === 'available' || update.state === 'downloaded');

  return (
    <header className="studio-topbar">
      <div className="studio-app-name">
        <KomaMark size={20} />
        <span className="text-base font-semibold whitespace-nowrap tracking-tight">
          Koma Motion
        </span>
        {nightly && (
          <span
            className="rounded-full border border-signal-warn/50 bg-signal-warn/10 px-2 py-px text-xs font-medium text-signal-warn"
            title={`Nightly version ${update.currentVersion}`}
          >
            Nightly
          </span>
        )}
      </div>

      <nav aria-label="Project" className="flex items-center gap-0.5">
        <IconButton label="New" onClick={() => void createNewProject()}>
          <PlusIcon />
        </IconButton>
        <IconButton label="Open" onClick={() => void openProject()}>
          <OpenIcon />
        </IconButton>
        <IconButton label="Save" disabled={!hasProject} onClick={() => void saveProject()}>
          <SaveIcon />
        </IconButton>
        <IconButton label="Save as" disabled={!hasProject} onClick={() => void saveProjectAs()}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M7.5 13.5h-5v-11h9l2 2V7M5 2.5v4h6v-4M5 13.5V9h2M9 12l3.5-3.5 1.5 1.5-3.5 3.5H9z"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </IconButton>
        <PowerPointExport key={sessionId} />
      </nav>

      <span className="mx-1.5 h-5 w-px bg-line" aria-hidden="true" />

      <IconButton label="Undo" disabled={!canUndo} onClick={undo}>
        <UndoIcon />
      </IconButton>
      <IconButton label="Redo" disabled={!canRedo} onClick={redo}>
        <RedoIcon />
      </IconButton>

      <div className="studio-project-heading">
        {hasProject && (
          <>
            <div className="studio-project-identity">
              <label htmlFor="project-name" className="sr-only">
                Project name
              </label>
              <TextInput
                id="project-name"
                className="studio-project-name"
                value={projectName}
                maxLength={200}
                title={file === null ? 'Rename project' : `Rename project · ${file.displayPath}`}
                aria-invalid={projectName.trim() === '' ? true : undefined}
                aria-describedby={projectName.trim() === '' ? 'project-name-error' : undefined}
                onChange={(event) =>
                  apply(renameProject(event.target.value), { coalesceKey: 'project-name' })
                }
              />
              {file !== null && (
                <span className="studio-project-file" title={file.displayPath}>
                  {file.fileName}
                </span>
              )}
            </div>
            <span role="status" className="studio-save-status">
              {hasUnsavedChanges ? (
                <>
                  <span className="size-1.5 rounded-full bg-motion" aria-hidden="true" />
                  <span className="text-motion">Unsaved changes</span>
                </>
              ) : (
                <span className="text-ink-400">
                  {file === null ? 'Not saved yet' : 'All changes saved'}
                </span>
              )}
            </span>
            {projectName.trim() === '' && (
              <p id="project-name-error" role="alert" className="studio-project-error">
                A project needs a name before it can be saved.
              </p>
            )}
          </>
        )}
      </div>

      <div className="studio-topbar-utilities">
        {updateReady && (
          <Button
            icon={<DownloadIcon size={14} />}
            className="text-accent"
            disabled={updateBusy}
            onClick={() => {
              if (update.terminalCommand !== undefined && update.state === 'available') {
                void downloadUpdate();
              } else {
                openSettings('updates');
              }
            }}
          >
            {update.terminalCommand !== undefined && update.state === 'available'
              ? 'Update in Terminal'
              : update.state === 'downloaded'
                ? 'Update ready'
                : 'Update available'}
          </Button>
        )}
        <ProjectHealthButton />
        <Button
          icon={<PlayIcon size={12} />}
          disabled={transition === null || blocked}
          title={
            blocked
              ? 'This transition cannot play. Use Regenerate transition in the Koma strip.'
              : undefined
          }
          onClick={() => {
            if (transition !== null && !blocked) {
              startPreview(transition.id);
            }
          }}
        >
          Preview
        </Button>
        <PresentButton />
        <IconButton
          label="Getting started"
          onClick={() => useQuickStartStore.getState().setOpen(true)}
        >
          <svg
            width="17"
            height="17"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.4"
            aria-hidden="true"
          >
            <circle cx="8" cy="8" r="6" />
            <path d="M6.3 6a1.7 1.7 0 0 1 3.4 0c0 1.4-1.7 1.3-1.7 2.7" strokeLinecap="round" />
            <circle cx="8" cy="11.3" r=".7" fill="currentColor" stroke="none" />
          </svg>
        </IconButton>
        <IconButton
          label="Settings"
          onClick={() => {
            openSettings();
          }}
        >
          <SettingsIcon />
        </IconButton>
      </div>
    </header>
  );
}
