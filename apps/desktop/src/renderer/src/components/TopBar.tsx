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
import { useUiStore } from '../state/uiStore';
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
import { Button, IconButton } from './ui';
import { ProjectHealthButton } from './ProjectHealth';

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
  const hasProject = useProjectStore((state) => selectProject(state) !== null);
  const hasUnsavedChanges = useProjectStore(selectHasUnsavedChanges);
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const file = useProjectStore((state) => state.file);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const startPreview = useUiStore((state) => state.startPreview);
  const openSettings = useUiStore((state) => state.openSettings);
  const transition = useCurrentTransition();
  const presentation = useProjectStore((state) => selectProject(state)?.presentation ?? null);
  const context =
    transition === null || presentation === null
      ? null
      : getTransitionContext(presentation, transition.id);
  // The warning next to the preview controls explains why.
  const blocked =
    presentation !== null &&
    context !== null &&
    assessTransition(presentation, context.transition, context.from, context.to)?.blocked === true;
  const update = useUpdateStore((state) => state.status);
  const nightly = update !== null && isNightlyVersion(update.currentVersion);
  const updateReady =
    update !== null && (update.state === 'available' || update.state === 'downloaded');

  return (
    <header className="studio-topbar flex min-h-14 flex-none flex-wrap items-center gap-1 border-b border-desk-600 px-3 py-1">
      <div className="mr-4 flex items-center gap-2.5">
        <KomaMark />
        <span className="whitespace-nowrap text-lg font-semibold tracking-tight">Koma Motion</span>
        {nightly && (
          <span
            className="rounded-full border border-signal-warn/60 px-2 py-0.5 text-xs text-signal-warn"
            title={`Nightly version ${update.currentVersion}`}
          >
            Nightly
          </span>
        )}
      </div>

      <nav
        aria-label="Project"
        className="flex items-center gap-0.5 rounded-lg border border-desk-600/80 bg-desk-900/50 p-0.5"
      >
        <IconButton label="New" onClick={() => void createNewProject()}>
          <PlusIcon />
        </IconButton>
        <IconButton label="Open" onClick={() => void openProject()}>
          <OpenIcon />
        </IconButton>
        <span className="mx-0.5 h-4 w-px bg-desk-600" aria-hidden="true" />
        <IconButton label="Save" disabled={!hasProject} onClick={() => void saveProject()}>
          <SaveIcon />
        </IconButton>
        <Button disabled={!hasProject} onClick={() => void saveProjectAs()}>
          Save as
        </Button>
      </nav>

      <div className="mx-2 h-5 w-px bg-desk-600" aria-hidden="true" />

      <IconButton label="Undo" disabled={!canUndo} onClick={undo}>
        <UndoIcon />
      </IconButton>
      <IconButton label="Redo" disabled={!canRedo} onClick={redo}>
        <RedoIcon />
      </IconButton>

      <div className="flex min-w-0 flex-1 items-center justify-center gap-3 px-2">
        {hasProject && (
          <>
            <span className="truncate text-ink-300" title={file?.displayPath}>
              {file?.fileName ?? 'Not saved yet'}
            </span>
            <span role="status" className="flex flex-none items-center gap-1.5 text-sm">
              {hasUnsavedChanges ? (
                <>
                  <span className="size-2 rounded-full bg-pencil-red" aria-hidden="true" />
                  <span className="text-pencil-red">Unsaved changes</span>
                </>
              ) : (
                <span className="text-ink-400">{file === null ? '' : 'All changes saved'}</span>
              )}
            </span>
          </>
        )}
      </div>

      {updateReady && (
        <Button
          icon={<DownloadIcon size={14} />}
          className="text-pencil-blue"
          onClick={() => {
            openSettings('updates');
          }}
        >
          {update.state === 'downloaded' ? 'Update ready' : 'Update available'}
        </Button>
      )}
      <ProjectHealthButton />
      <Button
        variant="outline"
        icon={<PlayIcon size={14} />}
        disabled={transition === null || blocked}
        title={
          blocked
            ? 'This transition cannot play. See the warning above the preview controls.'
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
      <IconButton
        label="Settings"
        onClick={() => {
          openSettings();
        }}
      >
        <SettingsIcon />
      </IconButton>
    </header>
  );
}
