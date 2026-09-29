# Implementation plan

This document records what the first milestone set out to prove, what was
built, and what comes next.

## Goal of the first milestone

Prove the core idea before building the complete product: **a presentation is
a sequence of visual states, and motion is derived from the identity of the
objects in them.**

The milestone is a vertical slice. It goes through every layer once, from the
chat input to a saved file, and it works without an AI service.

## State of the first milestone

| #   | Capability                                          | State | Verified by                                  |
| --- | --------------------------------------------------- | ----- | -------------------------------------------- |
| 1   | Launch on macOS or Windows                          | done  | application tests on Windows and macOS (CI)  |
| 2   | Create a local project                              | done  | application test                             |
| 3   | Open an existing `.koma` project                    | done  | application test                             |
| 4   | Save and save as                                    | done  | application test (save), unit tests (format) |
| 5   | Create and edit a Brand Kit                         | done  | application test, unit tests                 |
| 6   | Enter a request in a chat interface                 | done  | application test                             |
| 7   | Select an available provider                        | done  | application test                             |
| 8   | Generate content with a deterministic mock provider | done  | application test, unit tests                 |
| 9   | Display at least three generated Komas              | done  | application test                             |
| 10  | Select and inspect Komas                            | done  | application test                             |
| 11  | Select and inspect elements                         | done  | application test                             |
| 12  | Preview an animated transition                      | done  | application test measures the moving object  |
| 13  | Preserve object identity between Komas              | done  | unit tests of the motion engine              |
| 14  | Save the generated presentation                     | done  | application test                             |
| 15  | Reopen without losing content                       | done  | application test compares the saved files    |

Beyond the milestone:

- undo and redo for all document changes,
- Claude Code provider, verified on Windows,
- Codex CLI provider, implemented but not verified,
- application tests on macOS and Windows in CI.

## Order of work

1. Inspect the environment and the agent CLIs.
2. Repository foundation and tooling.
3. Core document model and Brand Kit.
4. Project format and persistence.
5. Motion engine.
6. Agent runtime: contract, validation, runner, mock provider.
7. CLI providers.
8. Exporter interface.
9. Renderer.
10. Electron shell and IPC.
11. Project state and interface.
12. Application tests.
13. Documentation.

Packages were built from the inside out, so that every layer could be tested
before the next one depended on it.

## Technical decisions made on the way

| Decision                                          | Reason                                                                                                                  |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| TypeScript 6.0 instead of 7.0                     | the type-aware linter supports TypeScript below 6.1                                                                     |
| Vite 8 without an Electron build framework        | the stable release of the framework that was considered supports Vite up to version 7; the React plugin requires Vite 8 |
| No development server                             | development runs with the security settings of production                                                               |
| Own protocol for the window                       | a real origin and a strict Content Security Policy                                                                      |
| Schema library for all external data              | TypeScript types do not protect against files, IPC payloads or agent output                                             |
| Own interpolation instead of an animation library | the motion model stays independent, and frames are deterministic and testable                                           |
| HTML and SVG instead of a canvas framework        | text layout comes from the browser, and elements are accessible                                                         |
| One state library with three stores               | persisted, temporary and execution state stay separate                                                                  |

## Known limitations of the first milestone

Interface:

- Elements cannot be dragged or resized on the canvas. Position and size are
  edited in the inspector.
- Elements cannot be added by hand. They come from generation or from
  copying a Koma.
- Komas are reordered with buttons, not by dragging.
- The preview plays one transition at a time, not the whole presentation.
- The window has a minimum size of 1120 x 700 and no layout for smaller
  sizes.

Model and motion:

- Changes of content and of styles that cannot be interpolated, such as font
  size, are cross-fades.
- The children of groups are not animated individually.
- Groups cannot be created in the interface and are not offered to agents.
- Images can only be added as the logo of the Brand Kit.
- Fonts are the fonts installed on the computer. A project does not contain
  fonts.

Agents:

- Generation replaces the whole presentation. An agent receives a summary of
  the existing presentation, but it cannot change single Komas.
- The Codex CLI provider has not been run against Codex.
- Claude Code has been tested on Windows only.
- Reference files cannot be given to an agent.

Distribution:

- No installers, no signing, no updates, no application icon.
- PowerPoint export does not exist.

## Next milestones

The order reflects dependencies, not dates.

### Milestone 2: editing

- Drag, resize and rotate elements on the canvas.
- Add and remove text, shapes and images by hand.
- Play the whole presentation.
- Keyboard navigation between Komas during playback.

### Milestone 3: agents

- Verify the Codex CLI provider.
- Verify both CLI providers on macOS.
- Change single Komas through chat.
- Reference file ingestion.

### Milestone 4: export

- Research according to `POWERPOINT_EXPORT_RESEARCH.md`.
- A prototype exporter for static, editable slides.
- A decision on how motion is exported.

### Milestone 5: distribution

- Packaged project format with assets.
- Installers for macOS and Windows.
- Signing and notarisation.

### Research

- Stop Motion Mode: intermediate frames between major Komas.
- Additional operations: morph, reveal, path motion, camera, masks.
