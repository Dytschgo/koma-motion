import {
  findTransitionBetween,
  getCanvasSize,
  type Koma,
  type KomaProject,
  type KomaTransition,
  type Presentation,
} from '@koma-motion/core';
import { komaToFrame } from '@koma-motion/motion-engine';
import { createAssetResolver, KomaStage, type AssetResolver } from '@koma-motion/renderer';
import { useMemo, type ReactElement } from 'react';
import { formatSeconds, useSelectedKoma } from '../lib/selectors';
import { assessTransition } from '../lib/transitionIssues';
import { addKomaAfter } from '../lib/projectActions';
import { deleteKoma, renameProject, reorderKoma } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { DownIcon, PlusIcon, TrashIcon, UpIcon, WarningIcon } from './icons';
import { Button, IconButton, TextInput } from './ui';

const THUMBNAIL_WIDTH = 184;

function countChanges(transition: KomaTransition): number {
  const changed = new Set(
    transition.elementTransitions
      .filter((item) => item.operation !== 'hold')
      .map((item) => item.persistentId),
  );
  return changed.size;
}

/**
 * The in-between of two Komas. It is part of the strip because motion is
 * part of the presentation, not an effect added afterwards.
 */
function InBetween({
  presentation,
  transition,
  fromKoma,
  toKoma,
  from,
  to,
  active,
}: {
  readonly presentation: Presentation;
  readonly transition: KomaTransition;
  readonly fromKoma: Koma;
  readonly toKoma: Koma;
  readonly from: number;
  readonly to: number;
  readonly active: boolean;
}): ReactElement {
  const startPreview = useUiStore((state) => state.startPreview);
  const selectKoma = useUiStore((state) => state.selectKoma);
  const setView = useUiStore((state) => state.setView);
  const changes = countChanges(transition);
  const assessment = assessTransition(presentation, transition, fromKoma, toKoma);
  if (assessment?.blocked === true) {
    // Nothing to preview. The button shows the explanation next to the
    // preview controls instead, by selecting the Koma the transition leaves.
    return (
      <li className="flex items-stretch gap-2 pl-[18px]">
        <span aria-hidden="true" className="w-px flex-none bg-signal-warn" />
        <button
          type="button"
          aria-label={`Transition from Koma ${String(from)} to Koma ${String(to)}: ${assessment.label.toLowerCase()}. It cannot play. Show the problem`}
          className="my-1 flex min-w-0 flex-1 items-center gap-1.5 rounded-md border border-signal-warn/40 px-2 py-1 text-left text-sm text-signal-warn hover:bg-desk-700"
          onClick={() => {
            setView('canvas');
            selectKoma(fromKoma.id);
          }}
        >
          <span aria-hidden="true" className="flex-none">
            <WarningIcon size={14} />
          </span>
          <span className="truncate">{assessment.label}</span>
        </button>
      </li>
    );
  }
  return (
    <li className="flex items-stretch gap-2 pl-[18px]">
      <span
        aria-hidden="true"
        className={`w-px flex-none ${active ? 'bg-pencil-red' : 'bg-desk-500'}`}
      />
      <button
        type="button"
        aria-label={`Preview the transition from Koma ${String(from)} to Koma ${String(to)}`}
        className={`my-1 flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors ${
          active
            ? 'bg-pencil-red-deep text-ink-100'
            : 'text-ink-400 hover:bg-desk-700 hover:text-ink-100'
        }`}
        onClick={() => {
          startPreview(transition.id);
        }}
      >
        <span className="truncate">
          {formatSeconds(transition.duration)}, {transition.strategy}
        </span>
        <span className="flex flex-none items-center gap-1 tabular-nums">
          {assessment !== null && (
            <span className="text-ink-400" title={assessment.headline}>
              <WarningIcon size={12} />
              <span className="sr-only">{assessment.label}.</span>
            </span>
          )}
          {changes} {changes === 1 ? 'change' : 'changes'}
        </span>
      </button>
    </li>
  );
}

