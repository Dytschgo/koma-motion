import type { BrandKit, KomaProject } from '@koma-motion/core';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { applySavedBrandKitToProject, loadBrandKitLibrary } from '../lib/brandKitLibraryActions';
import { attachBrandMaterial } from '../lib/brandProfileActions';
import { useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { useProjectStore } from '../state/projectStore';
import { useMatchingKits } from '../lib/useMatchingKits';
import { CheckIcon, ChevronIcon } from './icons';
import { Button, IconTile, POPOVER_SURFACE, choiceRowClass } from './ui';

function Swatches({ kit }: { readonly kit: BrandKit }): ReactElement {
  return (
    <span aria-hidden="true" className="flex flex-none gap-px">
      {(['primary', 'accent', 'background'] as const).map((role) => (
        <span
          key={role}
          className="h-3.5 w-1.5 rounded-xs border border-white/10"
          style={{ background: kit.colours[role] }}
        />
      ))}
    </span>
  );
}

/** A project kit switcher, deliberately separate from library management. */
export function ChatBrandKitPicker({
  project,
  open,
  onOpenChange,
  disabled,
  maxHeight,
}: {
  readonly project: KomaProject;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly disabled: boolean;
  readonly maxHeight?: number | undefined;
}): ReactElement {
  const library = useBrandKitLibraryStore((state) => state.library);
  const busy = useBrandKitLibraryStore((state) => state.busy);
  const matches = useMatchingKits(project);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const [focusAfterApply, setFocusAfterApply] = useState<number | null>(null);
  const id = useId();
  const name = matches[0]?.name ?? project.brandKit.name;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Applying disables the trigger while the library request is in flight.
  // Return focus after that request settles and React enables the trigger.
  useEffect(() => {
    if (focusAfterApply === null || busy) return;
    setFocusAfterApply(null);
    if (disabled || useProjectStore.getState().sessionId !== focusAfterApply) return;
    const active = document.activeElement;
    if (active === document.body || (active !== null && root.current?.contains(active))) {
      trigger.current?.focus();
    }
  }, [focusAfterApply, busy, disabled]);

  useEffect(() => {
    if (!open) return;
    void loadBrandKitLibrary();
    panel.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent): void => {
      if (event.target instanceof Node && !root.current?.contains(event.target))
        onOpenChange(false);
    };
    document.addEventListener('pointerdown', dismiss);
    return () => document.removeEventListener('pointerdown', dismiss);
  }, [open, onOpenChange]);

  return (
    <div
      ref={root}
      className="chat-brand-picker relative min-w-0"
      onBlur={(event) => {
        if (
          event.relatedTarget instanceof Node &&
          !event.currentTarget.contains(event.relatedTarget)
        )
          onOpenChange(false);
      }}
    >
      <button
        ref={trigger}
        type="button"
        aria-label="Choose Brand Kit"
        aria-description={name}
        title={`Brand Kit: ${name}`}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        disabled={disabled || busy}
        className="chat-brand-trigger flex h-9 w-full min-w-0 items-center gap-1.5 rounded-control border border-line-strong bg-surface-3 px-2 text-sm hover:border-ink-400 disabled:opacity-50"
        onClick={() => onOpenChange(!open)}
      >
        <Swatches kit={project.brandKit} />
        <span className="min-w-0 flex-1 truncate text-left">{name}</span>
        <ChevronIcon direction="down" size={12} />
      </button>
      {open && (
        <div
          ref={panel}
          id={id}
          role="dialog"
          aria-label="Choose Brand Kit"
          style={{ maxHeight }}
          tabIndex={-1}
          aria-busy={busy}
          className={`chat-brand-menu absolute right-0 bottom-[calc(100%+0.5rem)] z-30 flex max-h-[min(24rem,55vh)] w-[17rem] max-w-[calc(100cqw-1.5rem)] flex-col overflow-hidden ${POPOVER_SURFACE}`}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              event.stopPropagation();
              onOpenChange(false);
              trigger.current?.focus();
            }
            if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
              const buttons = [
                ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[data-kit-choice]:not(:disabled)',
                ),
              ];
              if (buttons.length === 0) return;
              event.preventDefault();
              const current = buttons.findIndex((button) => button === document.activeElement);
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : event.key === 'ArrowDown'
                      ? (current + 1) % buttons.length
                      : current <= 0
                        ? buttons.length - 1
                        : current - 1;
              buttons[next]?.focus();
            }
          }}
        >
          <div className="flex items-center justify-between gap-2 border-b border-line px-3.5 py-3 text-sm">
            <span className="font-medium">Brand Kit</span>
            <span className="text-xs text-ink-300">
              {library.status === 'ready' ? `${String(library.kits.length)} available` : ''}
            </span>
          </div>
          {busy && (
            <p role="status" className="px-3.5 py-2 text-sm text-ink-300">
              Loading Brand Kits…
            </p>
          )}
          {library.status === 'ready' ? (
            <div className="min-h-0 overflow-y-auto p-1.5">
              {library.kits.length === 0 && (
                <p className="px-2 py-3 text-sm text-ink-300">
                  No saved Brand Kits yet. Save a kit in the Brand Kit library to choose it here.
                </p>
              )}
              {library.kits.map((kit) => {
                const selected = matches.some((match) => match.id === kit.id);
                return (
                  <button
                    key={kit.id}
                    type="button"
                    data-kit-choice
                    aria-pressed={selected}
                    disabled={busy || disabled}
                    className={`flex min-h-12 w-full items-center gap-2.5 px-2 py-2 text-left text-sm disabled:opacity-50 ${choiceRowClass(selected)}`}
                    onClick={() => {
                      const { sessionId } = useProjectStore.getState();
                      onOpenChange(false);
                      trigger.current?.focus();
                      const restoreFocus = (): void => {
                        if (mounted.current && useProjectStore.getState().sessionId === sessionId) {
                          setFocusAfterApply(sessionId);
                        }
                      };
                      void applySavedBrandKitToProject(kit.id, {
                        withInstructions: kit.instructions !== undefined,
                      }).then(restoreFocus, restoreFocus);
                    }}
                  >
                    <IconTile className="font-semibold text-accent">
                      {kit.name.slice(0, 1).toLocaleUpperCase()}
                    </IconTile>
                    <span className="min-w-0 flex-1 break-words">
                      {kit.name}
                      {kit.instructions !== undefined && (
                        <span className="block text-xs text-ink-400">with instructions</span>
                      )}
                    </span>
                    <Swatches kit={kit.brandKit} />
                    <span className="w-3.5 flex-none text-accent">
                      {selected && <CheckIcon size={14} />}
                    </span>
                  </button>
                );
              })}
              {library.unreadableCount > 0 && (
                <p role="status" className="px-2 py-2 text-xs text-signal-warn">
                  Some saved kits could not be read.
                </p>
              )}
            </div>
          ) : (
            library.status !== 'idle' && (
              <div className="px-3.5 pb-3">
                <p role="alert" className="mb-2 text-sm text-signal-warn">
                  {library.message}
                </p>
                <Button
                  compact
                  variant="outline"
                  disabled={busy}
                  onClick={() => void loadBrandKitLibrary()}
                >
                  Try again
                </Button>
              </div>
            )
          )}
          <div className="flex flex-col gap-1.5 border-t border-line px-3 py-2">
            <p className="text-xs text-ink-400">Used for your next generation</p>
            <Button
              compact
              variant="outline"
              disabled={disabled}
              title="Create a Brand Kit and project instructions from images, PDF or PowerPoint files"
              onClick={() => {
                onOpenChange(false);
                trigger.current?.focus();
                void attachBrandMaterial();
              }}
            >
              Attach brand material…
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
