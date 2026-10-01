import { getCanvasSize, type Koma, type KomaElement, type Size } from '@koma-motion/core';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import {
  describeElementKind,
  filterLayers,
  getCanvasPlacement,
  getLayerName,
  LAYER_FILTER_THRESHOLD,
  LAYER_PAGE_SIZE,
  orderLayers,
} from '../../lib/layers';
import { chooseKomaImage } from '../../lib/projectActions';
import { changeElement } from '../../state/commands';
import { useProjectStore } from '../../state/projectStore';
import { useUiStore } from '../../state/uiStore';
import {
  ChevronIcon,
  EyeIcon,
  EyeOffIcon,
  GroupIcon,
  ImageIcon,
  LockIcon,
  ShapeIcon,
  TextIcon,
  UnlockIcon,
} from '../icons';
import { Button, IconButton, TextInput } from '../ui';

export function ElementTypeIcon({
  element,
  size = 14,
}: {
  readonly element: KomaElement;
  readonly size?: number;
}): ReactElement {
  switch (element.type) {
    case 'text':
      return <TextIcon size={size} />;
    case 'image':
      return <ImageIcon size={size} />;
    case 'shape':
      return <ShapeIcon size={size} />;
    case 'group':
      return <GroupIcon size={size} />;
  }
}

/** The state of a layer in words, for its second line and its accessible name. */
export function describeLayerState(element: KomaElement, canvas: Size): string[] {
  const parts: string[] = [];
  if (!element.visible) parts.push('hidden');
  if (element.locked) parts.push('locked');
  const placement = getCanvasPlacement(element, canvas);
  if (placement === 'partly') parts.push('partly off the canvas');
  if (placement === 'outside') parts.push('off the canvas');
  return parts;
}

function focusRow(list: HTMLElement | null, elementId: string): void {
  list
    ?.querySelector<HTMLButtonElement>(`[data-layer-id="${CSS.escape(elementId)}"]`)
    ?.focus({ preventScroll: false });
}

