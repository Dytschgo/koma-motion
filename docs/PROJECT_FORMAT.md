# Project format

A Koma Motion project is stored in one file with the extension `.koma`.

The code lives in `packages/core` (schemas) and `packages/project-format`
(serialisation, parsing, migration and file access).

## Overview

| Property        | Value                             |
| --------------- | --------------------------------- |
| Extension       | `.koma`                           |
| Encoding        | UTF-8, line feeds, final newline  |
| Syntax          | JSON, indented with two spaces    |
| Format marker   | `"format": "koma-motion-project"` |
| Current version | `"schemaVersion": 3`              |
| Size limit      | 64 MiB (67,108,864 UTF-8 bytes)   |

The format is an early-stage format. It can change before version 1.0 of Koma
Motion. Changes are handled through schema versions and migrations.

An example is in `examples/generated-with-claude-code.koma`.

## Structure

```jsonc
{
  "format": "koma-motion-project",
  "schemaVersion": 3,
  "id": "project_3f0c…",
  "name": "Introducing Koma Motion",
  "createdAt": "2026-09-29T13:43:35.965Z",
  "updatedAt": "2026-09-29T13:44:02.118Z",
  "brandKit": { … },
  "presentation": {
    "id": "presentation_…",
    "title": "…",
    "objective": "…",
    "audience": "…",
    "narrative": "…",
    "aspectRatio": "16:9",
    "komas": [ … ],
    "transitions": [ … ]
  },
  "assets": [ … ],
  "agentConfiguration": { … },
  "systemInstructions": "",
  "generationHistory": [ … ]
}
```

### Project instructions

`systemInstructions` is plain text saved with the project, limited to 8,000
UTF-16 code units (JavaScript string length). An empty or missing value means
no additional instructions. Text is preserved verbatim; overlong or non-string
values are rejected rather than shortened. Version 1 files migrate to version
2 with empty instructions, so legacy projects gain no active guidance.

Settings and the agent panel expose the instructions editor and reusable
templates. Project edits and applying template text use document commands and
can be undone. Invalid drafts remain visible when Settings closes and reopens;
saves and requests use the last valid project text. A failed project save keeps
the document and its unsaved state.

Reusable templates are separate app data in
`instruction-templates.json` under Electron's `userData` directory. The main
process validates reads and writes and replaces the file atomically. The library
supports up to 100 templates, with names of 1–100 characters and the same
8,000-character instruction limit. Corrupt data is reported and kept intact.
Template CRUD does not enter document history. Applying copies only the text
into the project; templates are never embedded as a library in project files.
Template data has no credentials, provider configuration or path fields.

The generation request carries project instructions separately from the chat
request and Brand Kit. Generation and repair prompt version 4 render them as a
JSON string in a dedicated Project instructions section before the current
Request section. Application rules stay in the system prompt. Claude receives
the system prompt as one argument and the remaining prompt on standard input;
Codex receives both on standard input. Grok receives the prompt in an
app-created temporary text file, with the system prompt as a separate argument.
The mock receives the same structured
request and prompt but continues to produce its fixed demo. Project text cannot
change executable names, CLI arguments, sandbox settings or output validation.

### Brand Kit

```jsonc
{
  "name": "Koma Motion",
  "colours": {
    "primary": "#FF7A59",
    "secondary": "#33507A",
    "accent": "#FFD166",
    "background": "#182033",
    "text": "#F5F3EE",
  },
  "typography": { "headingFont": "Georgia", "bodyFont": "Segoe UI" },
  "logoAssetId": null,
  "tone": "",
  "visualStyle": "",
  "iconStyle": "",
  "preferredImagery": "",
  "preferredTopics": [],
  "referenceNotes": "",
}
```

Colours are stored in one format: `#RRGGBB` in uppercase. The editor accepts
`#rgb`, `rgb` and lowercase input and converts it before it is stored.

### Koma

```jsonc
{
  "id": "koma_…",
  "title": "The motion engine",
  "purpose": "…",
  "speakerNotes": "…",
  "background": { "type": "solid", "colour": "#182033" },
  "elements": [ … ]
}
```

### Element

Every element has these properties. `type`, `content` and `style` depend on
one another; see `MOTION_MODEL.md` for the element types and the coordinate
system.

```jsonc
{
  "id": "element_…",
  "persistentId": "motion-engine",
  "name": "Motion engine",
  "position": { "x": 760, "y": 380 },
  "size": { "width": 400, "height": 400 },
  "rotation": 0,
  "opacity": 1,
  "zIndex": 6,
  "locked": false,
  "visible": true,
  "type": "shape",
  "content": { "shape": "circle", "cornerRadius": 0 },
  "style": { "fill": "#FF7A59", "stroke": null, "strokeWidth": 0 },
}
```

### Transition

