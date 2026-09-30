import type { KomaProject } from '@koma-motion/core';
import { useEffect, useId, type KeyboardEvent, type ReactElement } from 'react';
import { loadBrandKitLibrary } from '../lib/brandKitLibraryActions';
import { selectSavedKits, useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { useUiStore, type BrandKitTab } from '../state/uiStore';
import { BrandKitEditor } from './BrandKitEditor';
import { BrandKitLibraryView } from './BrandKitLibrary';
import { CloseIcon } from './icons';
import { IconButton } from './ui';

const TABS: readonly { readonly id: BrandKitTab; readonly label: string }[] = [
  { id: 'project', label: 'This project' },
  { id: 'library', label: 'Library' },
];

/**
 * The Brand Kit beside the canvas. It takes the place of the inspector, so
 * the canvas, the Komas and the transition controls stay where they are.
 */
export function BrandKitPanel({ project }: { readonly project: KomaProject }): ReactElement {
  const tab = useUiStore((state) => state.brandKitTab);
  const setTab = useUiStore((state) => state.setBrandKitTab);
  const setView = useUiStore((state) => state.setView);
  const kitCount = useBrandKitLibraryStore((state) => selectSavedKits(state).length);
  const idPrefix = useId();

  // The library can change outside this window, so it is read each time the panel opens.
  useEffect(() => {
    void loadBrandKitLibrary();
  }, []);

  const onTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') {
      return;
    }
    event.preventDefault();
    const next = tab === 'project' ? 'library' : 'project';
    setTab(next);
    document.getElementById(`${idPrefix}-tab-${next}`)?.focus();
  };

  return (
    <aside
      aria-label="Brand Kit"
      className="flex w-[clamp(360px,32vw,480px)] flex-none flex-col border-l border-desk-600 bg-desk-800"
    >
      <div className="flex h-12 flex-none items-center justify-between gap-2 border-b border-desk-600 pr-2 pl-4">
        <h2 className="text-lg font-semibold">Brand Kit</h2>
        <IconButton
          label="Close panel"
          onClick={() => {
            setView('canvas');
          }}
        >
          <CloseIcon />
        </IconButton>
      </div>

      <div role="tablist" aria-label="Brand Kit" className="flex flex-none gap-1 px-3 pt-2">
        {TABS.map((item) => {
          const selected = item.id === tab;
          return (
            <button
              key={item.id}
              id={`${idPrefix}-tab-${item.id}`}
              type="button"
              role="tab"
              aria-selected={selected}
              aria-controls={`${idPrefix}-panel`}
              tabIndex={selected ? 0 : -1}
              className={`h-8 rounded-t-md border-b-2 px-3 transition-colors ${
                selected
                  ? 'border-pencil-blue text-ink-100'
                  : 'border-transparent text-ink-400 hover:text-ink-100'
              }`}
              onClick={() => {
                setTab(item.id);
              }}
              onKeyDown={onTabKeyDown}
            >
              {item.label}
              {item.id === 'library' && kitCount > 0 && (
                <span className="ml-1.5 text-sm text-ink-400 tabular-nums">{kitCount}</span>
              )}
            </button>
          );
        })}
      </div>

      <div
        id={`${idPrefix}-panel`}
        role="tabpanel"
        aria-labelledby={`${idPrefix}-tab-${tab}`}
        className="min-h-0 flex-1 overflow-y-auto border-t border-desk-600"
      >
        {tab === 'project' ? (
          <BrandKitEditor project={project} />
        ) : (
          <BrandKitLibraryView project={project} />
        )}
      </div>
    </aside>
  );
}