function KomaItem({
  koma,
  index,
  count,
  project,
  resolveAsset,
  selected,
}: {
  readonly koma: Koma;
  readonly index: number;
  readonly count: number;
  readonly project: KomaProject;
  readonly resolveAsset: AssetResolver;
  readonly selected: boolean;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const selectKoma = useUiStore((state) => state.selectKoma);
  const confirm = useUiStore((state) => state.confirm);
  const canvasSize = getCanvasSize(project.presentation.aspectRatio);
  const frame = useMemo(() => komaToFrame(koma), [koma]);
  const number = index + 1;

  const remove = async (): Promise<void> => {
    const confirmed = await confirm({
      title: `Delete Koma ${String(number)}?`,
      message: `"${koma.title}" and its transitions are removed. You can undo this.`,
      confirmLabel: 'Delete Koma',
      cancelLabel: 'Keep Koma',
      destructive: true,
    });
    if (confirmed) {
      const neighbour =
        project.presentation.komas[index + 1] ?? project.presentation.komas[index - 1];
      apply(deleteKoma(koma.id));
      selectKoma(neighbour?.id ?? null);
    }
  };

  return (
    <li>
      <div className={`rounded-lg p-1.5 ${selected ? 'bg-pencil-blue-deep' : 'hover:bg-desk-700'}`}>
        <div className="relative flex items-start gap-2">
          <span
            aria-hidden="true"
            className={`w-5 flex-none pt-0.5 text-right text-sm tabular-nums ${
              selected ? 'font-semibold text-pencil-blue' : 'text-ink-400'
            }`}
          >
            {number}
          </span>
          <div aria-hidden="true" className="flex min-w-0 flex-col gap-1">
            <div
              className={`overflow-hidden rounded-sm outline outline-1 ${
                selected ? 'outline-pencil-blue' : 'outline-desk-600'
              }`}
            >
              <KomaStage
                frame={frame}
                canvasSize={canvasSize}
                scale={THUMBNAIL_WIDTH / canvasSize.width}
                resolveAsset={resolveAsset}
                label={koma.title}
              />
            </div>
            <span className="truncate text-sm text-ink-100">{koma.title}</span>
          </div>
          {/* Covers the thumbnail, so the whole item selects the Koma. */}
          <button
            type="button"
            aria-current={selected ? 'true' : undefined}
            aria-label={`Koma ${String(number)}: ${koma.title}`}
            className="absolute inset-0 rounded-md"
            onClick={() => {
              selectKoma(koma.id);
            }}
          />
        </div>
        {selected && (
          <div className="mt-1 flex justify-end gap-0.5">
            <IconButton
              label="Move Koma up"
              disabled={index === 0}
              onClick={() => {
                apply(reorderKoma(koma.id, -1));
              }}
            >
              <UpIcon />
            </IconButton>
            <IconButton
              label="Move Koma down"
              disabled={index === count - 1}
              onClick={() => {
                apply(reorderKoma(koma.id, 1));
              }}
            >
              <DownIcon />
            </IconButton>
            <IconButton label="Delete Koma" onClick={() => void remove()}>
              <TrashIcon />
            </IconButton>
          </div>
        )}
      </div>
    </li>
  );
}

export function KomaStrip({ project }: { readonly project: KomaProject }): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const view = useUiStore((state) => state.view);
  const setView = useUiStore((state) => state.setView);
  const preview = useUiStore((state) => state.preview);
  const selectedKoma = useSelectedKoma();
  const resolveAsset = useMemo(() => createAssetResolver(project.assets), [project.assets]);
  const { komas } = project.presentation;

  return (
    <aside
      aria-label="Project"
      className="flex w-[244px] flex-none flex-col border-r border-desk-600 bg-desk-800"
    >
      <div className="border-b border-desk-600 p-3">
        <label htmlFor="project-name" className="mb-1 block text-sm text-ink-300">
          Project name
        </label>
        <TextInput
          id="project-name"
          value={project.name}
          maxLength={200}
          aria-invalid={project.name.trim() === '' ? true : undefined}
          onChange={(event) => {
            apply(renameProject(event.target.value), { coalesceKey: 'project-name' });
          }}
        />
        {project.name.trim() === '' && (
          <p role="alert" className="mt-1 text-sm text-pencil-red">
            Error: A project needs a name before it can be saved.
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-2">
        {komas.length === 0 ? (
          <p className="px-2 py-6 text-ink-400">
            No Komas yet. Describe your presentation in the chat, or add an empty Koma.
          </p>
        ) : (
          <ol aria-label="Komas" className="flex flex-col">
            {komas.map((koma, index) => {
              const previous = komas[index - 1];
              const transition =
                previous === undefined
                  ? undefined
                  : findTransitionBetween(project.presentation, previous.id, koma.id);
              return [
                transition !== undefined && previous !== undefined && (
                  <InBetween
                    key={transition.id}
                    presentation={project.presentation}
                    transition={transition}
                    fromKoma={previous}
                    toKoma={koma}
                    from={index}
                    to={index + 1}
                    active={
                      preview !== null &&
                      preview.transitionId === transition.id &&
                      preview.fromKomaId === transition.fromKomaId &&
                      preview.toKomaId === transition.toKomaId
                    }
                  />
                ),
                <KomaItem
                  key={koma.id}
                  koma={koma}
                  index={index}
                  count={komas.length}
                  project={project}
                  resolveAsset={resolveAsset}
                  selected={selectedKoma?.id === koma.id}
                />,
              ];
            })}
          </ol>
        )}
      </div>

      <div className="flex flex-col gap-1 border-t border-desk-600 p-2">
        <Button
          variant="outline"
          icon={<PlusIcon size={14} />}
          onClick={() => {
            addKomaAfter(selectedKoma?.id ?? null);
          }}
        >
          Add Koma
        </Button>
        <Button
          aria-pressed={view === 'brandKit'}
          active={view === 'brandKit'}
          onClick={() => {
            setView(view === 'brandKit' ? 'canvas' : 'brandKit');
          }}
        >
          <span
            aria-hidden="true"
            className="flex overflow-hidden rounded-sm outline outline-1 outline-desk-500"
          >
            {[
              project.brandKit.colours.primary,
              project.brandKit.colours.secondary,
              project.brandKit.colours.accent,
            ].map((colour, index) => (
              <span key={index} className="size-3" style={{ background: colour }} />
            ))}
          </span>
          Brand Kit
        </Button>
      </div>
    </aside>
  );
}
