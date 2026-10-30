import {
  findTransitionBetween,
  type Koma,
  type KomaProject,
  type KomaTransition,
  type Presentation,
} from '@koma-motion/core';
import { createAssetResolver, useElementSize, type AssetResolver } from '@koma-motion/renderer';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type RefObject,
} from 'react';
import { formatSeconds, useSelectedKoma } from '../lib/selectors';
import { assessTransition } from '../lib/transitionIssues';
import { getDropOffset } from '../lib/komaDrag';
import { useKomaDrag, type KomaDragHandlers } from '../lib/useKomaDrag';
import { addKomaAfter } from '../lib/projectActions';
import { deleteKoma, duplicateKomaInProject, renameProject, reorderKoma } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import {
  ChevronIcon,
  DownIcon,
  PlusIcon,
  SettingsIcon,
  TrashIcon,
  UpIcon,
  WarningIcon,
} from './icons';
import { TransitionStripStatus } from './TransitionStripStatus';
import { DeckOverview } from './DeckOverview';
import { Button, IconButton, TextInput } from './ui';
import { clampKomaPaneWidth, getKomaPaneMaximum, KOMA_PANE_COLLAPSED_WIDTH } from '../lib/komaPane';
import { KomaPaneResizeHandle } from './KomaPaneResizeHandle';
import { KomaContextMenu, type KomaMenuAnchor } from './KomaContextMenu';
import { KomaThumbnail } from './KomaThumbnail';

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
  showDetails,
}: {
  readonly presentation: Presentation;
  readonly transition: KomaTransition;
  readonly fromKoma: Koma;
  readonly toKoma: Koma;
  readonly from: number;
  readonly to: number;
  readonly active: boolean;
  readonly showDetails: boolean;
}): ReactElement {
  const startPreview = useUiStore((state) => state.startPreview);
  const changes = countChanges(transition);
  const assessment = assessTransition(presentation, transition, fromKoma, toKoma);
  const blocked = assessment?.blocked === true;
  if (!showDetails && assessment === null) return <></>;
  let spine = 'bg-line-strong';
  if (active) {
    spine = 'bg-motion';
  }
  if (blocked) {
    spine = 'bg-signal-warn';
  }
  return (
    <li className="flex items-stretch gap-2 pl-[18px]">
      <span aria-hidden="true" className={`w-px flex-none ${spine}`} />
      <div className="my-1 flex min-w-0 flex-1 flex-col gap-1">
        {!blocked && (
          <button
            type="button"
            aria-label={`Preview the transition from Koma ${String(from)} to Koma ${String(to)}`}
            className={`flex min-w-0 flex-1 items-center justify-between gap-2 rounded-md px-2 py-1 text-left text-sm transition-colors ${
              active
                ? 'bg-motion-deep text-ink-100'
                : 'text-ink-400 hover:bg-surface-3 hover:text-ink-100'
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
        )}
        {assessment !== null && (
          <TransitionStripStatus
            transitionId={transition.id}
            from={fromKoma}
            to={toKoma}
            fromNumber={from}
            assessment={assessment}
          />
        )}
      </div>
    </li>
  );
}

function KomaItem({
  koma,
  index,
  project,
  resolveAsset,
  selected,
  dragHandlers,
  dragging,
  dropIndicator,
  thumbnailWidth,
  scrollRoot,
  details,
  register,
  onKey,
  onMenu,
}: {
  readonly koma: Koma;
  readonly index: number;
  readonly project: KomaProject;
  readonly resolveAsset: AssetResolver;
  readonly selected: boolean;
  readonly dragHandlers: KomaDragHandlers;
  /** This Koma is being dragged. */
  readonly dragging: boolean;
  /** Where a drop would place the dragged Koma relative to this one. */
  readonly dropIndicator: 'before' | 'after' | null;
  readonly thumbnailWidth: number;
  readonly scrollRoot: RefObject<HTMLElement | null>;
  readonly details: boolean;
  readonly register: (id: string, node: HTMLButtonElement | null) => void;
  readonly onKey: (event: KeyboardEvent<HTMLButtonElement>, koma: Koma, index: number) => void;
  readonly onMenu: (anchor: KomaMenuAnchor) => void;
}): ReactElement {
  const selectKoma = useUiStore((state) => state.selectKoma);
  const number = index + 1;
  const attachButton = useCallback(
    (node: HTMLButtonElement | null): void => register(koma.id, node),
    [koma.id, register],
  );

  return (
    <li
      data-koma-drag-item=""
      className={`koma-pane-item ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''}`}
    >
      {dropIndicator !== null && (
        <span
          aria-hidden="true"
          data-koma-drop-indicator={dropIndicator}
          className="koma-pane-drop-indicator"
        />
      )}
      <div className="koma-pane-thumbnail-row">
        <span aria-hidden="true" className="koma-pane-number">
          {number}
        </span>
        <div aria-hidden="true" className="koma-pane-thumbnail-content">
          <div className="koma-pane-thumbnail-frame">
            <KomaThumbnail
              koma={koma}
              aspectRatio={project.presentation.aspectRatio}
              width={thumbnailWidth}
              scrollRoot={scrollRoot}
              resolveAsset={resolveAsset}
            />
          </div>
          {details && <span className="koma-pane-title">{koma.title}</span>}
        </div>
        {/* Covers the thumbnail, so the whole item selects the Koma. */}
        <button
          type="button"
          ref={attachButton}
          tabIndex={selected ? 0 : -1}
          aria-current={selected ? 'true' : undefined}
          aria-label={`Koma ${String(number)}: ${koma.title}`}
          title={`Koma ${String(number)}: ${koma.title}`}
          className="koma-thumbnail-select"
          {...dragHandlers}
          onClick={() => {
            selectKoma(koma.id);
          }}
          onKeyDown={(event) => onKey(event, koma, index)}
          onContextMenu={(event) => {
            event.preventDefault();
            selectKoma(koma.id);
            event.currentTarget.focus();
            onMenu({
              komaId: koma.id,
              x: event.clientX,
              y: event.clientY,
              source: event.currentTarget,
            });
          }}
        />
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
  const pane = useUiStore((state) => state.komaPane);
  const setPane = useUiStore((state) => state.setKomaPane);
  const selectKoma = useUiStore((state) => state.selectKoma);
  const sessionId = useProjectStore((state) => state.sessionId);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [menu, setMenu] = useState<KomaMenuAnchor | null>(null);
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const bodyId = useId();
  const showButton = useRef<HTMLButtonElement>(null);
  const footer = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusRequested = useRef(false);
  const previousOpen = useRef(pane.open);
  const strip = useRef<HTMLDivElement>(null);
  const [measureStrip, stripSize] = useElementSize<HTMLDivElement>();
  const attachStrip = useCallback(
    (node: HTMLDivElement | null): void => {
      strip.current = node;
      measureStrip(node);
    },
    [measureStrip],
  );
  const { drag, announcement, handlers } = useKomaDrag(strip, project.presentation.komas.length);
  const resolveAsset = useMemo(() => createAssetResolver(project.assets), [project.assets]);
  const { komas } = project.presentation;
  const selectedId = selectedKoma?.id;
  const selectedIndex = komas.findIndex((koma) => koma.id === selectedId);
  const maximum = getKomaPaneMaximum(windowWidth);
  const width = clampKomaPaneWidth(pane.width, maximum);
  // Measure content space after padding and the reserved scrollbar, then allow
  // 24px for numbering, an 8px gap, and the frame's two 2px borders.
  const thumbnailWidth = Math.max(1, stripSize.width > 0 ? stripSize.width - 36 : width - 70);
  const register = useCallback((id: string, node: HTMLButtonElement | null): void => {
    if (node === null) {
      if (buttons.current.get(id) === document.activeElement) focusRequested.current = true;
      buttons.current.delete(id);
    } else buttons.current.set(id, node);
  }, []);
  const focusSelected = useCallback((): void => {
    const currentKomas = selectProject(useProjectStore.getState())?.presentation.komas;
    const current =
      currentKomas?.find((koma) => koma.id === useUiStore.getState().selectedKomaId)?.id ??
      currentKomas?.[0]?.id;
    const target = current === undefined || current === null ? null : buttons.current.get(current);
    (target ?? footer.current?.querySelector<HTMLButtonElement>('[data-koma-add]'))?.focus();
  }, []);
  useEffect(() => {
    const resize = (): void => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);
  useEffect(() => {
    setMenu(null);
  }, [sessionId]);
  useLayoutEffect(() => {
    if (previousOpen.current !== pane.open) {
      previousOpen.current = pane.open;
      if (pane.open) focusSelected();
      else showButton.current?.focus();
    } else if (pane.open && focusRequested.current) {
      // A native modal keeps the rest of the document inert until close().
      // Deletion can commit before the confirmation's closing effect runs.
      const dialog = document.querySelector<HTMLDialogElement>('dialog[open]');
      if (dialog !== null) {
        const restore = (): void => {
          focusRequested.current = false;
          focusSelected();
        };
        dialog.addEventListener('close', restore, { once: true });
        return () => dialog.removeEventListener('close', restore);
      }
      focusRequested.current = false;
      focusSelected();
    }
    return undefined;
  }, [pane.open, selectedId, selectedIndex, komas.length, focusSelected]);
  const move = (komaId: string, offset: number): void => {
    if (offset === 0) return;
    focusRequested.current = true;
    selectKoma(komaId);
    apply(reorderKoma(komaId, offset));
  };
  const add = (komaId: string | null): void => {
    focusRequested.current = true;
    addKomaAfter(komaId);
  };
  const duplicate = (komaId: string): void => {
    const current = selectProject(useProjectStore.getState());
    const index = current?.presentation.komas.findIndex((koma) => koma.id === komaId) ?? -1;
    if (index < 0) return;
    focusRequested.current = true;
    apply(duplicateKomaInProject(komaId));
    const copied = selectProject(useProjectStore.getState())?.presentation.komas[index + 1];
    if (copied !== undefined) selectKoma(copied.id);
  };
  const remove = async (komaId: string): Promise<void> => {
    const current = selectProject(useProjectStore.getState());
    const index = current?.presentation.komas.findIndex((koma) => koma.id === komaId) ?? -1;
    const koma = current?.presentation.komas[index];
    if (koma === undefined) return;
    const confirmed = await useUiStore.getState().confirm({
      title: `Delete Koma ${String(index + 1)}?`,
      message: `"${koma.title}" and its transitions are removed. You can undo this.`,
      confirmLabel: 'Delete Koma',
      cancelLabel: 'Keep Koma',
      destructive: true,
    });
    if (!confirmed || useProjectStore.getState().sessionId !== sessionId) return;
    const live = selectProject(useProjectStore.getState())?.presentation.komas ?? [];
    const liveIndex = live.findIndex((item) => item.id === komaId);
    if (liveIndex < 0) return;
    const neighbour = live[liveIndex + 1] ?? live[liveIndex - 1];
    focusRequested.current = true;
    apply(deleteKoma(komaId));
    selectKoma(neighbour?.id ?? null);
  };
  const onThumbnailKey = (
    event: KeyboardEvent<HTMLButtonElement>,
    koma: Koma,
    index: number,
  ): void => {
    if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      event.preventDefault();
      event.stopPropagation();
      const rect = event.currentTarget.getBoundingClientRect();
      setMenu({ komaId: koma.id, x: rect.x + 24, y: rect.y + 24, source: event.currentTarget });
      return;
    }
    if (event.altKey) return;
    const modifier = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (modifier && key === 'd') {
      event.preventDefault();
      event.stopPropagation();
      duplicate(koma.id);
      return;
    }
    // Command+M belongs to the native macOS Window > Minimize menu.
    if (event.ctrlKey && !event.metaKey && key === 'm') {
      event.preventDefault();
      event.stopPropagation();
      add(koma.id);
      return;
    }
    if (!modifier && event.key === 'Delete') {
      event.preventDefault();
      void remove(koma.id);
      return;
    }
    const destination =
      event.key === 'ArrowDown'
        ? modifier && event.shiftKey
          ? komas.length - 1
          : Math.min(komas.length - 1, index + 1)
        : event.key === 'ArrowUp'
          ? modifier && event.shiftKey
            ? 0
            : Math.max(0, index - 1)
          : !modifier && event.key === 'Home'
            ? 0
            : !modifier && event.key === 'End'
              ? komas.length - 1
              : null;
    if (destination === null) return;
    event.preventDefault();
    event.stopPropagation();
    if (modifier) move(koma.id, destination - index);
    else {
      const target = komas[destination];
      if (target !== undefined) {
        selectKoma(target.id);
        buttons.current.get(target.id)?.focus();
      }
    }
  };
  const menuIndex = menu === null ? -1 : komas.findIndex((koma) => koma.id === menu.komaId);
  const closeMenu = useCallback(
    (restoreFocus: boolean): void => {
      setMenu(null);
      if (restoreFocus) {
        if (menu?.source.isConnected) menu.source.focus();
        else focusSelected();
      }
    },
    [menu, focusSelected],
  );
  /** Shown only where a drop would change the order. */
  const dropIndicatorFor = (index: number, count: number): 'before' | 'after' | null => {
    if (drag === null || getDropOffset(drag.from, drag.insertion) === 0) return null;
    if (drag.insertion === index) return 'before';
    return drag.insertion === count && index === count - 1 ? 'after' : null;
  };
  useEffect(() => {
    strip.current
      ?.querySelector<HTMLButtonElement>('button[aria-current="true"]')
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedId, selectedIndex]);

  return (
    <aside
      aria-label="Project"
      className="koma-pane"
      style={{ inlineSize: pane.open ? width : KOMA_PANE_COLLAPSED_WIDTH }}
    >
      {!pane.open && (
        <button
          ref={showButton}
          type="button"
          className="koma-pane-show"
          aria-label="Show Koma thumbnails"
          aria-expanded={false}
          aria-controls={bodyId}
          onClick={() => setPane({ open: true })}
        >
          <ChevronIcon direction="right" />
          <span>Komas</span>
          <span className="tabular-nums">{komas.length}</span>
        </button>
      )}
      <div id={bodyId} hidden={!pane.open} className="koma-pane-body">
        <div className="koma-pane-header">
          <div className="koma-pane-heading-row">
            <span className="koma-pane-heading">
              Komas <span className="text-ink-400 tabular-nums">{komas.length}</span>
            </span>
            <IconButton
              label={pane.details ? 'Hide Koma details' : 'Show Koma details'}
              aria-pressed={pane.details}
              onClick={() => setPane({ details: !pane.details })}
            >
              <SettingsIcon size={14} />
            </IconButton>
            <IconButton
              label="Hide Koma thumbnails"
              aria-expanded={true}
              aria-controls={bodyId}
              onClick={() => setPane({ open: false })}
            >
              <ChevronIcon direction="left" size={14} />
            </IconButton>
          </div>
          <label htmlFor="project-name" className="sr-only">
            Project name
          </label>
          <TextInput
            id="project-name"
            className="koma-pane-project-name"
            value={project.name}
            maxLength={200}
            aria-invalid={project.name.trim() === '' ? true : undefined}
            onChange={(event) => {
              apply(renameProject(event.target.value), { coalesceKey: 'project-name' });
            }}
          />
          {project.name.trim() === '' && (
            <p role="alert" className="mt-1 text-sm text-motion">
              Error: A project needs a name before it can be saved.
            </p>
          )}
          <Button
            variant="outline"
            className="koma-pane-overview"
            disabled={komas.length === 0}
            onClick={() => {
              setOverviewOpen(true);
            }}
          >
            Deck overview <span className="text-ink-400 tabular-nums">{komas.length}</span>
          </Button>
        </div>

        <p aria-live="polite" className="sr-only">
          {announcement}
        </p>
        <div ref={attachStrip} className="koma-pane-scroll">
          {komas.length === 0 ? (
            <p className="px-2 py-6 text-ink-400">Your Komas will appear here.</p>
          ) : (
            <ol
              aria-label="Komas"
              className={`koma-pane-list ${drag === null ? '' : 'cursor-grabbing select-none'}`}
            >
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
                      showDetails={pane.details}
                    />
                  ),
                  <KomaItem
                    key={koma.id}
                    koma={koma}
                    index={index}
                    project={project}
                    resolveAsset={resolveAsset}
                    selected={selectedKoma?.id === koma.id}
                    dragHandlers={handlers(koma.id, index)}
                    dragging={drag?.komaId === koma.id}
                    dropIndicator={dropIndicatorFor(index, komas.length)}
                    thumbnailWidth={thumbnailWidth}
                    scrollRoot={strip}
                    details={pane.details}
                    register={register}
                    onKey={onThumbnailKey}
                    onMenu={setMenu}
                  />,
                ];
              })}
            </ol>
          )}
        </div>

        <div ref={footer} className="koma-pane-footer">
          <div className="koma-pane-actions">
            <IconButton
              label="Move Koma up"
              disabled={selectedIndex <= 0}
              onClick={() => {
                if (selectedId !== undefined) move(selectedId, -1);
              }}
            >
              <UpIcon size={14} />
            </IconButton>
            <IconButton
              label="Move Koma down"
              disabled={selectedIndex < 0 || selectedIndex === komas.length - 1}
              onClick={() => {
                if (selectedId !== undefined) move(selectedId, 1);
              }}
            >
              <DownIcon size={14} />
            </IconButton>
            <IconButton
              label="Delete Koma"
              disabled={selectedId === undefined}
              onClick={() => {
                if (selectedId !== undefined) void remove(selectedId);
              }}
            >
              <TrashIcon size={14} />
            </IconButton>
            <IconButton
              label="Koma actions"
              disabled={selectedId === undefined}
              aria-haspopup="menu"
              aria-expanded={menu !== null}
              onClick={(event) => {
                if (selectedId === undefined) return;
                const rect = event.currentTarget.getBoundingClientRect();
                setMenu({
                  komaId: selectedId,
                  x: rect.x,
                  y: rect.y,
                  source: buttons.current.get(selectedId) ?? event.currentTarget,
                });
              }}
            >
              <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
                <circle cx="3" cy="8" r="1.2" fill="currentColor" />
                <circle cx="8" cy="8" r="1.2" fill="currentColor" />
                <circle cx="13" cy="8" r="1.2" fill="currentColor" />
              </svg>
            </IconButton>
          </div>
          <Button
            data-koma-add=""
            variant="outline"
            icon={<PlusIcon size={14} />}
            onClick={() => {
              add(selectedKoma?.id ?? null);
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
              className="flex overflow-hidden rounded-sm outline outline-1 outline-line-strong"
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
      </div>
      {pane.open && (
        <KomaPaneResizeHandle
          width={width}
          maximum={maximum}
          controls={bodyId}
          onResize={(value) => setPane({ width: value })}
          onCollapse={() => setPane({ open: false })}
        />
      )}
      {menu !== null && menuIndex >= 0 && (
        <KomaContextMenu
          anchor={menu}
          onClose={closeMenu}
          items={[
            { label: 'New Koma after', shortcut: 'Ctrl+M', action: () => add(menu.komaId) },
            { label: 'Duplicate Koma', shortcut: '⌘/Ctrl+D', action: () => duplicate(menu.komaId) },
            {
              label: 'Move Koma up',
              disabled: menuIndex === 0,
              action: () => move(menu.komaId, -1),
            },
            {
              label: 'Move Koma down',
              disabled: menuIndex === komas.length - 1,
              action: () => move(menu.komaId, 1),
            },
            {
              label: 'Delete Koma',
              shortcut: 'Delete',
              action: () => {
                void remove(menu.komaId);
              },
            },
          ]}
        />
      )}
      <DeckOverview
        project={project}
        selectedKoma={selectedKoma}
        open={overviewOpen}
        onClose={() => {
          setOverviewOpen(false);
        }}
      />
    </aside>
  );
}
