import { findMatchingSavedKit } from '@koma-motion/brand-kit';
import { BRAND_COLOUR_ROLES, type BrandKit, type KomaProject } from '@koma-motion/core';
import { useEffect, useId, useMemo, useState, type ReactElement } from 'react';
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
import { selectSavedKits, useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { useUiStore } from '../state/uiStore';
import { CheckIcon, PlusIcon, TrashIcon, WarningIcon } from './icons';
import { Button, TextInput } from './ui';

/**
 * SHA-256 of the project's logo, computed in the window with Web Crypto.
 * `undefined` while it is computed or when it cannot be, `null` without a logo.
 */
function useLogoSha256(project: KomaProject): string | null | undefined {
  const asset = project.assets.find((candidate) => candidate.id === project.brandKit.logoAssetId);
  const data = asset?.embeddedData?.data ?? null;
  const [result, setResult] = useState<{ data: string; hash: string | undefined } | null>(null);

  useEffect(() => {
    if (data === null) {
      return;
    }
    let cancelled = false;
    const finish = (hash: string | undefined): void => {
      if (!cancelled) {
        setResult({ data, hash });
      }
    };
    try {
      const bytes = Uint8Array.from(atob(data), (character) => character.charCodeAt(0));
      crypto.subtle
        .digest('SHA-256', bytes)
        .then((digest) => {
          finish(
            Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join(
              '',
            ),
          );
        })
        .catch(() => {
          finish(undefined);
        });
    } catch {
      queueMicrotask(() => {
        finish(undefined);
      });
    }
    return () => {
      cancelled = true;
    };
  }, [data]);

  if (data === null) {
    return null;
  }
  return result?.data === data ? result.hash : undefined;
}

/** The saved kits the project matches: the same settings and the same logo bytes. */
function useMatchingKits(project: KomaProject): readonly SavedBrandKitSummary[] {
  const kits = useBrandKitLibraryStore(selectSavedKits);
  const logoHash = useLogoSha256(project);
  const { brandKit } = project;
  return useMemo(
    () =>
      logoHash === undefined
        ? []
        : kits.filter((kit) => findMatchingSavedKit([kit], brandKit, logoHash) !== undefined),
    [kits, logoHash, brandKit],
  );
}

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
      className="flex flex-none overflow-hidden rounded-sm outline outline-1 outline-desk-500"
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
    <div className="flex flex-col gap-2 rounded-lg border border-desk-600 bg-desk-900 p-3">
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
        <p id={messageId} role="alert" className="text-sm text-pencil-red">
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
      <div
        className={`rounded-lg border p-2 ${
          selected ? 'border-pencil-blue bg-pencil-blue-deep' : 'border-desk-600 hover:bg-desk-700'
        }`}
      >
        <button
          type="button"
          aria-pressed={selected}
          aria-label={kit.name}
          aria-describedby={detailsId}
          className="flex w-full min-w-0 flex-col items-start gap-1.5 rounded-md text-left"
          onClick={() => {
            select(selected ? null : kit.id);
            setRenaming(false);
          }}
        >
          <span className="flex w-full min-w-0 items-center gap-2">
            <Swatches brandKit={brandKit} />
            <span className="min-w-0 flex-1 truncate font-semibold">{kit.name}</span>
            {inUse && (
              <span className="flex flex-none items-center gap-1 text-sm text-signal-ok">
                <CheckIcon size={12} /> In use
              </span>
            )}
          </span>
          <span id={detailsId} className="flex w-full flex-wrap gap-x-3 text-sm text-ink-400">
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
          </span>
        </button>

        {selected && (
          <div className="mt-2 border-t border-desk-600 pt-2">
            {renaming ? (
              <RenameForm
                kit={kit}
                onDone={() => {
                  setRenaming(false);
                }}
              />
            ) : (
              <div className="flex flex-wrap gap-1.5">
                <Button
                  variant="primary"
                  disabled={busy}
                  onClick={() => void applySavedBrandKitToProject(kit.id)}
                >
                  Apply to this project
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
          </div>
        )}
      </div>
    </li>
  );
}

/** Saved Brand Kits of this computer. Changes here are not part of the project history. */
export function BrandKitLibraryView({ project }: { readonly project: KomaProject }): ReactElement {
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
        <div className="rounded-lg border border-dashed border-desk-500 p-4">
          <p className="font-semibold">No saved Brand Kits yet</p>
          <p className="mt-1 text-sm text-ink-300">
            Save the Brand Kit of this project to reuse its colours, fonts, logo and descriptions in
            another project. The logo is copied into the library, so the kit keeps working after
            this project is closed or deleted.
          </p>
        </div>
      ) : (
        <ul aria-label="Saved Brand Kits" className="flex flex-col gap-2">
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
