import { useMemo, type ReactElement } from 'react';
import { createNewProject, openProject, saveProject, saveProjectAs } from '../lib/projectActions';
import { getTransitionContext, useCurrentTransition, useSelectedKoma } from '../lib/selectors';
import { assessTransition } from '../lib/transitionIssues';
import { AUTHORING_KINDS, AUTHORING_LABELS } from '../lib/authoring';
import { addElementToSelectedKoma } from '../lib/elementActions';
import { collectHealthIssues } from '../lib/projectHealth';
import {
  selectCanRedo,
  selectCanUndo,
  selectHasUnsavedChanges,
  selectProject,
  useProjectStore,
} from '../state/projectStore';
import { isNightlyVersion } from '../../../shared/updates';
import { downloadUpdate } from '../lib/updateActions';
import { chooseKomaImage } from '../lib/projectActions';
import { detectProviders } from '../lib/agentActions';
import { useHealthStore } from '../state/healthStore';
import { useQuickStartStore } from '../state/quickStartStore';
import { usePresenterStore } from '../state/presenterStore';
import { useUiStore } from '../state/uiStore';
import { renameProject } from '../state/commands';
import { useUpdateStore } from '../state/updateStore';
import {
  ChevronIcon,
  DownloadIcon,
  ImageIcon,
  KomaMark,
  PlayIcon,
  PlusIcon,
  RedoIcon,
  ShapeIcon,
  TextIcon,
  UndoIcon,
} from './icons';
import { Button, IconButton, TextInput } from './ui';
import { MenuButton, type MenuItem } from './Menu';
import { ProjectHealthButton } from './ProjectHealth';
import { PowerPointExport } from './PowerPointExport';

function ShareIcon(): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 10V2.5M5 5.2 8 2.3l3 2.9M3 8.5v4.8h10V8.5" />
    </svg>
  );
}

function PropertiesIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <path d="M2.5 4.5h6M11.5 4.5h2M2.5 11.5h2M7.5 11.5h6" />
      <circle cx="10" cy="4.5" r="1.5" />
      <circle cx="6" cy="11.5" r="1.5" />
    </svg>
  );
}

