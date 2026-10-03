import type { KomaProject } from '@koma-motion/core';
import { useEffect, useId, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { detectProviders, listProviderModels } from '../lib/agentActions';
import { withSelectedProviderModel } from '../lib/composerChoices';
import { useAgentStore } from '../state/agentStore';
import { changeAgentConfiguration } from '../state/commands';
import { useModelFavoritesStore } from '../state/modelFavoritesStore';
import { useProjectStore } from '../state/projectStore';
import { CheckIcon, ChevronIcon, RefreshIcon, SettingsIcon } from './icons';
import { ProviderLogo } from './ProviderLogo';
import { Button, SEGMENT_TRACK, SearchIcon, segmentClass } from './ui';
import { getModelEntries } from '../lib/modelEntries';
import { ModelReasoningControl } from './ModelReasoningControl';
import { ModelDiscoveryStatus } from './ModelDiscoveryStatus';
import { ImageModelPicker } from './ImageModelPicker';

export function CompactModelPicker({
  project,
  disabled,
  onClose,
  children,
}: {
  readonly project: KomaProject;
  readonly disabled: boolean;
  readonly onClose: () => void;
  /** Existing provider diagnostics, custom IDs and account model loading. */
  readonly children: ReactNode;
}): ReactElement {
  const providers = useAgentStore((state) => state.providers);
  const detection = useAgentStore((state) => state.detection);
  const listings = useAgentStore((state) => state.modelListings);
  const remembered = useAgentStore((state) => state.rememberedModels);
  const remember = useAgentStore((state) => state.rememberModel);
  const favorites = useModelFavoritesStore((state) => state.favorites);
  const toggleFavorite = useModelFavoritesStore((state) => state.toggle);
  const apply = useProjectStore((state) => state.apply);
  const [query, setQuery] = useState('');
  const [optionsOpen, setOptionsOpen] = useState(false);
  const [tab, setTab] = useState<'text' | 'images'>('text');
  const panelId = useId();
  const search = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const options = useRef<HTMLDivElement>(null);
  const terms = query.toLocaleLowerCase().trim();
  const entries = getModelEntries(providers, project, listings, remembered, favorites);
  const filtered = entries.filter((entry) =>
    `${entry.title} ${entry.option.value} ${entry.provider.metadata.displayName}`
      .toLocaleLowerCase()
      .includes(terms),
  );
  const groups = [
    { name: 'Favorites', entries: filtered.filter((entry) => entry.favorite) },
    { name: 'Models', entries: filtered.filter((entry) => !entry.favorite) },
  ];
  const availableProviders = providers.filter(
    (provider) =>
      provider.metadata.id !== 'mock' && provider.detection.availability === 'available',
  ).length;

  // Each opening replaces the prior snapshot. Failed refreshes never retain old capabilities.
  const checked = useRef(new Set<string>());
  useEffect(() => {
    for (const provider of providers) {
      const id = provider.metadata.id;
      if (provider.metadata.modelCatalog.source !== 'cli' || checked.current.has(id)) continue;
      checked.current.add(id);
      void listProviderModels(id);
    }
  }, [providers]);

  useEffect(() => {
    if (!optionsOpen) search.current?.focus();
    else options.current?.querySelector<HTMLElement>('select, input, button')?.focus();
  }, [optionsOpen]);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        role="tablist"
        aria-label="Model type"
        className={`${SEGMENT_TRACK} mx-3 mt-3 flex-none rounded-xl border border-line p-1`}
      >
        {(['text', 'images'] as const).map((value) => (
          <button
            type="button"
            key={value}
            role="tab"
            id={`${panelId}-${value}`}
            aria-controls={panelId}
            aria-selected={tab === value}
            tabIndex={tab === value ? 0 : -1}
            className={segmentClass(tab === value)}
            onClick={() => {
              setTab(value);
              setOptionsOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                event.preventDefault();
                setTab(value === 'text' ? 'images' : 'text');
                setOptionsOpen(false);
                const tabs =
                  event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>(
                    '[role="tab"]',
                  );
                tabs?.[value === 'text' ? 1 : 0]?.focus();
              }
            }}
          >
            {value === 'text'
              ? 'Text'
              : `Images${project.agentConfiguration.imageGeneration && project.agentConfiguration.imageGeneration !== 'off' ? ' · On' : ''}`}
          </button>
        ))}
      </div>
      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={`${panelId}-${tab}`}
        className="flex min-h-0 flex-1 flex-col"
      >
        {tab === 'images' ? (
          <ImageModelPicker project={project} disabled={disabled} />
        ) : optionsOpen ? (
          <>
            <div className="flex flex-none items-center border-b border-line px-2 py-1.5">
              <Button
                compact
                onClick={() => setOptionsOpen(false)}
                icon={<ChevronIcon direction="left" size={14} />}
              >
                Back to models
              </Button>
              <span className="ml-auto pr-2 text-xs text-ink-400">Model options</span>
            </div>
            <div ref={options} className="flex min-h-0 flex-col gap-2 overflow-y-auto p-3">
              {children}
            </div>
          </>
        ) : (
          <>
            <div className="mx-3 mt-3 mb-1 flex flex-none items-center gap-2 rounded-xl border border-line bg-surface-1 px-3 py-2">
              <SearchIcon />
              <input
                ref={search}
                type="search"
                aria-label="Search models"
                placeholder="Search models…"
                value={query}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent py-1 text-sm text-ink-100 placeholder:text-ink-400 focus-visible:outline-none"
                onChange={(event) => setQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowDown' || event.key === 'Enter') {
                    event.preventDefault();
                    const first = list.current?.querySelector<HTMLButtonElement>(
                      '[data-model-choice]:not(:disabled)',
                    );
                    if (event.key === 'Enter') first?.click();
                    else first?.focus();
                  }
                }}
              />
              <kbd className="flex-none rounded border border-line px-1 text-[10px] text-ink-400">
                Esc
              </kbd>
            </div>
            <div
              ref={list}
              role="group"
              aria-label="Models"
              className="min-h-0 overflow-y-auto px-2 pb-2"
              onKeyDown={(event) => {
                if (
                  !(event.target instanceof HTMLElement) ||
                  !event.target.matches('[data-model-choice]')
                )
                  return;
                if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
                const rows = [
                  ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
                    '[data-model-choice]:not(:disabled)',
                  ),
                ];
                if (!rows.length) return;
                event.preventDefault();
                const current = rows.findIndex((row) => row === document.activeElement);
                const next =
                  event.key === 'Home'
                    ? 0
                    : event.key === 'End'
                      ? rows.length - 1
                      : event.key === 'ArrowDown'
                        ? (current + 1) % rows.length
                        : current <= 0
                          ? rows.length - 1
                          : current - 1;
                rows[next]?.focus();
              }}
            >
              {groups
                .filter((group) => group.entries.length > 0)
                .map((group) => (
                  <section key={group.name} aria-label={group.name}>
                    <h3 className="eyebrow flex items-center gap-3 px-2 pt-4 pb-2">
                      {group.name}
                      <span className="h-px flex-1 bg-line" />
                    </h3>
                    {group.entries.map((entry) => {
                      const id = entry.provider.metadata.id;
                      const name = entry.provider.metadata.displayName;
                      return (
                        <div
                          key={`${id}:${entry.option.value}`}
                          className={`group mb-2 rounded-xl border ${entry.selected ? 'border-accent bg-accent-deep ring-1 ring-accent/70' : 'border-line/40 bg-surface-2 hover:border-line hover:bg-surface-3'}`}
                        >
                          <div className="flex items-center">
                            <button
                              type="button"
                              data-model-choice
                              data-provider-id={id}
                              data-model-value={entry.option.value}
                              aria-label={`${entry.title} · ${name}`}
                              title={entry.option.value || 'Use the provider default'}
                              aria-pressed={entry.selected}
                              disabled={disabled}
                              className="flex min-h-14 min-w-0 flex-1 items-center gap-2.5 rounded-control px-2.5 py-2.5 text-left disabled:opacity-50"
                              onClick={() => {
                                const previous = project.agentConfiguration.providers[id]?.model;
                                if (entry.option.value === '' && previous)
                                  remember(`${project.id}:${id}`, previous);
                                apply(
                                  changeAgentConfiguration(
                                    withSelectedProviderModel(
                                      project.agentConfiguration,
                                      id,
                                      entry.option.value,
                                    ),
                                  ),
                                );
                                if (!entry.hasReasoning) onClose();
                              }}
                            >
                              <span className="flex size-10 flex-none items-center justify-center rounded-xl border border-line bg-surface-1">
                                <ProviderLogo providerId={id} size={26} />
                              </span>
                              <span className="min-w-0 flex-1">
                                <strong className="block break-words text-[14px] font-semibold text-ink-100">
                                  {entry.title}
                                </strong>
                                <span className="mt-1 flex items-center gap-1.5 text-xs text-ink-300">
                                  <span
                                    aria-hidden="true"
                                    className={`size-1.5 flex-none rounded-full ${entry.available ? 'bg-signal-ok' : 'bg-signal-warn'}`}
                                  />
                                  {name} ·{' '}
                                  {id === 'mock'
                                    ? 'Local demo'
                                    : entry.available
                                      ? 'Available'
                                      : entry.provider.detection.availability === 'unavailable'
                                        ? 'Not installed'
                                        : 'Unavailable'}
                                </span>
                              </span>
                            </button>
                            <button
                              type="button"
                              aria-label={`${entry.favorite ? 'Unpin' : 'Pin'} ${entry.title} · ${name}`}
                              aria-pressed={entry.favorite}
                              disabled={disabled}
                              title={entry.favorite ? 'Remove from favorites' : 'Add to favorites'}
                              className={`mr-2 flex size-8 flex-none items-center justify-center rounded-control hover:bg-surface-1 hover:text-accent disabled:opacity-40 ${entry.favorite ? 'text-accent' : 'text-ink-300'}`}
                              onClick={() => {
                                toggleFavorite({ providerId: id, model: entry.option.value });
                                search.current?.focus();
                              }}
                            >
                              <svg
                                aria-hidden="true"
                                width="16"
                                height="16"
                                viewBox="0 0 24 24"
                                stroke="currentColor"
                                fill={entry.favorite ? 'currentColor' : 'none'}
                                strokeWidth="1.5"
                              >
                                <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z" />
                              </svg>
                            </button>
                            {entry.selected && (
                              <span
                                aria-hidden="true"
                                className="mr-3 flex size-5 flex-none items-center justify-center rounded-full bg-accent text-surface-0"
                              >
                                <CheckIcon size={13} />
                              </span>
                            )}
                          </div>
                          {entry.selected && (
                            <>
                              <ModelReasoningControl
                                project={project}
                                providerId={id}
                                disabled={disabled}
                              />
                              {entry.notice && (
                                <p role="status" className="mx-3 mb-3 text-xs text-ink-300">
                                  {entry.notice}
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })}
                  </section>
                ))}
              <div className="flex flex-col gap-2 px-2 py-3" aria-label="Model discovery">
                {providers.map((provider) => (
                  <ModelDiscoveryStatus
                    key={provider.metadata.id}
                    provider={provider}
                    disabled={disabled}
                  />
                ))}
              </div>
              {detection === 'running' && (
                <p role="status" className="px-2 py-3 text-sm text-ink-300">
                  Checking providers…
                </p>
              )}
              {detection === 'failed' && (
                <div className="p-2">
                  <p role="alert" className="mb-2 text-sm text-signal-warn">
                    Providers could not be checked.
                  </p>
                  <Button compact variant="outline" onClick={() => void detectProviders()}>
                    Try again
                  </Button>
                </div>
              )}
              {filtered.length === 0 && detection !== 'running' && detection !== 'failed' && (
                <p role="status" className="px-2 py-4 text-sm text-ink-300">
                  {terms === '' ? 'No providers available yet.' : 'No matching models.'}
                </p>
              )}
            </div>
            <div className="flex flex-none items-center justify-between gap-2 border-t border-line px-3 py-2">
              <span role="status" className="min-w-0 flex-1 text-xs text-ink-400">
                {Object.values(listings).includes('loading')
                  ? 'Discovering CLI capabilities…'
                  : `${entries.length} choices · ${availableProviders} available providers`}
              </span>
              <button
                type="button"
                aria-label="Refresh model capabilities"
                title="Refresh all text model and reasoning choices"
                disabled={disabled || Object.values(listings).includes('loading')}
                className="flex size-7 flex-none items-center justify-center rounded-control text-ink-300 hover:bg-surface-3 disabled:opacity-40"
                onClick={() => {
                  for (const provider of providers)
                    if (provider.metadata.modelCatalog.source === 'cli')
                      void listProviderModels(provider.metadata.id);
                }}
              >
                <RefreshIcon size={14} />
              </button>
              <button
                type="button"
                aria-label="Model options"
                title="Custom model IDs and provider details"
                className="flex size-7 flex-none items-center justify-center rounded-control text-ink-300 hover:bg-surface-3"
                onClick={() => setOptionsOpen(true)}
              >
                <SettingsIcon size={14} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
