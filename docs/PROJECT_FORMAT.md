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
| Current version | `"schemaVersion": 1`              |
| Size limit      | 64 MB                             |

The format is an early-stage format. It can change before version 1.0 of Koma
Motion. Changes are handled through schema versions and migrations.

An example is in `examples/generated-with-claude-code.koma`.

## Structure

```jsonc
{
  "format": "koma-motion-project",
  "schemaVersion": 1,
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
  "generationHistory": [ … ]
}
```

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
  up to 2 MB per asset.
- `projectPath` is the location the asset will have in a future packaged
  project. It is always relative, uses `/` and contains no `.` or `..`
  segments. It is never a path on the computer of the user.
- A project never stores where a file came from.

### Agent configuration

```jsonc
{
  "selectedProviderId": "mock",
  "timeoutSeconds": 300,
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

1. Reject files above the size limit.
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

| Code                         | Meaning                                                 |
| ---------------------------- | ------------------------------------------------------- |
| `invalidJson`                | the file is not JSON, for example because it is damaged |
| `notAProject`                | format marker or version is missing                     |
| `newerSchemaVersion`         | written by a newer version of Koma Motion               |
| `unsupportedSchemaVersion`   | an older version without a migration                    |
| `invalidProject`             | the document does not match the schema                  |
| `tooLarge`                   | above the size limit                                    |
| `fileNotReadable`            | the file could not be read                              |
| `fileNotWritable`            | the file could not be written                           |
| `wouldOverwriteNewerProject` | saving would overwrite a project of a newer version     |

### Warnings

Warnings do not prevent a project from opening:

- an image refers to an asset that is not part of the project,
- the Brand Kit logo refers to an asset that is not part of the project,
- an asset has no data,
- a property is not known to this version,
- the project was migrated from an older version.

Missing assets are drawn as a placeholder that is labelled as a missing image.

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

There are no migrations yet because version 1 is the first version. To change
the schema:

1. Increase `CURRENT_SCHEMA_VERSION` in `packages/core/src/schema/project.ts`.
2. Add a migration from the previous version to
   `packages/project-format/src/migrations.ts`.
3. Add a test with a project file of the previous version.
4. Describe the change in this document and in `CHANGELOG.md`.

## Unknown data

- **Unknown top-level properties are kept.** They survive opening and saving,
  so a project that was touched by a newer minor revision does not lose them.
- **Unknown nested properties are removed and reported.** Opening the project
  shows a warning that names each property and states that it is not kept
  when the project is saved.

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

Saving is atomic where the file system allows it:

1. The project is validated. An invalid project is never written.
2. The text is written to a temporary file in the same folder.
3. The temporary file is flushed to disk.
4. The temporary file is renamed over the target.

If a step fails, the temporary file is removed and the previous project file
is unchanged.

`updatedAt` is set on every save. `createdAt` never changes.

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
