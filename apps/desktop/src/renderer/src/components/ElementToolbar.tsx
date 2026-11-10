import {
  BRAND_COLOUR_ROLES,
  type Koma,
  type KomaElement,
  type KomaProject,
} from '@koma-motion/core';
import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
  type RefObject,
} from 'react';
import { getGroupingAvailability, groupSelection, ungroupSelection } from '../lib/groupActions';
import { placeToolbar, type ToolbarPlacement } from '../lib/toolbarPlacement';
import { orderLayers, type StackMove } from '../lib/layers';
import { changeElement, deleteElement, restackElement } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { BringForwardIcon, GroupIcon, LockIcon, SendBackwardIcon } from './icons';
import { MenuButton, type MenuItem } from './Menu';
import { ColourField } from './inspector/parts';
import { Field, NumberInput } from './ui';

/** The colour the toolbar swatch edits, or null for elements without one. */
function getEditableColour(
  element: KomaElement,
): { readonly label: string; readonly value: string | null } | null {
  if (element.type === 'text') return { label: 'Text colour', value: element.style.colour };
  if (element.type === 'shape') return { label: 'Fill colour', value: element.style.fill };
  return null;
}

function withColour(element: KomaElement, colour: string): KomaElement {
  if (element.type === 'text') return { ...element, style: { ...element.style, colour } };
  if (element.type === 'shape') return { ...element, style: { ...element.style, fill: colour } };
  return element;
}

function SizeIcon(): ReactElement {
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
      <path d="M2.5 6V2.5H6M10 2.5h3.5V6M13.5 10v3.5H10M6 13.5H2.5V10" />
    </svg>
  );
}

function LayersIcon(): ReactElement {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M8 2.5 14 5.5 8 8.5 2 5.5z" />
      <path d="M2 8.3 8 11.3l6-3M2 11l6 3 6-3" />
    </svg>
  );
}

function MotionIcon(): ReactElement {
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
      <path d="M2 12c2.5 0 2.5-8 5-8s2.5 8 5 8" />
      <circle cx="13.2" cy="4" r="1.2" fill="currentColor" stroke="none" />
    </svg>
  );
}

function MoreIcon(): ReactElement {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="3.5" cy="8" r="1.2" fill="currentColor" />
      <circle cx="8" cy="8" r="1.2" fill="currentColor" />
      <circle cx="12.5" cy="8" r="1.2" fill="currentColor" />
    </svg>
  );
}

/** A small panel below or above the toolbar, for colour and size. */
function ToolbarPopover({
  label,
  id,
  anchor,
  onClose,
  children,
}: {
  readonly label: string;
  readonly id: string;
  readonly anchor: RefObject<HTMLElement | null>;
  readonly onClose: (restoreFocus: boolean) => void;
  readonly children: ReactNode;
}): ReactElement {
  const surface = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState<{ x: number; y: number } | null>(null);
  useLayoutEffect(() => {
    const host = anchor.current?.getBoundingClientRect();
    const own = surface.current?.getBoundingClientRect();
    if (host === undefined || own === undefined) return;
    const x = Math.max(8, Math.min(host.left, innerWidth - own.width - 8));
    const below = host.bottom + 6;
    const y =
      below + own.height <= innerHeight - 8 ? below : Math.max(8, host.top - own.height - 6);
    setPosition({ x, y });
  }, [anchor]);
  useLayoutEffect(() => {
    if (position !== null)
      surface.current
        ?.querySelector<HTMLElement>('button:not(:disabled), input:not(:disabled)')
        ?.focus();
  }, [position]);
  useEffect(() => {
    const outside = (event: PointerEvent): void => {
      if (
        event.target instanceof Node &&
        !surface.current?.contains(event.target) &&
        !anchor.current?.contains(event.target)
      )
        onClose(false);
    };
    const resized = (): void => onClose(true);
    document.addEventListener('pointerdown', outside);
    const scrolled = (event: Event): void => {
      if (!(event.target instanceof Node) || !surface.current?.contains(event.target))
        onClose(false);
    };
    document.addEventListener('scroll', scrolled, true);
    window.addEventListener('resize', resized);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('scroll', scrolled, true);
      window.removeEventListener('resize', resized);
    };
  }, [anchor, onClose]);
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles here from the focused controls inside the popover.
    <div
      ref={surface}
      id={id}
      role="dialog"
      aria-label={label}
      className="element-popover"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget) &&
          !anchor.current?.contains(event.relatedTarget)
        )
          onClose(false);
      }}
      style={{
        insetInlineStart: position?.x ?? 0,
        insetBlockStart: position?.y ?? 0,
        visibility: position === null ? 'hidden' : undefined,
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape') {
          event.preventDefault();
          event.stopPropagation();
          onClose(true);
        }
      }}
    >
      {children}
    </div>
  );
}

