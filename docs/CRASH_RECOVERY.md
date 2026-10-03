# Crash recovery

Koma Motion keeps one local recovery snapshot of committed project edits. After
an interruption, startup offers **Recover unsaved copy** or **Discard recovery**.
Closing that offer keeps the snapshot for the next launch. New and Open wait for
this decision, including requests made through keyboard shortcuts.

Recovery restores the document, embedded assets and saved Koma hold durations.
It opens without a file path and with unsaved changes. Save asks for a copy;
choosing the recorded original, including a hard-link or symlink alias, is
refused. The original file is never rewritten by capture or restoration. Normal
external file revision checks still apply to subsequent saves of the copy.
Unreadable embedded image bytes remain available for targeted Project health
repairs after recovery.

Snapshots follow committed document changes after a 600 ms debounce. The status
bar says **Recovery snapshot saved** only after an atomic write completes.
Unfinished field drafts, chat and attached reference files are not captured.
Changes made during that debounce or an incomplete write may be lost in a crash.
The snapshot is a local convenience, not a replacement for saving or backups.

A failed snapshot shows an error and a Retry action. A failed or cancelled save
keeps the previous snapshot. A successful save clears recovery only after the
renderer acknowledges the exact validated saved document; newer edits keep their
own snapshot. Explicit Do not save on normal close, confirmed project replacement,
and Discard recovery remove the applicable record. Merely closing an unresolved
startup offer preserves it. A damaged or oversized record blocks new work until
explicit discard and never changes the original project.

## Storage and authority

The main process owns `recovery/snapshot.json` in Electron's private user-data
folder and one temporary file in the same folder. Project serialization is
validated against the normal 64 MiB project limit. The complete record has a
64 MiB + 8 KiB bound; bounded reads reject larger files before parsing. At most
two captures are admitted concurrently, with stale queued revisions rejected.
Writes use exclusive temporary creation, file sync and same-directory rename.
There is no unbounded history, recursive cleanup, or renderer-chosen path.

The record contains a format version, capture time, validated project and a
source path used only to refuse overwriting the original. That path cannot grant
write authority. Each successful New, Open or Recover receives a fresh opaque
main-issued epoch, even if the project id is unchanged. Captures must match that
epoch and have a newer revision. Epochs, undo history and temporary UI state are
not restored. No project-format change is needed.

`recovery.spec.ts` exercises deliberate termination of its own Electron process,
relaunch with the same isolated profile, explicit recovery, preview, assets,
hold durations, source protection, saving/reopening a copy, normal discard,
damaged records and retry after a write failure. Service and IPC tests cover
size limits, session replacement, queued captures and clean-save validation.
Native file dialogs are stubbed; these checks exercise the resulting trusted
file operations rather than operating the OS picker itself.
