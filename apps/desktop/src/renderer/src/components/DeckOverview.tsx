import type { Koma, KomaProject } from '@koma-motion/core';
import { useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react';
import { getKomaMoveOffset, searchKomas } from '../lib/deckNavigation';
import { reorderKoma } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { Button, Field, Modal, TextInput } from './ui';

function OverviewContent({
  project,
  selectedKoma,
  onClose,
}: {
  readonly project: KomaProject;
  readonly selectedKoma: Koma | null;
  readonly onClose: () => void;
}): ReactElement {
  const { komas } = project.presentation;
  const apply = useProjectStore((state) => state.apply);
  const selectKoma = useUiStore((state) => state.selectKoma);
  const preview = useUiStore((state) => state.preview);
  const [query, setQuery] = useState('');
  const [position, setPosition] = useState('');
  const list = useRef<HTMLOListElement>(null);
  const resultId = useId();
  const results = useMemo(() => searchKomas(komas, query), [komas, query]);
  const offset = selectedKoma === null ? null : getKomaMoveOffset(komas, selectedKoma.id, position);
  const invalid = position !== '' && offset === null;
  const select = (koma: Koma): void => {
    selectKoma(koma.id);
    onClose();
  };
  const focusResult = (index: number): void => {
    list.current?.querySelectorAll<HTMLButtonElement>('button')[index]?.focus();
  };
  const navigateResults = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
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
    <div className="flex flex-col gap-4">
      <Field label="Find a Koma" hint="Search by number, title or purpose.">
        {(ids) => (
          <TextInput
            {...ids}
            data-deck-search
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusResult(0);
              }
              if (event.key === 'Enter' && results[0]) {
                event.preventDefault();
                select(results[0].koma);
              }
            }}
          />
        )}
      </Field>
      <form
        className="rounded-card border border-line bg-surface-1 p-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (selectedKoma === null || offset === null || offset === 0 || preview !== null) return;
          apply(reorderKoma(selectedKoma.id, offset));
          setPosition('');
        }}
      >
        <p className="mb-2 text-sm text-ink-300">
          {selectedKoma
            ? `Selected: Koma ${String(komas.findIndex((item) => item.id === selectedKoma.id) + 1)} — ${selectedKoma.title}`
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
            disabled={selectedKoma === null || offset === null || offset === 0 || preview !== null}
          >
            Move Koma
          </Button>
        </div>
        {preview !== null && (
          <p className="mt-2 text-sm text-ink-300">Stop the preview before moving a Koma.</p>
        )}
      </form>
      <p id={resultId} role="status" className="text-sm text-ink-400">
        {results.length} of {komas.length} Komas
      </p>
      {results.length === 0 ? (
        <p className="py-4 text-ink-300">No Komas match this search.</p>
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
                aria-label={`Koma ${String(number)}: ${koma.title}`}
                aria-current={koma.id === selectedKoma?.id ? 'true' : undefined}
                className="flex w-full items-start gap-3 rounded-control px-3 py-2 text-left hover:bg-surface-3"
                onClick={() => {
                  select(koma);
                }}
                onKeyDown={(event) => {
                  navigateResults(event, index);
                }}
              >
                <span
                  aria-hidden="true"
                  className="w-9 flex-none text-right text-accent tabular-nums"
                >
                  {number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium break-words">
                    {koma.title || 'Untitled Koma'}
                  </span>
                  {koma.purpose && (
                    <span className="mt-0.5 block line-clamp-2 text-sm break-words text-ink-400">
                      {koma.purpose}
                    </span>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
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
  return (
    <Modal
      title="Deck overview"
      open={open}
      onClose={onClose}
      width="wide"
      initialFocus="[data-deck-search]"
      footer={
        <Button variant="outline" onClick={onClose}>
          Close overview
        </Button>
      }
    >
      {open && <OverviewContent project={project} selectedKoma={selectedKoma} onClose={onClose} />}
    </Modal>
  );
}
