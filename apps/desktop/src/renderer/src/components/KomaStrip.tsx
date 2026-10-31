import {
  findTransitionBetween,
  type Koma,
  type KomaProject,
  type KomaTransition,
  type Presentation,
} from '@koma-motion/core';
import { createAssetResolver, type AssetResolver } from '@koma-motion/renderer';
import {
  useCallback,
  useEffect,
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
import { deleteKoma, duplicateKomaInProject, reorderKoma } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useTransitionRegenerationStore } from '../state/transitionRegenerationStore';
import { useUiStore } from '../state/uiStore';
import { PlusIcon } from './icons';
import { DeckOverview } from './DeckOverview';
import { IconButton } from './ui';
import { KomaContextMenu, type KomaMenuAnchor } from './KomaContextMenu';
import { KomaThumbnail } from './KomaThumbnail';

/** Width of a filmstrip thumbnail in CSS pixels. */
const THUMBNAIL_WIDTH = 96;

/**
 * The motion between two neighbouring Komas. Selecting it opens that motion
 * below the canvas: a playable motion starts its preview, a motion that
 * cannot play shows what is wrong and how to fix it.
 */
function MotionMarker({
  presentation,
  transition,
  fromKoma,
  toKoma,
  from,
  active,
  tabbable,
}: {
  readonly presentation: Presentation;
  readonly transition: KomaTransition;
  readonly fromKoma: Koma;
  readonly toKoma: Koma;
  readonly from: number;
  readonly active: boolean;
  /** Markers beside the selected Koma are in the Tab order; Tab skips the others. */
  readonly tabbable: boolean;
}): ReactElement {
  const assessment = assessTransition(presentation, transition, fromKoma, toKoma);
  const blocked = assessment?.blocked === true;
  const regenerating = useTransitionRegenerationStore(
    (state) => state.entries[transition.id]?.status === 'running',
  );
  const to = from + 1;
  const label = blocked
    ? `Motion from Koma ${String(from)} to Koma ${String(to)} cannot play`
    : `Preview the transition from Koma ${String(from)} to Koma ${String(to)}`;
  const state = blocked ? 'blocked' : assessment !== null ? 'warning' : 'ready';
  return (
    <li className="filmstrip-gap">
      <button
        type="button"
        aria-label={label}
        tabIndex={tabbable ? 0 : -1}
        aria-description={
          assessment === null
            ? `${formatSeconds(transition.duration)}, ${transition.strategy}`
            : assessment.label
        }
        aria-current={active ? 'true' : undefined}
        aria-busy={regenerating || undefined}
        title={
          assessment === null
            ? `${formatSeconds(transition.duration)}, ${transition.strategy}`
            : assessment.headline
        }
        data-motion-state={state}
        className="filmstrip-marker"
        onClick={() => {
          const ui = useUiStore.getState();
          ui.selectKoma(fromKoma.id);
          ui.setMotionEditing(true);
          if (!blocked) ui.startPreview(transition.id);
        }}
      >
        <span aria-hidden="true" className="filmstrip-marker-dots">
          <span />
          <span />
          <span />
        </span>
        {state !== 'ready' && <span aria-hidden="true" className="filmstrip-marker-issue" />}
      </button>
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
  scrollRoot,
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
  readonly scrollRoot: RefObject<HTMLElement | null>;
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
      className={`filmstrip-item ${selected ? 'is-selected' : ''} ${dragging ? 'is-dragging' : ''}`}
    >
      {dropIndicator !== null && (
        <span
          aria-hidden="true"
          data-koma-drop-indicator={dropIndicator}
          className="filmstrip-drop-indicator"
        />
      )}
      <div aria-hidden="true" className="filmstrip-frame">
        <KomaThumbnail
          koma={koma}
          aspectRatio={project.presentation.aspectRatio}
          width={THUMBNAIL_WIDTH}
          scrollRoot={scrollRoot}
          resolveAsset={resolveAsset}
        />
      </div>
      <span aria-hidden="true" className="filmstrip-number">
        {number}
      </span>
      {/* Covers the thumbnail and its number, so the whole item selects the Koma. */}
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
    </li>
  );
}

function OverviewIcon(): ReactElement {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.3"
      aria-hidden="true"
    >
      <rect x="2" y="2" width="4.5" height="4.5" rx=".6" />
      <rect x="9.5" y="2" width="4.5" height="4.5" rx=".6" />
      <rect x="2" y="9.5" width="4.5" height="4.5" rx=".6" />
      <rect x="9.5" y="9.5" width="4.5" height="4.5" rx=".6" />
    </svg>
  );
}

/**
 * The horizontal filmstrip below the canvas: numbered Koma thumbnails with
 * the motion between neighbours, an Add button, Koma actions and an
 * overview for long decks. Thumbnails are drawn only near the visible part.
 */
