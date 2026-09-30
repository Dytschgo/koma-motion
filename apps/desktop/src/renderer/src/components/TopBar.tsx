import type { ReactElement } from 'react';
import { createNewProject, openProject, saveProject, saveProjectAs } from '../lib/projectActions';
import { useCurrentTransition } from '../lib/selectors';
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
import { DownloadIcon, KomaMark, PlayIcon, RedoIcon, SettingsIcon, UndoIcon } from './icons';
import { Button, IconButton } from './ui';
import { ProjectHealthButton } from './ProjectHealth';

export function TopBar(): ReactElement {
  const hasProject = useProjectStore((state) => selectProject(state) !== null);
  const hasUnsavedChanges = useProjectStore(selectHasUnsavedChanges);
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const file = useProjectStore((state) => state.file);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const startPreview = useUiStore((state) => state.startPreview);
  const setSettingsOpen = useUiStore((state) => state.setSettingsOpen);
  const transition = useCurrentTransition();
  const update = useUpdateStore((state) => state.status);
  const nightly = update !== null && isNightlyVersion(update.currentVersion);
  const updateReady =
    update !== null && (update.state === 'available' || update.state === 'downloaded');

  return (
    <header className="flex min-h-12 flex-none flex-wrap items-center gap-1 border-b border-desk-600 bg-desk-800 px-3 py-1">
      <div className="mr-3 flex items-center gap-2">
        <KomaMark />
        <span className="text-lg font-semibold tracking-tight">Koma Motion</span>
        {nightly && (
          <span
            className="rounded-full border border-signal-warn/60 px-2 py-0.5 text-xs text-signal-warn"
            title={`Nightly version ${update.currentVersion}`}
          >
            Nightly
          </span>
        )}
      </div>

      <nav aria-label="Project" className="flex items-center gap-0.5">
        <Button onClick={() => void createNewProject()}>New</Button>
        <Button onClick={() => void openProject()}>Open</Button>
        <Button disabled={!hasProject} onClick={() => void saveProject()}>
          Save
        </Button>
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

      <div className="flex min-w-0 flex-1 items-center justify-center gap-3 px-4">
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
            setSettingsOpen(true);
          }}
        >
          {update.state === 'downloaded' ? 'Update ready' : 'Update available'}
        </Button>
      )}
      <ProjectHealthButton />
      <Button
        variant="outline"
        icon={<PlayIcon size={14} />}
        disabled={transition === null}
        onClick={() => {
          if (transition !== null) {
            startPreview(transition.id);
          }
        }}
      >
        Preview
      </Button>
      <IconButton
        label="Settings"
        onClick={() => {
          setSettingsOpen(true);
        }}
      >
        <SettingsIcon />
      </IconButton>
    </header>
  );
}
