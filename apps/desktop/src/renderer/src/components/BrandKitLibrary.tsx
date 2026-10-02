import { useMatchingKits } from '../lib/useMatchingKits';
import { BRAND_COLOUR_ROLES, type BrandKit, type KomaProject } from '@koma-motion/core';
import { useId, useState, type ReactElement } from 'react';
import type { SavedBrandKitSummary } from '../../../shared/ipc';
import {
  applySavedBrandKitToProject,
  createBlankBrandKit,
  deleteSavedBrandKit,
  duplicateSavedBrandKit,
  loadBrandKitLibrary,
  renameSavedBrandKit,
  saveProjectBrandKit,
  startNewBrandKitLibrary,
  updateSavedBrandKit,
} from '../lib/brandKitLibraryActions';
import { useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { useUiStore } from '../state/uiStore';
import { CheckIcon, PlusIcon, TrashIcon, WarningIcon } from './icons';
import { Badge, Button, IconTile, TextInput, choiceRowClass } from './ui';
import { DeckBrandKit } from './DeckBrandKit';
import { useProjectStore } from '../state/projectStore';

function Swatches({
  brandKit,
  size = 'size-4',
}: {
  readonly brandKit: BrandKit;
  readonly size?: string;
}): ReactElement {
  return (
    <span
      aria-hidden="true"
      className="flex flex-none overflow-hidden rounded-sm outline outline-1 outline-line-strong"
    >
      {BRAND_COLOUR_ROLES.map((role) => (
        <span key={role} className={size} style={{ background: brandKit.colours[role] }} />
      ))}
    </span>
  );
}

/**
 * The first row of the Brand Kit panel: whether this project's Brand Kit is
 * in the library, and the way to save it or switch to another kit.
 */
export function BrandKitSource({ project }: { readonly project: KomaProject }): ReactElement {
  const library = useBrandKitLibraryStore((state) => state.library);
  const busy = useBrandKitLibraryStore((state) => state.busy);
  const select = useBrandKitLibraryStore((state) => state.select);
  const setTab = useUiStore((state) => state.setBrandKitTab);
  const [match] = useMatchingKits(project);

  let description: string;
  if (library.status !== 'ready') {
    description = 'Save Brand Kits to your library to use them in other projects.';
  } else if (match !== undefined) {
    description = `Matches "${match.name}" in your library.`;
  } else if (library.kits.length === 0) {
    description = 'Save this Brand Kit to your library to use it in other projects.';
  } else {
    description = 'Not saved in your library. Save it, or switch to a saved kit.';
  }

  return (
    <div className="flex flex-col gap-2 rounded-card border border-line-strong bg-surface-1 p-3 shadow-raised">
      <p role="status" className="text-sm text-ink-300">
        {description}
      </p>
      <div className="flex flex-wrap gap-2">
        {match === undefined && (
          <Button
            variant="outline"
            disabled={busy || library.status !== 'ready'}
            onClick={() => void saveProjectBrandKit()}
          >
            Save to library
          </Button>
        )}
        <Button
          variant="outline"
          onClick={() => {
            if (match !== undefined) {
              select(match.id);
            }
            setTab('library');
          }}
        >
          Switch kit
        </Button>
      </div>
    </div>
  );
}

function RenameForm({
  kit,
  onDone,
}: {
  readonly kit: SavedBrandKitSummary;
  readonly onDone: () => void;
}): ReactElement {
  const [name, setName] = useState(kit.name);
  const busy = useBrandKitLibraryStore((state) => state.busy);
  const messageId = useId();
  const empty = name.trim() === '';

  const submit = async (): Promise<void> => {
    if (empty) {
      return;
    }
    if (name.trim() === kit.name || (await renameSavedBrandKit(kit.id, name))) {
      onDone();
    }
  };

  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <TextInput
        aria-label="New name"
        aria-invalid={empty ? true : undefined}
        aria-describedby={empty ? messageId : undefined}
        value={name}
        maxLength={120}
        autoFocus
        onChange={(event) => {
          setName(event.target.value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onDone();
          }
        }}
      />
      {empty && (
        <p id={messageId} role="alert" className="text-sm text-motion">
          Error: A saved Brand Kit needs a name.
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={busy || empty}>
          Save name
        </Button>
        <Button variant="outline" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function KitItem({
  kit,
  selected,
  inUse,
}: {
  readonly kit: SavedBrandKitSummary;
  readonly selected: boolean;
  readonly inUse: boolean;
}): ReactElement {
  const select = useBrandKitLibraryStore((state) => state.select);
  const busy = useBrandKitLibraryStore((state) => state.busy);
  const [renaming, setRenaming] = useState(false);
  const detailsId = useId();
  const { brandKit, logo } = kit;

  return (
    <li>
      <div className={`p-2 ${choiceRowClass(selected)}`}>
        <button
          type="button"
          aria-pressed={selected}
          aria-label={kit.name}
          aria-describedby={detailsId}
          className="flex w-full min-w-0 items-start gap-2.5 rounded-control text-left"
          onClick={() => {
            select(selected ? null : kit.id);
            setRenaming(false);
          }}
        >
          <IconTile className="font-semibold text-accent">
            {kit.name.slice(0, 1).toLocaleUpperCase()}
          </IconTile>
          <span className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="flex w-full min-w-0 items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">{kit.name}</span>
              {inUse && (
                <Badge tone="ok">
                  <CheckIcon size={12} />
                  <span className="ml-1">In use</span>
                </Badge>
              )}
              <Swatches brandKit={brandKit} size="size-3.5" />
            </span>
            <span id={detailsId} className="flex w-full flex-wrap gap-x-3 text-xs text-ink-300">
              <span className="truncate">
                {brandKit.typography.headingFont} and {brandKit.typography.bodyFont}
              </span>
              {logo === null ? (
                <span>No logo</span>
              ) : logo.available ? (
                <span>Logo: {logo.name}</span>
              ) : (
                <span className="flex items-center gap-1 text-signal-warn">
                  <WarningIcon size={12} /> Logo missing from the library
                </span>
              )}
              {inUse && <span className="sr-only">Used by this project.</span>}
              {kit.instructions !== undefined && <span>Includes project instructions</span>}
              {kit.referenceProvenance && (
                <span>
                  From {kit.referenceProvenance.files.length} reference{' '}
                  {kit.referenceProvenance.files.length === 1 ? 'file' : 'files'} ·{' '}
                  {new Date(kit.referenceProvenance.analyzedAt).toLocaleDateString()}
                </span>
              )}
              {kit.provenance && (
                <span>
                  From {kit.provenance.fileName} ·{' '}
                  {new Date(kit.provenance.analyzedAt).toLocaleDateString()} ·{' '}
                  {kit.provenance.analyzedSlides.length}/{kit.provenance.totalSlides} slides
                </span>
              )}
            </span>
          </span>
        </button>

        {selected && (
          <div className="mt-2 border-t border-line pt-2 pl-9.5">
            {renaming ? (
              <RenameForm
                kit={kit}
                onDone={() => {
                  setRenaming(false);
                }}
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {kit.instructions !== undefined && (
                  <Button
                    variant="primary"
                    disabled={busy}
                    title="Replaces the Brand Kit and the instructions of this project in one step"
                    onClick={() =>
                      void applySavedBrandKitToProject(kit.id, { withInstructions: true })
                    }
                  >
                    Apply kit and instructions
                  </Button>
                )}
                <Button
                  variant={kit.instructions === undefined ? 'primary' : 'outline'}
                  disabled={busy}
                  onClick={() => void applySavedBrandKitToProject(kit.id)}
                >
                  {kit.instructions === undefined ? 'Apply to this project' : 'Apply kit only'}
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setRenaming(true);
                  }}
                >
                  Rename
                </Button>
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => void duplicateSavedBrandKit(kit.id)}
                >
                  Duplicate
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || inUse}
                  title="Replace this saved kit with the Brand Kit of the open project"
                  onClick={() => void updateSavedBrandKit(kit.id, kit.name)}
                >
                  Update from project
                </Button>
                <Button
                  variant="outline"
                  icon={<TrashIcon size={14} />}
                  disabled={busy}
                  onClick={() => void deleteSavedBrandKit(kit.id, kit.name)}
                >
                  Delete
                </Button>
              </div>
            )}
            {kit.instructions !== undefined && !renaming && (
              <details className="mt-2 text-sm">
                <summary className="cursor-pointer text-ink-300">
                  Saved project instructions
                </summary>
                <p className="mt-1 whitespace-pre-wrap border-l-2 border-line-strong pl-3 text-ink-300">
                  {kit.instructions}
                </p>
              </details>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/** Saved Brand Kits of this computer. Changes here are not part of the project history. */
export function BrandKitLibraryView({ project }: { readonly project: KomaProject }): ReactElement {
  const [deckOpen, setDeckOpen] = useState(false);
  const projectSession = useProjectStore((state) => state.sessionId);
  const library = useBrandKitLibraryStore((state) => state.library);
  const busy = useBrandKitLibraryStore((state) => state.busy);
  const selectedKitId = useBrandKitLibraryStore((state) => state.selectedKitId);
  const matches = useMatchingKits(project);

  if (library.status === 'idle') {
    return (
      <p role="status" className="p-4 text-ink-300">
        Loading saved Brand Kits…
      </p>
    );
  }

  if (library.status === 'failed' || library.status === 'damaged') {
    return (
      <div className="flex flex-col gap-3 p-4">
        <div role="alert" className="flex items-start gap-2 text-signal-warn">
          <span className="mt-0.5 flex-none">
            <WarningIcon />
          </span>
          <p>{library.message}</p>
        </div>
        <p className="text-sm text-ink-300">
          The Brand Kit of this project is not affected and can still be edited.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={busy} onClick={() => void loadBrandKitLibrary()}>
            Try again
          </Button>
          {library.status === 'damaged' && library.canStartNew && (
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void startNewBrandKitLibrary()}
            >
              Keep a backup and start a new library
            </Button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 p-4">
      <p className="text-sm text-ink-300">
        Saved Brand Kits are stored on this computer, outside your projects, so you can use them in
        any project. Applying one changes this project and can be undone.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={busy} onClick={() => setDeckOpen(true)}>
          Create Brand Kit from deck
        </Button>
        <Button variant="primary" disabled={busy} onClick={() => void saveProjectBrandKit()}>
          Save current as new kit
        </Button>
        <Button
          variant="outline"
          icon={<PlusIcon size={14} />}
          disabled={busy}
          onClick={() => void createBlankBrandKit()}
        >
          New blank kit
        </Button>
      </div>

      {deckOpen && <DeckBrandKit key={projectSession} onClose={() => setDeckOpen(false)} />}

      {library.unreadableCount > 0 && (
        <p role="alert" className="flex items-start gap-2 text-sm text-signal-warn">
          <span className="mt-0.5 flex-none">
            <WarningIcon size={14} />
          </span>
          {library.unreadableCount === 1
            ? 'One saved Brand Kit could not be read. It is kept in the library file unchanged.'
            : `${String(library.unreadableCount)} saved Brand Kits could not be read. They are kept in the library file unchanged.`}
        </p>
      )}

      {library.kits.length === 0 ? (
        <div className="rounded-card border border-dashed border-line-strong p-4">
          <p className="font-semibold">No saved Brand Kits yet</p>
          <p className="mt-1 text-sm text-ink-300">
            Save the Brand Kit of this project to reuse its colours, fonts, logo and descriptions in
            another project. The logo is copied into the library, so the kit keeps working after
            this project is closed or deleted.
          </p>
        </div>
      ) : (
        <ul aria-label="Saved Brand Kits" className="-mx-2 flex flex-col gap-1">
          {library.kits.map((kit) => (
            <KitItem
              key={kit.id}
              kit={kit}
              selected={kit.id === selectedKitId}
              inUse={matches.includes(kit)}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
