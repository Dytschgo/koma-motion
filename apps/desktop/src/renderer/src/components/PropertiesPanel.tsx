import type { KomaProject } from '@koma-motion/core';
import { useEffect, useLayoutEffect, useRef, type ReactElement, type RefObject } from 'react';
import { useUiStore } from '../state/uiStore';
import { CloseIcon } from './icons';
import { BrandKitPanel } from './BrandKitPanel';
import { Inspector } from './Inspector';
import { IconButton } from './ui';
import { isNestedEscape } from './Menu';

function PinIcon({ pinned }: { readonly pinned: boolean }): ReactElement {
  return (
    <svg
      width="15"
      height="15"
      viewBox="0 0 16 16"
      fill={pinned ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M6 2.5h4l-.6 4 2.6 2.2H4l2.6-2.2z" />
      <path d="M8 8.7v4.8" fill="none" strokeLinecap="round" />
    </svg>
  );
}

/**
 * All properties of the selection, the Koma and its motion, with Layers. The
 * Brand Kit opens here from the project menu or a colour popover; the header
 * carries only pinning and closing. It opens on request as a popover over the
 * canvas and can be pinned beside it. Nothing here is shown by default.
 */
export function PropertiesPanel({
  project,
  opener,
}: {
  readonly project: KomaProject;
  readonly opener: RefObject<HTMLElement | null>;
}): ReactElement {
  const open = useUiStore((state) => state.propertiesOpen);
  const pinned = useUiStore((state) => state.propertiesPinned);
  const view = useUiStore((state) => state.view);
  const setOpen = useUiStore((state) => state.setPropertiesOpen);
  const setPinned = useUiStore((state) => state.setPropertiesPinned);
  const panel = useRef<HTMLDivElement>(null);

  // Opening moves focus into the panel; closing returns it to the control that opened it.
  useLayoutEffect(() => {
    if (!open) return;
    const active = document.activeElement;
    // Pinning relocates this panel. Keep the original opener when the old
    // focused control disconnects and the browser temporarily focuses body.
    if (
      active instanceof HTMLElement &&
      active !== document.body &&
      !panel.current?.contains(active)
    )
      opener.current = active;
    if (!panel.current?.contains(document.activeElement))
      panel.current?.focus({ preventScroll: true });
  }, [open, opener]);
  useEffect(() => {
    if (open) return;
    const target = opener.current;
    opener.current = null;
    if (
      target?.isConnected === true &&
      (document.activeElement === null || document.activeElement === document.body)
    )
      target.focus();
  }, [open, opener]);

  const close = (): void => {
    setOpen(false);
  };
  const actions = (
    <>
      <IconButton
        label={pinned ? 'Unpin properties' : 'Pin properties'}
        aria-pressed={pinned}
        className="size-8"
        onClick={() => setPinned(!pinned)}
      >
        <PinIcon pinned={pinned} />
      </IconButton>
      <IconButton label="Close properties" className="size-8" onClick={close}>
        <CloseIcon size={14} />
      </IconButton>
    </>
  );

  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- Escape bubbles here from the focused controls inside the panel.
    <div
      ref={panel}
      role="region"
      aria-label="Properties"
      tabIndex={-1}
      hidden={!open}
      data-pinned={pinned ? 'true' : undefined}
      className="properties-panel"
      onKeyDown={(event) => {
        // A floating panel closes with Escape; a pinned one stays beside the canvas.
        if (
          event.key === 'Escape' &&
          !pinned &&
          !event.defaultPrevented &&
          !isNestedEscape(event.target)
        ) {
          event.preventDefault();
          close();
          opener.current?.focus();
        }
      }}
    >
      {view === 'brandKit' ? (
        <BrandKitPanel project={project} active={open} actions={actions} />
      ) : (
        <>
          <div className="properties-header">
            <h2 className="min-w-0 flex-1 text-sm font-semibold">Properties</h2>
            {actions}
          </div>
          <Inspector project={project} />
        </>
      )}
    </div>
  );
}