function ColourChoices({
  project,
  koma,
  element,
}: {
  readonly project: KomaProject;
  readonly koma: Koma;
  readonly element: KomaElement;
}): ReactElement | null {
  const apply = useProjectStore((state) => state.apply);
  const colour = getEditableColour(element);
  if (colour === null) return null;
  const set = (value: string): void => {
    apply(changeElement(koma.id, withColour(element, value)), {
      coalesceKey: `element:${element.id}:toolbar-colour`,
    });
  };
  return (
    <div className="flex w-60 flex-col gap-3">
      <div role="group" aria-label="Brand Kit colours" className="flex flex-wrap gap-1.5">
        {BRAND_COLOUR_ROLES.map((role) => {
          const value = project.brandKit.colours[role];
          return (
            <button
              key={role}
              type="button"
              className="element-swatch"
              aria-label={`Use ${role} colour ${value}`}
              aria-pressed={colour.value === value}
              title={`${role} ${value}`}
              style={{ background: value }}
              onClick={() => set(value)}
            />
          );
        })}
      </div>
      <ColourField
        label={colour.label}
        value={colour.value ?? project.brandKit.colours.primary}
        onValue={set}
      />
      <button
        type="button"
        className="self-start text-sm text-accent underline-offset-2 hover:underline"
        onClick={() => useUiStore.getState().setView('brandKit')}
      >
        Edit Brand Kit
      </button>
    </div>
  );
}

function SizeChoices({
  koma,
  element,
}: {
  readonly koma: Koma;
  readonly element: KomaElement;
}): ReactElement {
  const apply = useProjectStore((state) => state.apply);
  const change = (next: KomaElement, field: string): void => {
    apply(changeElement(koma.id, next), { coalesceKey: `element:${element.id}:${field}` });
  };
  const fields: readonly {
    readonly label: string;
    readonly value: number;
    readonly minimum: number;
    readonly update: (value: number) => KomaElement;
    readonly key: string;
  }[] = [
    {
      label: 'Width',
      key: 'width',
      value: element.size.width,
      minimum: 1,
      update: (width) => ({ ...element, size: { ...element.size, width } }),
    },
    {
      label: 'Height',
      key: 'height',
      value: element.size.height,
      minimum: 1,
      update: (height) => ({ ...element, size: { ...element.size, height } }),
    },
    {
      label: 'X',
      key: 'x',
      value: element.position.x,
      minimum: -20000,
      update: (x) => ({ ...element, position: { ...element.position, x } }),
    },
    {
      label: 'Y',
      key: 'y',
      value: element.position.y,
      minimum: -20000,
      update: (y) => ({ ...element, position: { ...element.position, y } }),
    },
  ];
  return (
    <div className="grid w-56 grid-cols-2 gap-2">
      {fields.map((field) => (
        <Field key={field.key} label={field.label}>
          {(ids) => (
            <NumberInput
              {...ids}
              value={field.value}
              minimum={field.minimum}
              maximum={20000}
              onValue={(value) => change(field.update(value), field.key)}
            />
          )}
        </Field>
      ))}
    </div>
  );
}

/** Moves focus between the toolbar's buttons with the arrow keys. */
function moveWithin(event: KeyboardEvent<HTMLDivElement>): void {
  if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
  const buttons = [
    ...event.currentTarget.querySelectorAll<HTMLButtonElement>(':scope > button:not(:disabled)'),
  ];
  const current = buttons.findIndex((button) => button === document.activeElement);
  if (current === -1) return;
  event.preventDefault();
  const next =
    event.key === 'ArrowRight'
      ? (current + 1) % buttons.length
      : (current - 1 + buttons.length) % buttons.length;
  buttons[next]?.focus();
}

/**
 * A small toolbar beside the selected elements: colour, size, stacking,
 * motion and more. It stays inside the visible part of the canvas, flips
 * below an element at the top edge and hides while the person drags.
 */
