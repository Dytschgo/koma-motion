# Architecture

Koma Motion is a desktop application for macOS and Windows, built with
Electron, TypeScript and React. This document explains how the code is
organised and why.

## Repository layout

```text
apps/
  desktop/              the Electron application
    src/main/           main process: windows, files, agent processes
    src/preload/        the bridge between the window and the main process
    src/shared/         the IPC contract, used by both sides
    src/renderer/       the user interface
    scripts/            build, development and start scripts
    e2e/                tests that run the built application
packages/
  core/                 the document model
  brand-kit/            Brand Kit defaults, editing and agent context
  project-format/       reading and writing .koma files
  motion-engine/        motion between Komas
  agent-runtime/        agent providers and the generation contract
  renderer/             drawing Komas with React
  exporters/            exporter interface and placeholder
docs/                   documentation
examples/               example projects
```

The repository is a pnpm workspace. Packages export their TypeScript source
directly and have no build step of their own: the application bundles them,
and tests and type checks read the source. This keeps the setup small and
makes every change visible immediately.

## Package responsibilities

| Package          | Responsibility                                                                                                               | Runs in                        |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| `core`           | schemas and types of projects, Komas, elements and transitions; colours; identifiers; document operations                    | everywhere                     |
| `brand-kit`      | default Brand Kit, validation of editor input, contrast checks, the Brand Kit as agents see it, the saved-kit library format | everywhere                     |
| `project-format` | deterministic serialisation, parsing, migrations, warnings; whole-file replacement under `/node`                             | everywhere, `/node` in Node.js |
| `motion-engine`  | comparing Komas, building and validating transitions, computing frames                                                       | everywhere                     |
| `agent-runtime`  | request and response contract, prompts, validation, conversion, registry, runner, mock provider; CLI providers under `/node` | everywhere, `/node` in Node.js |
| `renderer`       | React components that draw frames, asset loading, playback                                                                   | browser                        |
| `exporters`      | exporter interface, placeholder PowerPoint exporter                                                                          | Node.js                        |

### Deviations from the proposed layout

The proposed layout was kept. Three decisions need an explanation:

- **The Brand Kit schema is part of `core`.** A project contains a Brand Kit,
  so the schema of the project needs the schema of the Brand Kit. `brand-kit`
  depends on `core` and contains the behaviour around the schema. This
  avoids a dependency from the core model to another package.
- **Packages with code for Node.js have a separate entry point.**
  `project-format/node` and `agent-runtime/node` contain file access and
  process handling. The renderer imports the main entry points only, so code
  that needs Node.js cannot reach the window by accident.
- **There is no package for the `koma` command line tool.** The name is
  reserved. A command line tool is not part of the first milestone.

## Dependency direction

```text
                 apps/desktop
                      |
   +--------+---------+----------+-----------+
   |        |         |          |           |
renderer  agent-   project-   exporters   brand-kit
   |      runtime   format       |           |
   |       |  |       |          |           |
   |       |  +-------+----------+-----------+
   |       |          |          |
   +------> motion-engine <------+
              |
            core
```

`renderer`, `agent-runtime` and `project-format` depend on `motion-engine`.
`project-format` uses it to report stored motion that cannot be played.
`motion-engine` does not import `project-format`, so that edge does not
cycle. `agent-runtime` also depends on `brand-kit`. Every package above
`core` may depend on `core`.

Rules:

- `core` depends on the schema library and on nothing else. It does not
  import Electron, React, Node.js modules, providers, exporters or the
  motion engine.
- Packages never import from `apps/desktop`.
- There are no circular dependencies between packages.
- `renderer` consumes the model and the motion engine. It is not a source of
  truth: it holds no document state.
- `exporters` consume the model. Concepts of an export format do not enter
  the model.
- `agent-runtime` produces validated proposals. It does not know the user
  interface.

## Core Koma model

```text
KomaProject
  brandKit
  presentation
    komas[]
      elements[]          text, shape, image or group
    transitions[]
      elementTransitions[]
  assets[]
  agentConfiguration
  generationHistory[]
```

Properties of the model:

- **Validated at runtime.** Every type is derived from a schema. Data from
  files, from IPC and from agents is validated before it is used.
- **Immutable.** Document operations are pure functions that return a new
  document. This keeps undo simple and makes changes easy to detect.
- **Versioned.** Every project carries a schema version. See
  `docs/PROJECT_FORMAT.md`.
- **Independent.** The model has no concept of React components, Electron,
  PowerPoint, an animation library or an AI model.

## Persistent identities

Every element has an `id`, which identifies one element in one Koma, and a
`persistentId`, which names a visual object across Komas. Two elements with
the same `persistentId` in different Komas are one object in two states.

Persistent identity is what turns a sequence of pages into motion. It is part
of the model from the first version and is used by the motion engine, the
agent contract, the Koma strip and the inspector. See `docs/MOTION_MODEL.md`.

## Motion engine

The motion engine has four tasks:

