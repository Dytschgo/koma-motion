import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useSelectedKoma } from '../lib/selectors';
import { usePresenterStore } from '../state/presenterStore';
import { selectProject, useProjectStore } from '../state/projectStore';
import { ChevronIcon } from './icons';
import { Button, POPOVER_SURFACE } from './ui';

/**
 * Starts the presentation from the beginning or from the selected Koma.
 * Separate from Preview, which plays one transition inside the editor.
 */
export function PresentButton(): ReactElement {
  const komaCount = useProjectStore(
    (state) => selectProject(state)?.presentation.komas.length ?? 0,
  );
  const selected = useSelectedKoma();
  const selectedNumber = useProjectStore((state) => {
    const komas = selectProject(state)?.presentation.komas ?? [];
    return komas.findIndex((koma) => koma.id === selected?.id) + 1;
  });
  const start = usePresenterStore((state) => state.start);
  const [open, setOpen] = useState(false);
  const menuId = useId();
  const container = useRef<HTMLDivElement>(null);
  const empty = komaCount === 0;

  useEffect(() => {
    if (!open) {
      return;
    }
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node) || !container.current?.contains(event.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
    };
  }, [open]);

  const choose = (from: 'beginning' | 'selected'): void => {
    setOpen(false);
    start(from);
  };

  return (
    <div
      ref={container}
      className="relative"
      onKeyDown={(event) => {
        if (event.key === 'Escape' && open) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          container.current?.querySelector('button')?.focus();
        }
      }}
      onBlur={(event) => {
        if (
          !(event.relatedTarget instanceof Node) ||
          !container.current?.contains(event.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
    >
      <Button
        variant="outline"
        aria-expanded={open}
        aria-controls={menuId}
        aria-keyshortcuts="F5 Shift+F5"
        disabled={empty}
        title={
          empty
            ? 'Add a Koma to present.'
            : 'Play the whole presentation (F5 from the beginning, Shift+F5 from the selected Koma)'
        }
        onClick={() => {
          setOpen((current) => !current);
        }}
      >
        Present
        <ChevronIcon size={12} direction="down" />
      </Button>
      {open && (
        <div
          id={menuId}
          role="group"
          aria-label="Start the presentation"
          className={`absolute top-full right-0 z-40 mt-1 flex w-64 flex-col p-1 ${POPOVER_SURFACE}`}
        >
          <Button
            autoFocus
            className="justify-between"
            onClick={() => {
              choose('beginning');
            }}
          >
            From the beginning
            <kbd className="text-xs text-ink-400">F5</kbd>
          </Button>
          <Button
            className="justify-between"
            onClick={() => {
              choose('selected');
            }}
          >
            From Koma {Math.max(1, selectedNumber)}
            <kbd className="text-xs text-ink-400">Shift+F5</kbd>
          </Button>
        </div>
      )}
    </div>
  );
}