export function KomaStrip({ project }: { readonly project: KomaProject }): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const preview = useUiStore((state) => state.preview);
  const motionEditing = useUiStore((state) => state.motionEditing);
  const selectedKoma = useSelectedKoma();
  const selectKoma = useUiStore((state) => state.selectKoma);
  const sessionId = useProjectStore((state) => state.sessionId);
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [menu, setMenu] = useState<KomaMenuAnchor | null>(null);
  const footer = useRef<HTMLDivElement>(null);
  const buttons = useRef(new Map<string, HTMLButtonElement>());
  const focusRequested = useRef(false);
  const strip = useRef<HTMLDivElement>(null);
  const { drag, announcement, handlers } = useKomaDrag(
    strip,
    project.presentation.komas.length,
    'x',
  );
  const resolveAsset = useMemo(() => createAssetResolver(project.assets), [project.assets]);
  const { komas } = project.presentation;
  const selectedId = selectedKoma?.id;
  const selectedIndex = komas.findIndex((koma) => koma.id === selectedId);
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
    setMenu(null);
  }, [sessionId]);
  useLayoutEffect(() => {
    if (!focusRequested.current) return undefined;
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
    return undefined;
  }, [selectedId, selectedIndex, komas.length, focusSelected]);
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
      setMenu({ komaId: koma.id, x: rect.x + 24, y: rect.y - 8, source: event.currentTarget });
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
    // Left and right follow the strip; up and down keep working as before.
    const later = event.key === 'ArrowRight' || event.key === 'ArrowDown';
    const earlier = event.key === 'ArrowLeft' || event.key === 'ArrowUp';
    const destination = later
      ? modifier && event.shiftKey
        ? komas.length - 1
        : Math.min(komas.length - 1, index + 1)
      : earlier
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
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [selectedId, selectedIndex]);

  return (
    <section aria-label="Filmstrip" className="filmstrip">
      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>
      <div
        ref={strip}
        className="filmstrip-scroll"
        onWheel={(event) => {
          // A mouse wheel scrolls the strip sideways.
          if (Math.abs(event.deltaY) > Math.abs(event.deltaX))
            event.currentTarget.scrollLeft += event.deltaY;
        }}
      >
        {komas.length === 0 ? (
          <p className="filmstrip-empty">No Komas yet</p>
        ) : (
          <ol
            aria-label="Komas"
            className={`filmstrip-list ${drag === null ? '' : 'cursor-grabbing select-none'}`}
          >
            {komas.map((koma, index) => {
              const previous = komas[index - 1];
              const transition =
                previous === undefined
                  ? undefined
                  : findTransitionBetween(project.presentation, previous.id, koma.id);
              return [
                transition !== undefined && previous !== undefined && (
                  <MotionMarker
                    key={transition.id}
                    presentation={project.presentation}
                    transition={transition}
                    fromKoma={previous}
                    toKoma={koma}
                    from={index}
                    tabbable={selectedIndex === index - 1 || selectedIndex === index}
                    active={
                      (preview !== null &&
                        preview.transitionId === transition.id &&
                        preview.fromKomaId === transition.fromKomaId &&
                        preview.toKomaId === transition.toKomaId) ||
                      (preview === null && motionEditing && selectedId === previous.id)
                    }
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
                  scrollRoot={strip}
                  register={register}
                  onKey={onThumbnailKey}
                  onMenu={setMenu}
                />,
              ];
            })}
          </ol>
        )}
      </div>

      <div ref={footer} className="filmstrip-actions">
        <IconButton
          data-koma-add=""
          label="Add Koma"
          title="Add Koma (Ctrl+M)"
          className="filmstrip-add"
          onClick={() => {
            add(selectedKoma?.id ?? null);
          }}
        >
          <PlusIcon />
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
              y: rect.y - 8,
              source: event.currentTarget,
            });
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <circle cx="3" cy="8" r="1.2" fill="currentColor" />
            <circle cx="8" cy="8" r="1.2" fill="currentColor" />
            <circle cx="13" cy="8" r="1.2" fill="currentColor" />
          </svg>
        </IconButton>
        <IconButton
          label="Deck overview"
          disabled={komas.length === 0}
          onClick={() => setOverviewOpen(true)}
        >
          <OverviewIcon />
        </IconButton>
      </div>
      {menu !== null && menuIndex >= 0 && (
        <KomaContextMenu
          anchor={menu}
          onClose={closeMenu}
          items={[
            { label: 'New Koma after', shortcut: 'Ctrl+M', action: () => add(menu.komaId) },
            { label: 'Duplicate Koma', shortcut: '⌘/Ctrl+D', action: () => duplicate(menu.komaId) },
            {
              label: 'Move Koma left',
              shortcut: '⌘/Ctrl+←',
              disabled: menuIndex === 0,
              action: () => move(menu.komaId, -1),
            },
            {
              label: 'Move Koma right',
              shortcut: '⌘/Ctrl+→',
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
    </section>
  );
}