| Function             | Task                                                          |
| -------------------- | ------------------------------------------------------------- |
| `diffKomas`          | compare two Komas and describe the change of every object     |
| `buildTransition`    | combine the comparison with normalised settings               |
| `syncTransitions`    | keep the transitions of a presentation in line with its Komas |
| `validateTransition` | check a stored transition against the presentation            |
| `computeFrame`       | compute what is visible at a given progress                   |

It is deterministic and has no dependency on a clock, on randomness or on
the renderer. A stored transition that fails semantic checks is reported and
not played. Otherwise `computeFrame` follows the stored transition.

## Renderer

The renderer draws a `Frame`: a background and a list of layers. A Koma at
rest and an interpolated moment of a transition have the same shape, so the
same component draws both.

- Komas are drawn with HTML for text and images and with SVG for shapes. No
  graphics editor framework is used.
- The stage has the logical size of the canvas and is scaled with one CSS
  transform. Thumbnails are the same component at a smaller scale.
- Images are loaded from the data stored in the project, as `data:` URLs of
  allowed image types. The renderer never loads a path or a URL.
- Playback is a hook that advances a progress value with animation frames. It
  knows nothing about Komas.

## Provider system

```text
chat input ──> buildGenerationRequest ──> GenerationRunner
                                              |  detect
                                              |  render prompt
                                              |  provider.generatePresentation  ──> raw output
                                              |  extract, validate, repair once
                                              v
                                       validated response
                                              |
                              convertResponseToPresentation
                                              |  motion engine computes operations
                                              v
                                    presentation proposal ──> renderer applies it
```

Providers return raw output. Validation, repair and conversion happen in the
runtime and are the same for every provider. See `docs/AGENT_PROVIDERS.md`.

## Exporter system

`PresentationExporter` has two functions: `validate` reports whether a
project can be exported, `export` writes it to a destination chosen by the
user. Results are typed, including the result `unsupported`.

The PowerPoint exporter is a placeholder. It reports that it is not
available, and the application shows it that way. See
`docs/POWERPOINT_EXPORT_RESEARCH.md`.

## Electron process boundaries

```text
+---------------------------+        +----------------------------------+
| Renderer (sandboxed)      |        | Main process (trusted)           |
|                           |        |                                  |
| React interface           |        | windows and native dialogs       |
| project state, undo       | <----> | reading and writing projects     |
| drawing and preview       |  IPC   | reading images                   |
|                           |        | agent providers and processes    |
| no Node.js, no files,     |        | validation of every request      |
| no processes, no own      |        |                                  |
| network connections       |        |                                  |
+---------------------------+        +----------------------------------+
              ^
              | contextBridge: invoke, subscribe
        +-----------+
        |  Preload  |
        +-----------+
```

- The **main process** is the only part that touches files and processes.
- The **renderer** is treated as untrusted. It holds the project while it is
  edited and sends complete projects to the main process to save them.
- The **preload script** exposes two functions, `invoke` and `subscribe`.
  Both accept only channel names from a fixed list.

### What the main process remembers

The main process keeps the path of the open project and whether there are
unsaved changes. The path is set by native dialogs only. "Save" writes to
that path; the renderer cannot name a path.

## IPC boundaries

The contract is defined once, in `apps/desktop/src/shared/ipc.ts`, with a
schema for the request and the response of every channel.

| Channel                        | Purpose                                     |
| ------------------------------ | ------------------------------------------- |
| `koma:project:create`          | create a project                            |
| `koma:project:open`            | choose and open a project                   |
| `koma:project:save`            | save to the current file                    |
| `koma:project:save-as`         | choose a file and save                      |
| `koma:brand-kit:select-logo`   | choose an image as logo                     |
| `koma:brand-kits:list`         | read the saved Brand Kit library            |
| `koma:brand-kits:create`       | save a Brand Kit and its logo               |
| `koma:brand-kits:update`       | replace a saved kit with project values     |
| `koma:brand-kits:rename`       | rename a saved kit                          |
| `koma:brand-kits:duplicate`    | copy a saved kit                            |
| `koma:brand-kits:delete`       | delete a saved kit                          |
| `koma:brand-kits:load`         | read a saved kit and its logo to apply it   |
| `koma:brand-kits:start-new`    | keep an unreadable library as a backup      |
| `koma:providers:detect`        | detect all providers                        |
| `koma:providers:list-models`   | list the models of a signed-in CLI          |
| `koma:providers:execute`       | run a generation                            |
| `koma:providers:cancel`        | stop a generation                           |
| `koma:app:set-unsaved-changes` | tell the main process about unsaved changes |
| `koma:app:confirm-close`       | close after saving                          |
| `koma:app:get-info`            | version, platform, exporters                |
| `koma:updates:get-status`      | the state of updating                       |
| `koma:updates:check`           | check for an update                         |
| `koma:updates:set-channel`     | choose the stable or the nightly channel    |
| `koma:updates:download`        | download the update that was found          |
| `koma:updates:install`         | restart and install the downloaded update   |

