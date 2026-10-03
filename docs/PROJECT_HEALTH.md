# Project health and recovery

Open **Project health** in the top bar, including when the Inspector is hidden
by the chat or Brand Kit. The count includes unresolved items even when their
notifications are hidden. Closing the panel or hiding a notification changes
only the interface. Reopening the project recalculates its asset and motion
issues from the document.

The panel groups information, recoverable asset problems, and issues that
limit motion interpolation. Motion diagnostics describe the affected Koma;
the real endpoint frames remain available. Unknown fields dropped by the
loader remain informational notices about possible data loss when saving.

## Format upgrades

The current format is version 5. Versions 1–4 migrate in memory. A
successful upgrade opens the health panel with **Save current format** and
**Save a copy**. Until a save succeeds, the top bar marks the upgraded document
as unsaved. This status does not create an undo entry. Saving a copy refuses
the source filename and existing aliases of that file.

A failed upgrade or validation does not replace the current editor session,
its edits, or its Brand Kit draft, and does not write the selected file. The
recovery panel offers another native Open dialog and expandable diagnostics.
It also recommends restoring a backup. Invalid documents are never loaded as
partially repaired projects or presented as successfully upgraded files.

Generation runs until completion or cancellation by default. That behavior
appears beside the generation controls rather than in project warnings. An
enabled time limit is shown there in seconds and can be changed in Settings.

## Asset repairs

Missing references, absent embedded data, and images rejected by the file-boundary
content checks produce one issue
per affected image or Brand Kit logo. Replacing an image changes that object
in that Koma, including a child in a group. Its identity, geometry, styling,
and alternate text survive. Other users of the old asset keep their reference.
Replacing the logo changes the Brand Kit's logo reference. **Clear logo**,
**Remove image**, and removal of an unused unavailable asset require a
confirmation. Locked images and groups must be unlocked before repair.

Opening a project and importing an image check its content type, dimensions,
canonical base64 encoding (for stored assets), and format structure. PNG streams
are inflated with a 64 MiB output limit; all images are limited to 40 megapixels
and the existing 2 MiB embedded size. Opening keeps rejected bytes in the document
and leaves the source file untouched. The editor shows the same unavailable-image
placeholder and repair controls used for missing data. These availability verdicts
live only in the current session and follow the exact asset bytes through Undo.

The checks do not fully decode JPEG, GIF or WebP pixels. An image that passes
structural checks but fails browser decoding receives a canvas placeholder; that
runtime fallback alone does not add a project-health item. WebP remains supported
in the editor but unsupported by the PowerPoint exporter.

Selection uses the existing main-process image picker and validated IPC.
The document receives validated embedded bytes and a project-relative asset
path, never the original host path. External relinking and remote URL imports
are not supported. Repairs validate the resulting document before committing
one undo step. They leave stored motion intact; motion diagnostics may change
if an object is removed. Shared assets are retained.

A cancelled or failed repair retains the issue, document history, and draft.
The result appears in the panel. Successful repairs remove the issue and show
confirmation; Undo restores both the document data and its derived warning.
Saving is still required to persist the repair.

## Verification

Use the [Electron verification guide](../.agents/skills/verify-koma-motion/SKILL.md).
After installing and building, run:

```powershell
pnpm --filter @koma-motion/desktop exec playwright test projectHealth.spec.ts workflow.spec.ts motion.spec.ts brandKitDraft.spec.ts
```

The focused health spec covers version-1 copy upgrades, version-2 in-place
saves, failed migration with original-file and draft preservation, diagnostics
and retry, failed and successful targeted image replacement, logo replacement,
confirmed clearing and cancellation, Undo/Redo, save/reopen, generation timing,
and 80 warnings at a narrow window size with keyboard focus and reduced motion.
It saves screenshots and window facts in the test output. Preserve that output
outside the checkout before another run.

Native file-dialog selections are stubbed; Electron, preload, validated IPC,
and project-file writes are real. Keyboard and semantic assertions do not
constitute a screen-reader test. The fixtures use no live providers.