```jsonc
{
  "id": "transition_…",
  "fromKomaId": "koma_…",
  "toKomaId": "koma_…",
  "strategy": "staged",
  "duration": 1600,
  "easing": "easeInOut",
  "elementTransitions": [
    {
      "persistentId": "motion-engine",
      "operation": "move",
      "from": { "elementId": "element_…", "position": { "x": 1228, "y": 540 } },
      "to": { "elementId": "element_…", "position": { "x": 760, "y": 380 } },
    },
  ],
  "rationale": "…",
}
```

### Asset

```jsonc
{
  "id": "asset_…",
  "type": "image",
  "name": "logo.png",
  "mediaType": "image/png",
  "projectPath": "assets/asset_….png",
  "metadata": { "byteLength": 18234 },
  "embeddedData": { "encoding": "base64", "data": "iVBORw0KGgo…" },
}
```

- Supported media types: `image/png`, `image/jpeg`, `image/webp`, `image/gif`.
- In schema version 1 the bytes of an asset are stored in the project file,
  up to 2 MB per asset. The assets together, with the rest of the project,
  must still fit in the 64 MiB limit.
- `projectPath` is the location the asset will have in a future packaged
  project. It is always relative, uses `/` and contains no `.` or `..`
  segments. It is never a path on the computer of the user.
- A project never stores where a file came from.

### Agent configuration

```jsonc
{
  "selectedProviderId": "mock",
  "timeoutSeconds": null,
  "providers": { "claude-code": { "model": "claude-opus-5-5" } },
}
```

No credentials are stored. Agent CLIs use their own sign-in.

### Generation history

A concise record of generation requests. It contains the request, the
provider, the outcome and warnings. It never contains model reasoning, and it
keeps at most 200 entries.

```jsonc
{
  "id": "generation_…",
  "createdAt": "2026-09-29T13:43:35.965Z",
  "providerId": "mock",
  "userRequest": "Create a three-frame presentation …",
  "status": "succeeded",
  "summary": "Created 3 Komas: …",
  "warnings": [],
}
```

## Validation

Project files are untrusted input. TypeScript types are not relied on: every
file is validated at runtime before it is opened, and every project is
validated again before it is written.

Opening a file runs these steps:

1. Reject files above the byte limit, before the text is parsed.
2. Parse the JSON.
3. Check the format marker and read the schema version.
4. Migrate older versions to the current version.
5. Validate the complete document against the schema.
6. Collect warnings.

Validation includes rules across properties: identifiers are unique, persistent
ids are unique within a Koma, and transitions refer to Komas that exist.

### Errors

Errors name the location and the problem:

```text
The project contains invalid data:
presentation.komas[1].elements[0].size.width: Too small: expected number to be >0
brandKit.colours.primary: Colour must be a six-digit hex value such as #FF5A36
```

| Code                         | Meaning                                                  |
| ---------------------------- | -------------------------------------------------------- |
| `invalidJson`                | the file is not JSON, for example because it is damaged  |
| `notAProject`                | format marker or version is missing                      |
| `newerSchemaVersion`         | written by a newer version of Koma Motion                |
| `unsupportedSchemaVersion`   | an older version without a migration                     |
| `invalidProject`             | the document does not match the schema                   |
| `tooLarge`                   | above the shared 64 MiB byte limit                       |
| `fileNotReadable`            | the file could not be read                               |
| `fileNotWritable`            | the file could not be written                            |
| `uninspectableTarget`        | an existing file could not be inspected, so it was kept  |
| `fileChangedExternally`      | file bytes changed or the file was removed since opening |
| `wouldOverwriteNewerProject` | saving would overwrite a project of a newer version      |

### Warnings

Warnings do not prevent a project from opening:

- an image refers to an asset that is not part of the project,
- the Brand Kit logo refers to an asset that is not part of the project,
- an asset has no data,
- a property is not known to this version,
- the project was migrated from an older version.

Missing assets are drawn as a placeholder that is labelled as a missing image.
The [Project health panel](PROJECT_HEALTH.md) groups these problems separately
from upgrade information and offers targeted image and logo repairs.