/** One thin bar: the project, history, adding, properties, playing and sharing. */
export function TopBar(): ReactElement {
  const project = useProjectStore(selectProject);
  const projectName = project?.name ?? null;
  const hasProject = project !== null;
  const hasKomas = (project?.presentation.komas.length ?? 0) > 0;
  const hasUnsavedChanges = useProjectStore(selectHasUnsavedChanges);
  const canUndo = useProjectStore(selectCanUndo);
  const canRedo = useProjectStore(selectCanRedo);
  const file = useProjectStore((state) => state.file);
  const sessionId = useProjectStore((state) => state.sessionId);
  const warnings = useProjectStore((state) => state.loadWarnings);
  const migratedFrom = useProjectStore((state) => state.migratedFrom);
  const healthFailure = useHealthStore((state) => state.failure);
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const apply = useProjectStore((state) => state.apply);
  const preview = useUiStore((state) => state.preview);
  const motionEditing = useUiStore((state) => state.motionEditing);
  const propertiesOpen = useUiStore((state) => state.propertiesOpen);
  const openSettings = useUiStore((state) => state.openSettings);
  const selectedKoma = useSelectedKoma();
  const transition = useCurrentTransition();
  const startPresentation = usePresenterStore((state) => state.start);
  const context =
    transition === null || project === null
      ? null
      : getTransitionContext(project.presentation, transition.id);
  // A motion that cannot play is explained on its marker in the filmstrip.
  const blocked =
    project !== null &&
    context !== null &&
    assessTransition(project.presentation, context.transition, context.from, context.to)
      ?.blocked === true;
  // The transition controls show while a preview plays or motion is being edited.
  const playing = preview !== null || (motionEditing && transition !== null);
  const selectedNumber =
    (project?.presentation.komas.findIndex((koma) => koma.id === selectedKoma?.id) ?? -1) + 1;
  const healthCount = useMemo(
    () => collectHealthIssues(project, warnings, migratedFrom).length + (healthFailure ? 1 : 0),
    [project, warnings, migratedFrom, healthFailure],
  );
  const update = useUpdateStore((state) => state.status);
  const updateBusy = useUpdateStore((state) => state.busy);
  const nightly = update !== null && isNightlyVersion(update.currentVersion);
  const updateReady =
    update !== null && (update.state === 'available' || update.state === 'downloaded');

  const projectItems: MenuItem[] = [
    { label: 'New', hint: 'Ctrl+N', action: () => void createNewProject() },
    { label: 'Open', hint: 'Ctrl+O', action: () => void openProject() },
    {
      label: 'Save',
      hint: 'Ctrl+S',
      disabled: !hasProject,
      action: () => void saveProject(),
    },
    {
      label: 'Brand Kit',
      separated: true,
      disabled: !hasProject,
      action: () => useUiStore.getState().setView('brandKit'),
    },
    {
      label: 'Instructions & templates',
      // Project instructions accompany every request, so their state stays visible.
      hint: (project?.systemInstructions.trim() ?? '') === '' ? undefined : 'Active',
      description:
        (project?.systemInstructions.trim() ?? '') === ''
          ? 'No project instructions'
          : 'Instructions active',
      disabled: !hasProject,
      action: () => openSettings('instructions'),
    },
    {
      label: 'Model',
      disabled: !hasProject,
      action: () => useUiStore.getState().showModelPicker(),
    },
    { label: 'Refresh providers', action: () => void detectProviders() },
    { label: 'Settings', action: () => openSettings() },
    {
      label: 'Project health',
      separated: true,
      action: () => useHealthStore.getState().setOpen(true),
    },
    {
      label: 'Getting started',
      action: () => useQuickStartStore.getState().setOpen(true),
    },
  ];

  const addItems: MenuItem[] = [
    ...AUTHORING_KINDS.map((kind): MenuItem => ({
      label: AUTHORING_LABELS[kind],
      icon: kind === 'text' ? <TextIcon size={14} /> : <ShapeIcon size={14} />,
      action: () => addElementToSelectedKoma(kind),
    })),
    {
      label: 'Image',
      icon: <ImageIcon size={14} />,
      action: () => {
        const id = selectedKoma?.id;
        if (id !== undefined) void chooseKomaImage(id);
      },
    },
  ];

  return (
    <header className="studio-topbar">
      <div className="studio-topbar-start">
        <MenuButton
          label="Project menu"
          className="studio-project-menu"
          items={projectItems}
          title="Project, settings and help"
        >
          <KomaMark size={20} />
          <ChevronIcon direction="down" size={12} />
        </MenuButton>
        {nightly && (
          <span className="studio-nightly" title={`Nightly version ${update.currentVersion}`}>
            Nightly
          </span>
        )}
        {hasProject ? (
          <div className="studio-project-identity">
            <label htmlFor="project-name" className="sr-only">
              Project name
            </label>
            <TextInput
              id="project-name"
              className="studio-project-name"
              value={projectName ?? ''}
              maxLength={200}
              title={file === null ? 'Rename project' : `Rename project · ${file.displayPath}`}
              aria-invalid={projectName?.trim() === '' ? true : undefined}
              aria-describedby={projectName?.trim() === '' ? 'project-name-error' : undefined}
              onChange={(event) =>
                apply(renameProject(event.target.value), { coalesceKey: 'project-name' })
              }
            />
            <span
              role="status"
              className="studio-save-status"
              title={file === null ? undefined : file.displayPath}
            >
              <span
                aria-hidden="true"
                className={`size-1.5 flex-none rounded-full ${hasUnsavedChanges ? 'bg-accent' : 'bg-line-strong'}`}
              />
              {hasUnsavedChanges
                ? 'Unsaved changes'
                : file === null
                  ? 'Not saved yet'
                  : 'All changes saved'}
            </span>
            {projectName?.trim() === '' && (
              <p id="project-name-error" role="alert" className="studio-project-error">
                A project needs a name before it can be saved.
              </p>
            )}
          </div>
        ) : (
          <span className="px-2 font-semibold tracking-tight">Koma Motion</span>
        )}
        {hasProject && (
          <div className="studio-topbar-group" role="group" aria-label="History and adding">
            <IconButton label="Undo" disabled={!canUndo} onClick={undo}>
              <UndoIcon />
            </IconButton>
            <IconButton label="Redo" disabled={!canRedo} onClick={redo}>
              <RedoIcon />
            </IconButton>
            <MenuButton
              label="Add element"
              guideTarget="add-element"
              className="studio-icon-trigger"
              items={addItems}
              disabled={selectedKoma === null || preview !== null}
            >
              <PlusIcon />
            </MenuButton>
          </div>
        )}
      </div>

      <div className="studio-topbar-end">
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
        {healthCount > 0 && <ProjectHealthButton />}
        {hasProject && (
          <>
            <IconButton
              label="Properties"
              aria-expanded={propertiesOpen}
              active={propertiesOpen}
              disabled={!hasProject}
              onClick={() => {
                const ui = useUiStore.getState();
                if (ui.propertiesOpen) ui.setPropertiesOpen(false);
                else ui.inspectSelection();
              }}
            >
              <PropertiesIcon />
            </IconButton>
            <div className="studio-play" data-guide-target="play">
              {playing ? (
                <Button
                  variant="outline"
                  className="studio-play-main"
                  onClick={() => useUiStore.getState().setMotionEditing(false)}
                >
                  Stop preview
                </Button>
              ) : (
                <Button
                  variant="outline"
                  className="studio-play-main"
                  icon={<PlayIcon size={12} />}
                  disabled={transition === null || blocked}
                  title={
                    blocked
                      ? 'This motion cannot play. Open its marker in the filmstrip.'
                      : 'Play the motion to the next Koma'
                  }
                  onClick={() => {
                    if (transition === null || blocked) return;
                    const ui = useUiStore.getState();
                    ui.setMotionEditing(true);
                    ui.startPreview(transition.id);
                  }}
                >
                  Play
                </Button>
              )}
              <MenuButton
                label="Present or edit motion"
                align="end"
                className="studio-play-more"
                aria-keyshortcuts="F5 Shift+F5"
                disabled={!hasKomas}
                title={hasKomas ? 'Present (F5) or edit motion timing' : 'Add a Koma to present.'}
                items={[
                  {
                    label: 'Edit motion',
                    disabled: transition === null || playing,
                    action: () => useUiStore.getState().setMotionEditing(true),
                  },
                  {
                    label: 'Present from the beginning',
                    hint: 'F5',
                    separated: true,
                    action: () => startPresentation('beginning'),
                  },
                  {
                    label: `Present from Koma ${String(Math.max(1, selectedNumber))}`,
                    hint: 'Shift+F5',
                    action: () => startPresentation('selected'),
                  },
                ]}
              >
                <ChevronIcon direction="down" size={12} />
              </MenuButton>
            </div>
            <MenuButton
              label="Share"
              align="end"
              className="studio-share"
              guideTarget="export"
              items={[
                {
                  label: 'Export PowerPoint',
                  icon: <DownloadIcon size={14} />,
                  disabled: !hasKomas,
                  action: () => useUiStore.getState().requestExport(),
                },
                { label: 'Save as', hint: 'Ctrl+Shift+S', action: () => void saveProjectAs() },
              ]}
            >
              <ShareIcon />
              Share
            </MenuButton>
          </>
        )}
      </div>
      <PowerPointExport key={sessionId} />
    </header>
  );
}
