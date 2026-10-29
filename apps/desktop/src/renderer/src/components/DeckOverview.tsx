import type { Koma, KomaProject } from '@koma-motion/core';
import { createAssetResolver } from '@koma-motion/renderer';
import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement,
} from 'react';
import { getKomaMoveOffset, searchKomas } from '../lib/deckNavigation';
import { reorderKoma } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { formatSeconds } from '../lib/selectors';
import { KomaThumbnail } from './KomaThumbnail';
import { Button, Field, ModalFrame, TextInput } from './ui';

function OverviewContent({
  project,
  selectedKoma,
  onClose,
  titleId,
}: {
  readonly project: KomaProject;
  readonly selectedKoma: Koma | null;
  readonly onClose: () => void;
  readonly titleId: string;
}): ReactElement {
  const { komas } = project.presentation;
  const apply = useProjectStore((state) => state.apply);
  const selectKoma = useUiStore((state) => state.selectKoma);
  const preview = useUiStore((state) => state.preview);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('');
  const [focusedId, setFocusedId] = useState(selectedKoma?.id);
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const scrollRoot = useRef<HTMLDivElement>(null);
  const resolveAsset = useMemo(() => createAssetResolver(project.assets), [project.assets]);
  const resultId = useId();
  const results = useMemo(() => searchKomas(komas, query), [komas, query]);
  const offset = selectedKoma === null ? null : getKomaMoveOffset(komas, selectedKoma.id, position);
  const invalid = position !== '' && offset === null;
  const tabStop = results.find(({ koma }) => koma.id === focusedId) ?? results[0];
  useEffect(() => {
    // The native dialog opens in its parent's effect; scroll after it has a layout.
    const frame = requestAnimationFrame(() => {
      list.current?.querySelector('[aria-current="true"]')?.scrollIntoView({ block: 'nearest' });
    });
    return () => cancelAnimationFrame(frame);
  }, [selectedKoma?.id, komas]);
  const select = (koma: Koma): void => {
    selectKoma(koma.id);
    onClose();
  };
  const focusResult = (index: number): void => {
    list.current?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus();
  };
  const navigateResults = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === 'ArrowUp' && index === 0) {
      event.preventDefault();
      search.current?.focus();
      return;
    }
    const target =
      event.key === 'ArrowDown'
        ? Math.min(index + 1, results.length - 1)
        : event.key === 'ArrowUp'
          ? Math.max(index - 1, 0)
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? results.length - 1
              : null;
    if (target === null) return;
    event.preventDefault();
    focusResult(target);
  };

  return (
    <div className="deck-overview">
      <header className="deck-overview-header">
        <h2 id={titleId} className="text-xl font-semibold tracking-tight">
          Deck overview
        </h2>
        <p id={resultId} role="status" className="text-sm text-ink-400">
          {results.length} of {komas.length} Komas
        </p>
        <Button onClick={onClose}>Close overview</Button>
      </header>
      <div className="deck-overview-search">
        <Field label="Find a Koma" hint="Number, title or purpose · ↑ ↓ to browse · Enter to open">
          {(ids) => (
            <TextInput
              {...ids}
              ref={search}
              data-deck-search
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
              }}
              onKeyDown={(event) => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  const current = results.findIndex(({ koma }) => koma.id === selectedKoma?.id);
                  focusResult(query.trim() === '' && current >= 0 ? current : 0);
                }
                if (event.key === 'Enter' && query.trim() !== '' && results[0]) {
                  event.preventDefault();
                  select(results[0].koma);
                }
              }}
            />
          )}
        </Field>
      </div>
      <div ref={scrollRoot} className="deck-overview-results">
        {results.length === 0 ? (
          <p className="px-3 py-6 text-ink-300">No Komas match this search.</p>
        ) : (
          <ol
            ref={list}
            aria-label="Deck overview"
            aria-describedby={resultId}
            className="flex flex-col gap-1"
          >
            {results.map(({ koma, number }, index) => (
              <li key={koma.id}>
                <button
                  type="button"
                  aria-label={`Koma ${String(number)}: ${koma.title || 'Untitled Koma'}`}
                  aria-current={koma.id === selectedKoma?.id ? 'true' : undefined}
                  tabIndex={koma.id === tabStop?.koma.id ? 0 : -1}
                  className="deck-overview-row"
                  onFocus={() => {
                    setFocusedId(koma.id);
                  }}
                  onClick={() => {
                    select(koma);
                  }}
                  onKeyDown={(event) => {
                    navigateResults(event, index);
                  }}
                >
                  <span aria-hidden="true" className="deck-overview-number">
                    {number}
                  </span>
                  <KomaThumbnail
                    koma={koma}
                    aspectRatio={project.presentation.aspectRatio}
                    resolveAsset={resolveAsset}
                    width={88}
                    scrollRoot={scrollRoot}
                  />
                  <span className="min-w-0 flex-1">
                    <span
                      className="block line-clamp-2 font-medium wrap-anywhere"
                      title={koma.title || 'Untitled Koma'}
                    >
                      {koma.title || 'Untitled Koma'}
                    </span>
                    {koma.purpose && (
                      <span className="mt-0.5 block line-clamp-2 text-sm wrap-anywhere text-ink-400">
                        {koma.purpose}
                      </span>
                    )}
                    <span className="deck-overview-meta">
                      {koma.id === selectedKoma?.id && (
                        <span className="text-accent">Selected</span>
                      )}
                      {koma.holdDurationMs !== null && (
                        <span>Hold {formatSeconds(koma.holdDurationMs)}</span>
                      )}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
      <div className="deck-overview-footer">
        <form
          className="min-w-0"
          onSubmit={(event) => {
            event.preventDefault();
            if (selectedKoma === null || offset === null || offset === 0 || preview !== null)
              return;
            apply(reorderKoma(selectedKoma.id, offset));
            setPosition('');
          }}
        >
          <p
            className="mb-2 truncate text-sm text-ink-300"
            title={selectedKoma?.title || 'Untitled Koma'}
          >
            {selectedKoma
              ? `Selected: Koma ${String(komas.findIndex((item) => item.id === selectedKoma.id) + 1)} — ${selectedKoma.title || 'Untitled Koma'}`
              : 'Select a Koma to move it.'}
          </p>
          <div className="flex items-end gap-2">
            <Field
              label="Move to position"
              className="min-w-0 flex-1"
              error={
                invalid ? `Enter a whole position from 1 to ${String(komas.length)}.` : undefined
              }
            >
              {(ids) => (
                <TextInput
                  {...ids}
                  className="w-full"
                  inputMode="numeric"
                  value={position}
                  placeholder={`1–${String(komas.length)}`}
                  disabled={selectedKoma === null || preview !== null}
                  onChange={(event) => {
                    setPosition(event.target.value);
                  }}
                />
              )}
            </Field>
            <Button
              type="submit"
              variant="outline"
              disabled={
                selectedKoma === null || offset === null || offset === 0 || preview !== null
              }
            >
              Move Koma
            </Button>
          </div>
          {preview !== null && (
            <p className="mt-2 text-sm text-ink-300">Stop the preview before moving a Koma.</p>
          )}
        </form>
      </div>
    </div>
  );
}

export function DeckOverview({
  project,
  selectedKoma,
  open,
  onClose,
}: {
  readonly project: KomaProject;
  readonly selectedKoma: Koma | null;
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactElement {
  const titleId = useId();
  return (
    <ModalFrame
      labelledBy={titleId}
      open={open}
      onClose={onClose}
      initialFocus="[data-deck-search]"
      className="deck-overview-dialog w-[720px]"
    >
      {open && (
        <OverviewContent
          project={project}
          selectedKoma={selectedKoma}
          onClose={onClose}
          titleId={titleId}
        />
      )}
    </ModalFrame>
  );
}