A transition that cannot play is not a load warning. The file opens with the
stored motion unchanged. The application checks every transition against its
Komas while the project is edited and explains a transition that cannot play
on that transition in the Koma strip, where it can be regenerated. See
[Motion model](MOTION_MODEL.md#transitions-that-cannot-play).

## Schema versions and migration

`schemaVersion` is a whole number that increases with every change that an
older version of Koma Motion cannot read.

- **Same version:** the project opens.
- **Older version:** the project is migrated in memory, one version at a time.
  The file on disk changes only when the user saves.
- **Newer version:** the project does not open. The message asks the user to
  update Koma Motion.

Koma Motion never overwrites a project of a newer version. Before it writes
to an existing file, it reads the schema version of that file and refuses to
save if it is newer than its own. "Save as" with another name remains
possible.

The current format is version 3, with migrations registered for versions 1
and 2. To change the schema:

1. Increase `CURRENT_SCHEMA_VERSION` in `packages/core/src/schema/project.ts`.
2. Add a migration from the previous version to
   `packages/project-format/src/migrations.ts`.
3. Add a test with a project file of the previous version.
4. Describe the change in this document and in `CHANGELOG.md`.

## Unknown data

- **Unknown top-level properties are kept** when they are JSON and fit in the
  limits below, so a project that was touched by a newer minor revision does
  not lose them.
- **Unknown nested properties are removed and reported.** Opening the project
  shows a warning that names each property and states that it is not kept
  when the project is saved.

Extension data is the unknown top-level properties. It may contain only JSON
values: strings, finite numbers, booleans, null, arrays and objects. It may
be nested at most 32 levels. One property may contain at most 10,000 JSON
values, counting the property itself, and one object may have at most 1,000
properties. Property names are at most 256 characters. Anything else is
rejected. The extension data also counts toward the 64 MiB limit of the whole
project.

## Deterministic serialisation

The same project always produces the same text:

- known properties appear in the order of the schema, `format` and
  `schemaVersion` first,
- keys of maps, such as provider settings and asset metadata, are sorted,
- unknown top-level properties follow, sorted by name,
- arrays keep their order, because the order of Komas and elements has meaning.

This keeps differences between two versions of a project small and readable
in version control.

## Saving

Saving replaces the destination as a whole. That replacement is separate from
surviving a crash or a power loss. The same 64 MiB UTF-8 limit is used when
the window asks the main process to save, when the project is serialised, and
when a file is read. A project that is saved can be opened again.

The application reads or writes one project file at a time.

### Replacement

1. If the destination does not exist, it can be created. If it exists, its
   format version is read. A file that exists but cannot be inspected is left
   unchanged: it is larger than the limit, it is not a regular file, or the
   operating system refuses the read. Koma Motion does not treat that file as
   missing. It may be a project written by a newer version.
2. The project is validated, including the byte limit. An invalid project is
   never written. When the contents are already over the limit, the project
   is rejected before its text is built.
3. The text is written to a temporary file in the same folder.
4. The temporary file's contents are flushed.
5. The temporary file is renamed over the destination.

On the file systems used by Windows and macOS, that rename replaces the
directory entry. A reader sees either the previous file or the completed new
file, never a mixture of the two.

If a step fails before the rename completes, the temporary file is removed
and the previous file is unchanged. A lock that stops the rename has the same
result: the previous file stays, and the temporary file is removed.

`updatedAt` is set on every save. `createdAt` never changes.

### Changes made outside the window

The main process remembers a SHA-256 fingerprint of the bytes it opened or
last saved. A normal save refuses to overwrite the file if its bytes changed
or the file was removed. The local edits remain open; use Save as with another
name to keep them, or reopen the file to load the external changes.

Queued saves of the same file advance that fingerprint after each successful
write. The target is checked again after the temporary file is flushed,
immediately before replacement. This detects stale saves, but is not a
filesystem lock: a different process could write between the final check and
the rename. The fingerprint is session state, not part of the project format,
and is never supplied by the renderer.

### Power loss

Flushing the temporary file asks the operating system to write that file's
bytes. It does not flush the directory that records the new name, and Koma
Motion does not sync the parent directory. A power loss after the rename has
returned to the program, but before the operating system has stored the
directory, can leave the folder without the new file. The previous file is
still there when the rename itself had not been stored. This is not a
guarantee against crashes or power loss. It is a guarantee that a failed save
does not destroy the previous project.

## Future: packaged projects

Storing images inside the JSON file is simple, but it does not scale to
projects with many or large assets. The planned replacement is a package that
contains the project document and the assets as separate files. This is not
implemented. The format is prepared for it:

- elements refer to assets by id, never by location,
- every asset already has a `projectPath` for its place in a package,
- the renderer receives assets through a resolver and does not know where
  their data comes from.

Open questions are tracked in the issue "Design the asset packaging format".

### Version 3: larger presentations and optional deadlines

Version 3 removes the 200-Koma/transition cap, accepts longer generation-history
requests, raises per-Koma elements to 2,000 and per-element text to 100,000 code
units, and permits `agentConfiguration.timeoutSeconds: null` for no deadline.
The canonical whole-file size remains 64 MiB of UTF-8, including assets, history,
and extension data. See [the limit audit](GENERATION_LIMITS.md).

Version 1 first migrates to version 2 with empty active project instructions;
version 2 migrates to version 3 with the old automatic timeout disabled. Its
provider/model settings, existing instructions, presentation, assets, history,
and supported extension data are preserved. Opening reports the deadline change.
Saving writes version 3. Older app versions refuse the newer format rather than
silently losing larger content or restoring a deadline. An explicitly enabled
version-3 timeout is preserved on save/reopen.