export function ElementToolbar({
  project,
  koma,
  desk,
}: {
  readonly project: KomaProject;
  readonly koma: Koma;
  /** The scrolling area that holds the stage. */
  readonly desk: RefObject<HTMLDivElement | null>;
}): ReactElement | null {
  const selection = useUiStore((state) => state.selectedElementIds);
  const preview = useUiStore((state) => state.preview);
  const apply = useProjectStore((state) => state.apply);
  const toolbar = useRef<HTMLDivElement>(null);
  const [placement, setPlacement] = useState<ToolbarPlacement | null>(null);
  const [dragging, setDragging] = useState(false);
  const [popover, setPopover] = useState<'colour' | 'size' | null>(null);
  const colourButton = useRef<HTMLButtonElement>(null);
  const sizeButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const elements = selection
    .map((elementId) => koma.elements.find((element) => element.id === elementId))
    .filter((element): element is KomaElement => element !== undefined);
  const [element] = elements;
  const single = elements.length === 1 ? element : undefined;
  const selectionKey = selection.join(' ');

  const measure = useCallback((): void => {
    const area = desk.current;
    const own = toolbar.current;
    if (area === null || own === null || selectionKey === '') {
      setPlacement(null);
      return;
    }
    const keep = (next: ToolbarPlacement): void =>
      setPlacement((previous) =>
        previous !== null &&
        previous.x === next.x &&
        previous.y === next.y &&
        previous.side === next.side
          ? previous
          : next,
      );
    const selected = new Set(selectionKey.split(' '));
    const visible = [...area.querySelectorAll<HTMLElement>('[data-element-id]')]
      .map((node) => ({ node, rect: node.getBoundingClientRect() }))
      .filter(({ rect }) => rect.width > 0 || rect.height > 0);
    const rects = visible
      .filter(({ node }) => selected.has(node.dataset['elementId'] ?? ''))
      .map(({ rect }) => rect);
    if (rects.length === 0) {
      setPlacement(null);
      return;
    }
    const target = {
      left: Math.min(...rects.map((rect) => rect.left)),
      top: Math.min(...rects.map((rect) => rect.top)),
      right: Math.max(...rects.map((rect) => rect.right)),
      bottom: Math.max(...rects.map((rect) => rect.bottom)),
    };
    const bounds = area.getBoundingClientRect();
    const size = own.getBoundingClientRect();
    keep(
      placeToolbar(
        target,
        { left: bounds.left, top: bounds.top, right: bounds.right, bottom: bounds.bottom },
        { width: size.width, height: size.height },
        visible
          .filter(({ node }) => !selected.has(node.dataset['elementId'] ?? ''))
          .map(({ rect }) => rect),
      ),
    );
  }, [desk, selectionKey]);

  // The element can move or resize with every document change.
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const area = desk.current;
    if (area === null) return;
    const observer = new ResizeObserver(measure);
    observer.observe(area);
    // Pressing on the canvas may start a drag; the toolbar and its panels stay put.
    const start = (event: PointerEvent): void => {
      if (
        event.target instanceof Element &&
        !toolbar.current?.contains(event.target) &&
        event.target.closest('.element-popover') === null
      ) {
        setPopover(null);
        setDragging(true);
      }
    };
    const stop = (): void => {
      setDragging(false);
      requestAnimationFrame(measure);
    };
    area.addEventListener('scroll', measure, { passive: true });
    area.addEventListener('pointerdown', start, true);
    window.addEventListener('pointerup', stop, true);
    window.addEventListener('pointercancel', stop, true);
    window.addEventListener('resize', measure);
    return () => {
      observer.disconnect();
      area.removeEventListener('scroll', measure);
      area.removeEventListener('pointerdown', start, true);
      window.removeEventListener('pointerup', stop, true);
      window.removeEventListener('pointercancel', stop, true);
      window.removeEventListener('resize', measure);
    };
  }, [desk, measure]);

  useEffect(() => {
    setPopover(null);
  }, [selectionKey, preview]);

  const closePopover = useCallback(
    (restoreFocus: boolean): void => {
      const trigger = popover === 'colour' ? colourButton.current : sizeButton.current;
      setPopover(null);
      if (restoreFocus) trigger?.focus();
    },
    [popover],
  );

  if (preview !== null || element === undefined) return null;

  const grouping = getGroupingAvailability(koma, selection);
  const locked = single?.locked === true;
  const colour = single === undefined ? null : getEditableColour(single);
  const ordered = orderLayers(koma.elements);
  const place = single === undefined ? -1 : ordered.findIndex((item) => item.id === single.id);
  const restack = (move: StackMove): void => {
    if (single !== undefined) apply(restackElement(koma.id, single.id, move));
  };
  const ui = useUiStore.getState();

  const moreItems: MenuItem[] = [
    { label: 'Properties', action: () => ui.inspectSelection('element') },
    ...(single === undefined
      ? []
      : [
          {
            label: locked ? 'Unlock' : 'Lock',
            action: () => apply(changeElement(koma.id, { ...single, locked: !locked })),
          },
          {
            label: single.visible ? 'Hide' : 'Show',
            disabled: locked,
            action: () => apply(changeElement(koma.id, { ...single, visible: !single.visible })),
          },
          {
            label: 'Delete',
            separated: true,
            disabled: locked,
            action: () => {
              apply(deleteElement(koma.id, single.id));
              ui.selectElement(null);
            },
          },
        ]),
  ];

  return (
    <>
      <div
        ref={toolbar}
        role="toolbar"
        aria-label="Element actions"
        aria-orientation="horizontal"
        id={id}
        data-side={placement?.side}
        className="element-toolbar"
        style={{
          insetInlineStart: placement?.x ?? 0,
          insetBlockStart: placement?.y ?? 0,
          visibility: placement === null || dragging ? 'hidden' : undefined,
        }}
        onKeyDown={moveWithin}
      >
        {colour !== null && (
          // eslint-disable-next-line jsx-a11y/role-supports-aria-props -- aria-description is global in ARIA 1.3 and exposed by Chromium; the rule's data stops at ARIA 1.2.
          <button
            ref={colourButton}
            type="button"
            aria-label={colour.label}
            aria-description={colour.value ?? 'No fill'}
            title={colour.label}
            aria-haspopup="dialog"
            aria-expanded={popover === 'colour'}
            aria-controls={popover === 'colour' ? `${id}-colour` : undefined}
            disabled={locked}
            className="element-tool"
            onClick={() => setPopover(popover === 'colour' ? null : 'colour')}
          >
            <span
              aria-hidden="true"
              className="element-tool-swatch"
              style={{ background: colour.value ?? 'transparent' }}
            />
          </button>
        )}
        {elements.length > 1 ? (
          <button
            type="button"
            aria-label="Group selected elements"
            title={
              grouping.canGroup ? 'Group (Ctrl/Command+G)' : 'These elements cannot be grouped'
            }
            disabled={!grouping.canGroup}
            className="element-tool element-tool-text"
            onClick={() => {
              groupSelection();
            }}
          >
            <GroupIcon size={15} />
            Group
          </button>
        ) : (
          <>
            {grouping.group !== null && (
              <button
                type="button"
                aria-label="Ungroup selected group"
                title="Ungroup (Ctrl/Command+Shift+G)"
                className="element-tool element-tool-text"
                onClick={() => {
                  ungroupSelection();
                }}
              >
                <GroupIcon size={15} />
                Ungroup
              </button>
            )}
            <button
              ref={sizeButton}
              type="button"
              aria-label="Size and position"
              title="Size and position"
              aria-haspopup="dialog"
              aria-expanded={popover === 'size'}
              aria-controls={popover === 'size' ? `${id}-size` : undefined}
              disabled={locked}
              className="element-tool"
              onClick={() => setPopover(popover === 'size' ? null : 'size')}
            >
              <SizeIcon />
            </button>
            <MenuButton
              label="Arrange"
              className="element-tool"
              disabled={locked}
              items={[
                {
                  label: 'Bring to front',
                  disabled: place <= 0,
                  icon: <BringForwardIcon size={14} />,
                  action: () => restack('front'),
                },
                {
                  label: 'Bring forward',
                  disabled: place <= 0,
                  action: () => restack('forward'),
                },
                {
                  label: 'Send backward',
                  disabled: place === -1 || place >= ordered.length - 1,
                  action: () => restack('backward'),
                },
                {
                  label: 'Send to back',
                  disabled: place === -1 || place >= ordered.length - 1,
                  icon: <SendBackwardIcon size={14} />,
                  action: () => restack('back'),
                },
              ]}
            >
              <LayersIcon />
            </MenuButton>
            <button
              type="button"
              aria-label="Motion"
              title="Motion to the next Koma"
              className="element-tool"
              disabled={
                project.presentation.komas.findIndex((item) => item.id === koma.id) >=
                project.presentation.komas.length - 1
              }
              onClick={() => {
                ui.inspectSelection('motion');
                ui.setMotionEditing(true);
              }}
            >
              <MotionIcon />
            </button>
            {locked && (
              <button
                type="button"
                aria-label="Unlock element"
                title="Locked. Unlock to edit."
                className="element-tool text-signal-warn"
                onClick={() => {
                  if (single !== undefined)
                    apply(changeElement(koma.id, { ...single, locked: false }));
                }}
              >
                <LockIcon size={15} />
              </button>
            )}
          </>
        )}
        <MenuButton label="More" className="element-tool" items={moreItems} align="end">
          <MoreIcon />
        </MenuButton>
      </div>
      {popover === 'colour' && single !== undefined && (
        <ToolbarPopover id={`${id}-colour`} label="Colour" anchor={toolbar} onClose={closePopover}>
          <ColourChoices project={project} koma={koma} element={single} />
        </ToolbarPopover>
      )}
      {popover === 'size' && single !== undefined && (
        <ToolbarPopover
          id={`${id}-size`}
          label="Size and position"
          anchor={toolbar}
          onClose={closePopover}
        >
          <SizeChoices koma={koma} element={single} />
        </ToolbarPopover>
      )}
    </>
  );
}