function LayerRow({
  komaId,
  element,
  canvas,
  selected,
  tabStop,
  disabled,
  onSelect,
  onKeyDown,
}: {
  readonly komaId: string;
  readonly element: KomaElement;
  readonly canvas: Size;
  readonly selected: boolean;
  /** The row that the Tab key reaches. The arrow keys move between rows. */
  readonly tabStop: boolean;
  readonly disabled: boolean;
  readonly onSelect: () => void;
  readonly onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const name = getLayerName(element);
  const state = describeLayerState(element, canvas);
  const kind = describeElementKind(element);
  const change = (next: KomaElement): void => {
    apply(changeElement(komaId, next));
  };

  return (
    <li
      className={`group flex items-center gap-1 rounded-md pr-0.5 ${
        selected ? 'bg-accent-deep/55 text-ink-100' : 'text-ink-300 hover:bg-surface-2'
      }`}
    >
      <button
        type="button"
        data-layer-id={element.id}
        aria-pressed={selected}
        aria-label={`${name}, ${kind}${state.length > 0 ? `, ${state.join(', ')}` : ''}`}
        tabIndex={tabStop ? 0 : -1}
        disabled={disabled}
        className="flex min-w-0 flex-1 items-center gap-2 rounded-md py-1 pl-2 text-left disabled:cursor-not-allowed"
        onClick={onSelect}
        onKeyDown={onKeyDown}
      >
        <span
          aria-hidden="true"
          className={`flex-none ${selected ? 'text-accent' : 'text-ink-400'}`}
        >
          <ElementTypeIcon element={element} />
        </span>
        <span aria-hidden="true" className="flex min-w-0 flex-col leading-tight">
          <span
            className={`truncate ${element.visible ? '' : 'text-ink-400 italic'} ${
              selected ? 'text-ink-100' : ''
            }`}
          >
            {name}
          </span>
          <span className="truncate text-xs text-ink-400">{[kind, ...state].join(' · ')}</span>
        </span>
      </button>
      <IconButton
        label={`${element.visible ? 'Hide' : 'Show'} ${name}`}
        tabIndex={tabStop ? 0 : -1}
        disabled={disabled || element.locked}
        className={`size-7 ${element.visible ? 'opacity-60 group-hover:opacity-100' : 'text-signal-warn'}`}
        onClick={() => {
          change({ ...element, visible: !element.visible });
        }}
      >
        {element.visible ? <EyeIcon size={14} /> : <EyeOffIcon size={14} />}
      </IconButton>
      <IconButton
        label={`${element.locked ? 'Unlock' : 'Lock'} ${name}`}
        tabIndex={tabStop ? 0 : -1}
        disabled={disabled}
        className={`size-7 ${element.locked ? 'text-signal-warn' : 'opacity-60 group-hover:opacity-100'}`}
        onClick={() => {
          change({ ...element, locked: !element.locked });
        }}
      >
        {element.locked ? <LockIcon size={14} /> : <UnlockIcon size={14} />}
      </IconButton>
    </li>
  );
}

/**
 * Every element of the Koma, frontmost first. Hidden, covered and
 * off-canvas elements can be selected here even when the canvas cannot reach them.
 */
export function LayersPanel({
  koma,
  aspectRatio,
  disabled,
}: {
  readonly koma: Koma;
  readonly aspectRatio: Parameters<typeof getCanvasSize>[0];
  /** While a preview plays, the elements cannot be selected or changed. */
  readonly disabled: boolean;
}): ReactElement {
  const selectedElementId = useUiStore((state) => state.selectedElementId);
  const selectElement = useUiStore((state) => state.selectElement);
  const [open, setOpen] = useState(true);
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(LAYER_PAGE_SIZE);
  const list = useRef<HTMLUListElement>(null);
  const listId = useId();
  const canvas = getCanvasSize(aspectRatio);

  const ordered = useMemo(() => orderLayers(koma.elements), [koma.elements]);
  const matching = useMemo(() => filterLayers(ordered, query), [ordered, query]);
  // The selected element stays in the list, even beyond the rows shown.
  const selectedIndex = matching.findIndex((element) => element.id === selectedElementId);
  const shownCount = Math.max(limit, selectedIndex + 1);
  const shown = matching.slice(0, shownCount);
  const tabStopId = selectedIndex === -1 ? shown[0]?.id : selectedElementId;
  const hiddenCount = koma.elements.filter((element) => !element.visible).length;

  // A selection on the canvas scrolls its row into view.
  useEffect(() => {
    if (selectedElementId === null) return;
    list.current
      ?.querySelector(`[data-layer-id="${CSS.escape(selectedElementId)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selectedElementId]);

  const select = (element: KomaElement): void => {
    selectElement(element.id);
    // Keeps the selected element in view on a zoomed canvas.
    document
      .querySelector(`[data-koma-stage] [data-element-id="${CSS.escape(element.id)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  };

  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const target =
      event.key === 'ArrowDown'
        ? shown[index + 1]
        : event.key === 'ArrowUp'
          ? shown[index - 1]
          : event.key === 'Home'
            ? shown[0]
            : event.key === 'End'
              ? shown.at(-1)
              : undefined;
    if (target === undefined) return;
    event.preventDefault();
    select(target);
    focusRow(list.current, target.id);
  };

  return (
    <section
      aria-label="Layers"
      className={`flex min-h-0 flex-none flex-col border-t border-line ${open ? 'max-h-[42%]' : ''}`}
    >
      <div className="flex flex-none items-center gap-1 px-3 pt-1">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={listId}
            className="-mx-1 flex h-8 w-full items-center gap-1.5 rounded-md px-1 text-left font-semibold text-ink-100 hover:bg-surface-3"
            onClick={() => {
              setOpen(!open);
            }}
          >
            <ChevronIcon size={14} direction={open ? 'down' : 'right'} />
            Layers
            <span className="font-normal text-ink-400 tabular-nums">
              {koma.elements.length}
              {hiddenCount > 0 && `, ${String(hiddenCount)} hidden`}
            </span>
          </button>
        </h2>
      </div>
      <div id={listId} hidden={!open} className="flex min-h-0 flex-1 flex-col">
        {open && (
          <>
            {koma.elements.length > LAYER_FILTER_THRESHOLD && (
              <div className="flex-none px-3 pb-1.5">
                <TextInput
                  type="search"
                  aria-label="Filter layers"
                  placeholder="Filter layers"
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setLimit(LAYER_PAGE_SIZE);
                  }}
                />
              </div>
            )}
            {koma.elements.length === 0 ? (
              <div className="px-3 pb-3">
                <p className="text-ink-400">This Koma has no elements yet.</p>
                <Button
                  variant="outline"
                  className="mt-2"
                  disabled={disabled}
                  onClick={() => {
                    void chooseKomaImage(koma.id);
                  }}
                >
                  Add an image
                </Button>
              </div>
            ) : matching.length === 0 ? (
              <div className="px-3 pb-3">
                <p className="text-ink-400">No layers match “{query.trim()}”.</p>
                <Button
                  compact
                  className="mt-1"
                  onClick={() => {
                    setQuery('');
                  }}
                >
                  Clear filter
                </Button>
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                <ul ref={list} aria-label="Layers of this Koma" className="flex flex-col gap-px">
                  {shown.map((element, index) => (
                    <LayerRow
                      key={element.id}
                      komaId={koma.id}
                      element={element}
                      canvas={canvas}
                      selected={element.id === selectedElementId}
                      tabStop={element.id === tabStopId}
                      disabled={disabled}
                      onSelect={() => {
                        select(element);
                      }}
                      onKeyDown={(event) => {
                        moveFocus(event, index);
                      }}
                    />
                  ))}
                </ul>
                {matching.length > shown.length && (
                  <Button
                    compact
                    className="mt-1"
                    onClick={() => {
                      setLimit(shownCount + LAYER_PAGE_SIZE);
                    }}
                  >
                    Show {Math.min(LAYER_PAGE_SIZE, matching.length - shown.length)} more of{' '}
                    {matching.length - shown.length}
                  </Button>
                )}
                {disabled && (
                  <p className="px-1 pt-1 text-sm text-ink-400">
                    Stop the preview to select or change elements.
                  </p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
