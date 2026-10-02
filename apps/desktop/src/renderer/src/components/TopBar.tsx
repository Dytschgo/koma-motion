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
    <header className="flex min-h-12 flex-none flex-wrap items-center gap-1 border-b border-line bg-surface-1 px-2.5 py-1">
      <div className="mr-3 flex items-center gap-2 pl-1">
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
        <Button compact disabled={!hasProject} onClick={() => void saveProjectAs()}>
          Save as
        </Button>
        <PowerPointExport key={sessionId} />
      </nav>

      <span className="mx-1.5 h-5 w-px bg-line" aria-hidden="true" />

      <IconButton label="Undo" disabled={!canUndo} onClick={undo}>
        <UndoIcon />
      </IconButton>
      <IconButton label="Redo" disabled={!canRedo} onClick={redo}>
        <RedoIcon />
      </IconButton>

      <div className="flex min-w-0 flex-1 items-center justify-center px-3">
        {hasProject && (
          <div className="flex h-8 min-w-0 max-w-[min(32rem,100%)] items-center gap-2.5 rounded-full border border-line bg-surface-0/60 pr-3 pl-3.5">
            <span className="min-w-0 truncate font-medium text-ink-100" title={file?.displayPath}>
              {file?.fileName ?? (projectName.trim() === '' ? 'Untitled' : projectName)}
            </span>
            {/* One status: the name already says which project this is. */}
            <span role="status" className="flex flex-none items-center gap-1.5 text-sm">
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
          </div>
        )}
      </div>

      {updateReady && (
        <Button
          icon={<DownloadIcon size={14} />}
          className="text-accent"
          onClick={() => {
            openSettings('updates');
          }}
        >
          {update.state === 'downloaded' ? 'Update ready' : 'Update available'}
        </Button>
      )}
      <ProjectHealthButton />
      <Button
        icon={<PlayIcon size={12} />}
        className="border border-motion/40 bg-motion-deep/70 text-motion hover:border-motion/70 hover:bg-motion-deep disabled:border-line disabled:bg-transparent disabled:text-line-strong"
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
      <PresentButton />
      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />
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
