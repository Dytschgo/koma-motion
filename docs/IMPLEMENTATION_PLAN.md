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
- canvas move and resize, in-place text editing, and image import or replacement,
- Claude Code and Grok providers, verified on Windows,
- Codex CLI provider, implemented but not verified,
- application tests on macOS and Windows in CI,
- session-only TXT, Markdown and PDF references for generation,
- editable PowerPoint slides with static, fade and Morph choices; a generated
  fixture was opened, edited and replayed in Windows PowerPoint.

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
| Separate state stores                             | persisted, temporary and execution state stay separate                                                                  |

## Current limitations

Interface:

- Text and shape elements cannot be added by hand. Existing elements can be
  moved, resized, rotated and edited on the canvas; images can be imported or
  replaced.
- Komas are reordered with buttons, not by dragging.
- The preview plays one transition at a time, not the whole presentation.
- The window has a minimum size of 1120 x 700 and no layout for smaller
  sizes.

Model and motion:

- Changes of content and of styles that cannot be interpolated, such as font
  size, are cross-fades.
- The children of groups are not animated individually.
- Groups cannot be created in the interface and are not offered to agents.
- Images are embedded in the project and limited to 2 MB per asset.
- Fonts are the fonts installed on the computer. A project does not contain
  fonts.

Agents:

- Generation replaces the whole presentation. An agent receives a summary of
  the existing presentation, but it cannot change single Komas.
- The Codex CLI provider has not been run against Codex.
- Claude Code and Grok generation have been tested on Windows only.
- Reference ingestion supports TXT, Markdown and PDF text only. References
  stay in the current project session, outside the saved project. Each file is
  limited to 10 MiB and 100,000 extracted characters; no more than five files,
  200,000 extracted characters can be attached, with 20 MiB input per selection.

Distribution:

- Installers and update channels exist, but installers are unsigned and not
  notarised. macOS update installation is not implemented.
- PowerPoint export preserves native editable objects but approximates motion.
  Font layout and several visual effects can differ; macOS PowerPoint has not
  been verified with a generated deck.

## Next milestones

The order reflects dependencies, not dates.

### Editing: partly complete

- Create and remove text and shapes directly in the editor; expand image
  editing beyond import and replacement.
- Play the whole presentation.
- Keyboard navigation between Komas during playback.

### Agents: remaining work

- Verify the Codex CLI provider.
- Verify Claude Code and Grok generation on macOS.
- Change single Komas through chat.
- Broaden reference ingestion only after format-specific extraction and
  privacy checks.

### Export: remaining work

- Verify Koma-generated PPTX files in PowerPoint for macOS and other readers.
- Improve text, font, picture and motion fidelity using measured results.
- Explore exact intermediate frames separately from editable Morph slides.

### Distribution: remaining work

- Signing and notarisation.
- Test installed update handoffs and macOS update installation.

### Research

- Stop Motion Mode: intermediate frames between major Komas.
- Additional operations: morph, reveal, path motion, camera, masks.