Events from the main process: `koma:providers:status`,
`koma:app:save-and-close` and `koma:updates:status`.

The update channels carry no addresses. The window chooses a channel; which
release, manifest and installer that means is decided in the main process
(`apps/desktop/src/main/updates`). See `docs/RELEASES.md`.

For every request the main process checks, in this order:

1. The sender is the top-level frame of the application window and shows the
   application page.
2. The payload matches the schema of the channel. Unknown properties are
   rejected.
3. The response matches the schema of the channel before it is sent.

The renderer validates every response and every event again. There is no
channel that accepts a command, a path or arbitrary data, and a test makes
sure that the channel list of the preload script equals the contract.

## Application state

| State                    | Where                           | Saved with the project |
| ------------------------ | ------------------------------- | ---------------------- |
| project and undo history | `projectStore`                  | the project, yes       |
| unsaved changes          | derived in `projectStore`       | no                     |
| selection, view, zoom    | `uiStore`                       | no                     |
| open Settings page       | `uiStore`                       | no                     |
| preview                  | `uiStore` and the playback hook | no                     |
| agent executions, chat   | `agentStore`                    | no                     |
| chat sidebar width, open | `uiStore`, window local storage | no                     |
| saved Brand Kit library  | `brandKitLibraryStore`, on disk | no, app data folder    |
| unfinished editor input  | component state                 | no                     |

Changes to the document are commands: pure functions from a project to a
project (`state/commands.ts`). The store applies a command and records the
previous project for undo. Commands that change Komas recompute the
transitions.

**Undo and redo are implemented** for all document changes, including
generation. The history holds up to 100 steps. A series of edits of the same
field within 1.2 seconds is one step. Undo history is not saved with the
project.

Saved Brand Kits are not project state. The library lives in the data folder
of the application (`brand-kits/library.json`, logos in `brand-kits/logos/`
named by the SHA-256 of their bytes), is read and written by the main process
only, and changes to it are not undoable. Applying a saved kit is a project
command: it copies the logo into the project's assets, reusing an asset with
the same bytes, and can be undone.

Unsaved changes are detected by comparing the current document with the
document that was last saved or loaded. Undoing back to the saved state
therefore clears the indicator.

## Security decisions

| Decision                                                                                      | Reason                                                                                                       |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Context isolation on, Node.js integration off, sandbox on                                     | code in the window cannot reach Node.js or Electron                                                          |
| Own protocol `koma://app` instead of `file://`                                                | the window has a real origin, and only files of the renderer bundle can be loaded                            |
| Content Security Policy without `unsafe-inline` for scripts and without `eval`                | injected markup cannot run code                                                                              |
| `connect-src 'none'`, a session request filter, and a connection allowlist that blocks WebRTC | the window cannot open its own network connections, including WebRTC over UDP or TCP                         |
| Repository links open in the system browser                                                   | the renderer can ask the operating system to open only this repository; the browser then reaches the network |
| Navigation and other new windows blocked                                                      | the window always shows the application                                                                      |
| Protocol files are resolved through canonical paths                                           | a junction, symlink or alternate stream inside the bundle cannot expose another file                         |
| All permission requests denied                                                                | the application needs no camera, microphone or location                                                      |
| No development server                                                                         | development builds use the same protocol and policy as production builds                                     |
| Paths come from native dialogs only                                                           | the renderer cannot read or write files of its choice                                                        |
| Images are verified by content and copied into the project                                    | project files cannot make the application read other files                                                   |
| Agent processes start without a shell                                                         | there is no shell that could interpret input                                                                 |
| Agent output is validated data                                                                | output of a model cannot execute anything or name files                                                      |

`SECURITY.md` describes the policy and how to report a vulnerability.

## Important trade-offs

| Decision                                                | Benefit                                       | Cost                                                                              |
| ------------------------------------------------------- | --------------------------------------------- | --------------------------------------------------------------------------------- |
| Rebuild and restart instead of a dev server             | one security configuration                    | no hot reloading; a change takes a few seconds and resets the state of the window |
| Assets inside the project file                          | one file, no missing files, no paths          | large files with many images; 2 MB per asset                                      |
| Snapshots for undo                                      | simple and reliable                           | memory grows with the size of the project, which embedded assets increase         |
| Whole project sent to the main process                  | the main process validates everything it uses | large IPC messages for projects with images                                       |
| Agents do not define element operations                 | motion is deterministic and always valid      | an agent cannot ask for an effect the engine does not derive                      |
| Changes that cannot be interpolated cross-fade          | every change can be played                    | a change of font size is a cross-fade, not a smooth change of size                |
| Vite used directly, without an Electron build framework | current Vite, few dependencies                | three small build configurations and a development script are maintained here     |
| TypeScript 6 instead of 7                               | type-aware linting works                      | the newest compiler is not used until the linter supports it                      |
| Packages export source                                  | no build step, fast feedback                  | packages cannot be published as they are                                          |
| Element editing through the inspector                   | precise values, accessible with the keyboard  | elements cannot be dragged on the canvas yet                                      |
