# Asset packages: design

Status: design for [issue #15](https://github.com/Dytschgo/koma-motion/issues/15).
Nothing in this document is implemented. Today a project is one JSON file
with every image embedded as base64; see [Project format](PROJECT_FORMAT.md).

A packaged project holds the project document and its assets as separate
files in one container. This document recommends the container and how it is
saved, opened, limited, migrated and cleaned up, and gives an incremental plan.

## Summary of recommendations

| Question                  | Recommendation                                                                                                                                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container                 | **One ZIP archive**, still named `.koma` and recognised by its first bytes. The archive contains `mimetype`, `project.json` and `assets/<assetId>.<ext>`. No folder format for saving.                                                            |
| Atomic saving             | Keep today's model: write a temporary file in the same folder, flush it, verify it, then rename it over the target. Copy unchanged assets from the current package as raw compressed bytes. Retry a rename that a sharing lock blocks on Windows. |
| Paths leaving the package | **Never extract to disk.** Read entries by exact name. Accept only `mimetype`, `project.json` and names that equal an asset's canonical `assets/<id>.<ext>`. Reject anything else that is unsafe, duplicated, linked or encrypted.                |
| Limits                    | 32 MiB per asset (40 megapixels, as today), 2,000 assets, 2 GiB of asset bytes, `project.json` at most 64 MiB, no ZIP64. Bounded expansion ratio and entry count.                                                                                 |
| Migration                 | JSON projects keep opening and saving as JSON. A JSON project is saved as a package, after a notice, only when it exceeds the embedded limits or the user chooses it. New projects become packages one release after the reader ships.            |
| Unused assets             | Never delete during editing, so undo always works. On save, write only the assets that something refers to. Project health lists unused assets before they are dropped.                                                                           |

## Prepared in the current code

- Elements refer to assets by id (`content.assetId`). The Brand Kit refers to its
  logo by `logoAssetId`. Nothing refers to an asset by path.
- Every asset has `projectPath`, created as `assets/<id>.<ext>` by `createImageAsset`
  ([`imageAsset.ts`](../apps/desktop/src/main/services/imageAsset.ts), line 70)
  and by Brand Kit application
  ([`apply.ts`](../packages/brand-kit/src/apply.ts), line 66). The schema rejects
  absolute paths, backslashes and `.` or `..` segments
  ([`asset.ts`](../packages/core/src/schema/asset.ts), `projectPathSchema`).
- The renderer reads images only through `createAssetResolver`
  ([`assets.ts`](../packages/renderer/src/assets.ts)), which returns `data:` URLs
  of allowed types. The Content Security Policy allows `img-src 'self' data:`
  ([`securityPolicy.ts`](../apps/desktop/src/main/securityPolicy.ts), line 36).
- Saving is validated and atomic with conflict detection: `writeFileAtomic` and
  `checkTarget` in [`files.ts`](../packages/project-format/src/node/files.ts),
  described in [Saving](PROJECT_FORMAT.md#saving).
- The desktop app already reads ZIP archives defensively. `deckPptx.ts`
  ([`deckPptx.ts`](../apps/desktop/src/main/services/deckPptx.ts), lines 82–170) uses
  `yauzl` with `validateEntrySizes`. It rejects unsafe names, duplicates, more
  than 5,000 entries, encryption and excessive expansion, and it checks
  declared sizes and CRC-32 while it streams. The package reader should share
  these checks.

Current limits that the package replaces or keeps:

| Limit                          | Today                                      | Where                                               |
| ------------------------------ | ------------------------------------------ | --------------------------------------------------- |
| bytes per image                | 2 MiB (`MAX_EMBEDDED_ASSET_BYTES`)         | `packages/core/src/schema/asset.ts`                 |
| pixels per image               | 40,000,000 (`MAX_IMAGE_PIXELS`)            | `apps/desktop/src/main/services/imageValidation.ts` |
| assets per project             | 500 (`MAX_PROJECT_ASSETS`)                 | `packages/core/src/schema/project.ts`               |
| whole project, assets included | 64 MiB of UTF-8 (`MAX_PROJECT_FILE_BYTES`) | `packages/core/src/schema/limits.ts`                |
| crash recovery record          | 64 MiB + 8 KiB                             | [CRASH_RECOVERY.md](CRASH_RECOVERY.md)              |

Two current behaviours matter for the design:

- **Deleting an image leaves its asset in the project.** `removeElement`
  ([`operations.ts`](../packages/core/src/operations.ts), line 73) only removes the
  element. Only replacing an image (`importImage` in
  [`commands.ts`](../apps/desktop/src/renderer/src/state/commands.ts)) and replacing
  or clearing the logo (`setBrandLogo`, `clearBrandLogo`) drop an asset that
  is no longer used. Unused assets therefore accumulate today.
- **The renderer sends the whole project, base64 assets included, to the main
  process** on every save and crash-recovery capture. Undo keeps up to 100
  snapshots. Snapshots share unchanged asset objects, but every IPC message
  carries them.

## 1. Container: folder, archive or both

### Recommendation: one ZIP archive

```text
presentation.koma            (ZIP)
  mimetype                   "application/vnd.koma-motion.project+zip", stored, first entry
  project.json               the document; assets without embedded bytes; deflated
  assets/asset_3f0c….png     one entry per asset, stored without compression
  assets/asset_9a1d….jpg
```

- **One file.** People email, upload and drag projects. Windows has no document
  bundles, so a folder project there is a folder of loose files that can be
  half-copied or half-synced by OneDrive or Dropbox. A macOS bundle would look
  like a file in Finder but not in the browser or on Windows.
- **Atomic replacement works for files, not for folders.** Rename can replace a
  file in one step on both systems (see section 2). Replacing a non-empty
  folder in one step is not possible on Windows. On macOS it needs
  `renamex_np(RENAME_SWAP)`, which Node.js does not expose.
- **The `mimetype` entry comes first, uncompressed**, as in ODF and EPUB. The
  file can then be recognised from a fixed offset without reading the central
  directory.
- **Assets are stored, not deflated.** PNG, JPEG, GIF and WebP are already
  compressed. Stored entries are cheap to copy unchanged (section 2), and every
  asset entry can be required to have a compression ratio of 1.
- **`project.json` is the same document as a JSON `.koma` today**, with the same
  deterministic serialisation, so differences stay readable once extracted. Its
  assets carry `projectPath` and no `embeddedData` (section 5).

**No folder format for saving.** A second container would double the test
surface for saving, conflict detection and recovery. An "Export unpacked
folder" command for inspection can come later. It would write new files only
and never open a folder as a project.

### Extension and detection

Keep the `.koma` extension and detect the container from the first bytes: `PK\x03\x04`
followed by the `mimetype` entry means a package, `{` or whitespace means JSON. There
is one document type for users and one file association
([issue #8](https://github.com/Dytschgo/koma-motion/issues/8) lists registration as open).

The cost is that today's applications see a package as damaged JSON
(`invalidJson`). They cannot report "made by a newer version", and an older
version doing **Save as** onto a package path replaces it after the native
overwrite confirmation. `inspectExistingTarget` treats unparseable content as
`version: null` rather than as newer. Packages above 64 MiB are already safe,
because they count as uninspectable and are kept. Mitigation: ship the reader first
(see the plan), and make the reader treat any ZIP it cannot read as
`uninspectableTarget`, so it is never overwritten. A distinct extension such as
`.komapkg` would avoid the cross-version problem at the cost of two document
types. This is an open question for the maintainer.

## 2. Atomic saving on Windows and macOS

The package uses the existing replacement protocol
([`writeFileAtomic`](../packages/project-format/src/node/files.ts), lines 215–241)
with these steps:

1. **Check the target** as `checkTarget` does now: absent, a readable package or
   JSON project of this version or older, and an unchanged fingerprint. Anything
   newer or uninspectable is kept.
2. **Validate** the document. Every asset the document refers to must have bytes
   available, and all limits must hold. An invalid project is never written.
3. **Write the temporary file** `.<name>.<random>.tmp` in the target's folder,
   opened with `wx`. Write `mimetype`, `project.json` and the asset entries in
   that order:
   - an asset whose bytes come from the **current package** is copied from it
     as raw stored data with its known CRC-32 and size, with no decoding;
   - an asset imported in this session comes from the session asset store
     (section 4).
4. **Flush** the temporary file (`FileHandle.sync()`). On macOS, libuv's `fsync`
   uses `F_FULLFSYNC` to reach the disk rather than its cache (according to
   the libuv sources; **not verified here**).
5. **Verify before replacing.** Reopen the temporary file. Read its central
   directory with the same reader as opening. Check that every referenced asset
   is present with the expected size and CRC, and parse `project.json`. A
   corrupt write is caught here, while the previous file is still intact.
6. **Close every handle on the current package.** Windows cannot rename over a
   file that is open without `FILE_SHARE_DELETE`. The application must not keep
   the package open between reads.
7. **Check the target again, then rename** the temporary file over it (the
   `beforeReplace` hook). On Windows, `fs.rename` maps to `MoveFileEx` with
   replace-existing. A virus scanner, the search indexer or a sync client
   holding the target briefly causes `EPERM`/`EBUSY`/`EACCES`. Retry with
   backoff for at most about 2 s, check the target again before each attempt,
   then fail. The previous file stays and the temporary file is removed. On
   macOS, `rename(2)` is atomic within one volume.
8. **Fingerprint.** The SHA-256 of the written bytes becomes the new
   `fileRevision`. It is hashed while streaming, so a 2 GiB package is not
   buffered.

The guarantees and limits stay the same as in
[Power loss](PROJECT_FORMAT.md#power-loss): a failed save never destroys the
previous project, and the parent directory is not synced. Syncing the
directory is possible on macOS by opening it and calling `fsync`. Node.js offers
no equivalent on Windows, so it is not part of the guarantee.

Cost: every save rewrites the whole archive. Copying stored entries is a
sequential copy at disk speed. A 500 MB package saves in seconds, not
milliseconds. The writer must therefore run off the main thread's event loop
in streaming form, and show progress for long saves. Saving only the changed
entries in place is rejected, because an interrupted in-place update corrupts
the only copy.

ZIP writing: `yazl`, the writing companion of the `yauzl` reader already used
by the desktop app, streams entries and supports stored entries with
precomputed CRCs. JSZip, used by the exporter, holds the whole archive in
memory, so it is unsuitable here. A new dependency needs the usual
coordination: lockfile, the pnpm release-age rule, and the package allowlist
in `scripts/architecture-boundaries.mjs`, where `project-format` may currently
import only `core` and `motion-engine`.

## 3. Paths that leave the package

The safest archive reader never turns an entry name into a filesystem path.
The design relies on that:

- **No extraction.** The reader opens the archive (yauzl, `lazyEntries`,
  `validateEntrySizes`, `strictFileNames: true`) and streams named entries
  into memory or into the session asset store. The store names files by the
  SHA-256 of their content (section 4), never by the entry name. Zip-slip has
  no target, because no path is ever derived from the archive.
- **Allow-list of names.** An archive is accepted only if it contains exactly:
  `mimetype` (first, stored, the expected content), `project.json`, and for
  each asset in `project.json` one entry named exactly its `projectPath`.
  `projectPath` must equal `assets/<id>.<ext for mediaType>`, which is stricter
  than the current `projectPathSchema`. Any other entry is an error. This
  rejects without further rules: absolute names, `..`, backslashes (yauzl
  rejects these too), drive letters, `:` for NTFS streams, control characters,
  Windows device names such as `CON` and trailing dots.
- **No duplicates.** This includes duplicates after Unicode NFC normalisation and
  case folding, and duplicates between the central directory and a local
  header whose names differ. Names must be ASCII, as the id pattern already
  requires, so the UTF-8 flag and Info-ZIP Unicode path fields cannot change a
  name.
- **No links or special entries.** Reject entries whose Unix mode in the external
  attributes is a symbolic link or other non-regular file, directory entries,
  encrypted entries (general-purpose bit 0), compression methods other than
  stored (assets) and deflate (`project.json`), multi-disk archives, ZIP64,
  and archives with data before the first entry or comments over 1 KiB.
- **Content check.** Each asset's bytes pass `validateImageBytes`
  ([`imageValidation.ts`](../apps/desktop/src/main/services/imageValidation.ts))
  for its declared media type, and their size and SHA-256 must match the
  `byteLength` and `sha256` stored in `project.json`. Assets that fail are opened as missing
  images, which Project health can repair, as damaged embedded data is today.
  They do not stop the project from opening.
- **The renderer never sees an entry name.** It asks for an asset id. The main
  process maps id → content hash → stored bytes.

If an unpacked folder ever becomes readable, it must use canonical paths, as
the `koma://app` protocol already does: resolve `realpath`, require the
result inside the folder, and refuse symbolic links and junctions
([ARCHITECTURE.md security decisions](../ARCHITECTURE.md#security-decisions)).

## 4. Loading assets without base64

Packages are useful only if asset bytes stop travelling inside the project:

- **Session asset store.** The main process keeps assets for the open project in
  a private folder under app data, named by SHA-256. A store entry is written
  once and never changed. Opening a package fills it, and importing an image
  adds to it. It outlives undo, so undoing a deletion always finds the bytes. It
  is removed when the project closes, and crash recovery takes it over (below).
- **Renderer access by id.** The resolver keeps its signature (`assetId →
ResolvedAsset`). Instead of a `data:` URL it returns a URL of a privileged
  scheme such as `koma-asset://project/<assetId>`. The main process serves this
  scheme from the store after checking the id against the current document.
  The Content Security Policy adds only that scheme to `img-src`. The renderer
  still never loads a path or the network. Alternatively the main process
  returns bytes over IPC and the renderer creates `blob:` URLs. That needs no
  new scheme, but it holds every image in renderer memory.
- **The document stays small.** Without `embeddedData` the document sent over
  IPC, kept in undo snapshots and written to crash recovery holds only
  references. Crash recovery records the store's content hashes and keeps the
  store until the record is cleared. This changes
  [CRASH_RECOVERY.md](CRASH_RECOVERY.md) and needs its own tests.
- **Exporter.** The PowerPoint exporter's image resolver reads from the store
  instead of decoding base64. Its per-export verification cache stays the same.

## 5. Format changes

A new schema version (6, or the next free one; the stop-motion proposal also
plans version 6, so the two must be coordinated) changes assets as follows:

```jsonc
{
  "id": "asset_3f0c…",
  "type": "image",
  "name": "logo.png",
  "mediaType": "image/png",
  "projectPath": "assets/asset_3f0c….png",
  "metadata": { "byteLength": 18234 },
  "sha256": "9f86d0…", // required in packages; optional in JSON projects
  "embeddedData": null, // in packages always null; in JSON projects as today
}
```

- `sha256` (64 lowercase hex characters) identifies the content. It allows
  integrity checks and deduplication. It is computed in the main process when
  saving, because migrations are pure and synchronous and `core` has no hashing
  dependency.
- In a package, `embeddedData` is always `null` and the entry provides the bytes.
  In JSON projects `embeddedData: null` still means "missing". The container,
  not a new field, decides where bytes live, so one document shape serves both.
- The format marker in `project.json` stays `koma-motion-project`. The container
  is recognised from the `mimetype` entry.

## 6. Limits

| Limit                | Recommendation                                                    | Reason                                                                                                                        |
| -------------------- | ----------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| bytes per asset      | 32 MiB                                                            | Above typical photography exports. Matches the deck import bound (`MAX_DECK_BYTES`). Decoding stays bound by the pixel limit. |
| pixels per image     | 40,000,000 (unchanged)                                            | Existing decode budget in `imageValidation.ts`.                                                                               |
| assets per project   | 2,000                                                             | Raised from 500. Bounds the central directory, health checks and resolver maps.                                               |
| asset bytes in total | 2 GiB                                                             | Stays below the 4 GiB ZIP32 limits without ZIP64. Bounds save time and disk use of the session store.                         |
| `project.json`       | 64 MiB (unchanged)                                                | The current document budget, now without asset bytes.                                                                         |
| entries              | assets + 2, at most 2,002                                         | The allow-list makes anything else an error.                                                                                  |
| expansion            | stored entries ratio 1; `project.json` at most 100 : 1 and 64 MiB | As the deck reader does. Declared and actual sizes must match.                                                                |
| JSON projects        | unchanged: 2 MiB per image, 64 MiB total                          | Old projects and older applications keep working.                                                                             |

All numbers are constants with tests and documented in
[GENERATION_LIMITS.md](GENERATION_LIMITS.md) style. Before the totals are
raised, renderer memory needs a check with many large images: the canvas
decodes full images, and thumbnails use the same component.

## 7. Migration from embedded assets

- **Opening** a JSON project works exactly as now, and migrations stay in memory.
- **Saving** writes the container the project was opened from. A JSON project
  stays JSON while it fits the JSON limits. Nobody's file changes format
  without being asked.
- **Converting** to a package happens when:
  - the user chooses "Save as package…" (Save as with a choice of container), or
  - an edit adds an image above 2 MiB or would push the project over 64 MiB.
    The import explains that saving will create a package, which Koma Motion
    versions before the reader release cannot open, and asks for confirmation.
- **Conversion** decodes each `embeddedData` once, verifies it, stores it by
  hash, sets `sha256` and `embeddedData: null`, and writes the package. The
  original JSON file is replaced only by an explicit save. "Save a copy"
  keeps the original.
- **Back to JSON** ("Save a copy as single file") is offered only when every
  asset fits the JSON limits. It is an interchange path, not the default.
- **New projects** stay JSON until the release after the package reader has
  shipped, then become packages.

## 8. Removing assets that are no longer used

- **Usage** is computed by one pure function in `core`,
  `collectAssetUsage(project)`. It covers image elements, including group
  children (`flattenElements`), and the Brand Kit logo. The function
  replaces the ad-hoc checks in `importImage`, `isAssetUsedByImage` and the Brand Kit apply
  code. Unknown top-level extension data cannot be inspected, so it does not
  keep assets alive. This is documented.
- **During editing nothing is deleted.** Commands keep the asset list as
  it is, so undo of a deletion restores the image without searching for bytes.
  The session store keeps every byte seen in the session.
- **On save, unused assets are not written.** The writer filters the document
  with `collectAssetUsage`. The filtered document becomes the saved baseline,
  so the unsaved-changes indicator compares against what is on disk. Undoing
  past the save restores elements whose assets are still in the session
  store. The next save writes them again.
- **Visibility.** [Project health](PROJECT_HEALTH.md) shows "_N_ unused images
  (_size_) will not be saved", with a list. Opening a file never removes
  anything on its own.
- **The session store** is pruned when the project closes, and crash recovery
  pruning follows the recovery record's lifetime.

The same filter can apply to JSON projects first. It fixes today's
accumulation from deleted images before packages exist.

## Incremental implementation plan

Each step is a separate PR with tests. Steps 1–3 change no file format.

1. **Asset usage and health.** Add `collectAssetUsage` in `core` and use it in
   the existing commands. Show unused assets in Project health. Drop unused
   assets on save for JSON projects.
2. **Session asset store and id-based loading.** Content-addressed store in
   the main process. Serve the renderer by id (privileged scheme or IPC bytes).
   The exporter reads from the store. JSON projects still save `embeddedData`,
   so the format is unchanged, but IPC and undo snapshots lose the base64.
3. **Hashes.** Compute `sha256` in the main process, as optional metadata, for
   integrity and deduplication of identical images.
4. **Package reader (reader-first release).** Container detection, the
   allow-list reader with limits, `sha256` and image validation. Fixtures cover
   zip-slip names, duplicates, symbolic links, encryption, size mismatches,
   expansion bombs and ZIP64. Schema version bump. Opening packages works;
   saving still refuses packages. Newer and unreadable packages are never
   overwritten.
5. **Package writer.** Streaming writer, raw copy of unchanged entries,
   verification before replacement, Windows rename retry. Conflict detection with
   streaming fingerprints. Tests cover a failed write, a locked target and a
   changed target, on both operating systems.
6. **Migration and limits.** Conversion prompts, "Save as package…", "Save a copy
   as single file", raised limits, renderer memory checks with large images.
7. **Crash recovery for packages.** The recovery record refers to store hashes.
   Restoring, clean-save acknowledgement and pruning are tested end to end.
8. **Default to packages** for new projects, one release after step 4.

## Open questions

- Keep `.koma` for both containers (one document type, cross-version overwrite
  risk) or introduce `.komapkg`?
- Privileged `koma-asset:` scheme or `blob:` URLs over IPC for renderer access?
- Are 32 MiB per asset, 2,000 assets and 2 GiB the right limits once renderer
  memory has been measured?
- Should Save as offer the container choice explicitly, or only convert when
  limits require it?
- Coordinate the schema version number with the stop-motion proposal
  ([issue #13](https://github.com/Dytschgo/koma-motion/issues/13)).
