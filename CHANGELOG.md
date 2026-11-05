# Changelog

All notable changes to Koma Motion are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Until version 1.0.0, any release may contain breaking changes, including
changes to the project format.

## [Unreleased]

### Changed

- The editor is canvas first, in a warm light theme. One thin top bar holds
  the project menu (New, Open, Save, Brand Kit, instructions, model, settings,
  Project health, Getting started), the project name and saved state, Undo and
  Redo, Add element, Properties, Play with presenting and motion timing, and
  Share (Export PowerPoint, Save as). The Koma column, the Chat/Inspect dock
  and the permanent transport band are gone.
- Komas form a horizontal filmstrip below the canvas. Dots between thumbnails
  are the motion between Komas: selecting one previews it and opens its
  timing, and a marked dot explains a motion that cannot play and offers its
  fix.
- One floating prompt sits above the filmstrip with the request, a scope chip
  naming its target (for example Koma 2), Generation options and Send or Stop.
  The conversation opens upward on demand and keeps the draft, choices,
  consent, reading position and run. A failed request shows "Couldn’t use the
  result. Nothing changed." with Recheck where it was made.
- Selecting an object shows a toolbar beside it for colour, size, stacking,
  motion and more. All properties and Layers open in a popover that can be
  pinned beside the canvas.

## [0.2.0] - 2026-10-10

Projects now use format 5. Projects of formats 1 to 4 are upgraded in memory
and marked unsaved until saved in the current format. Koma Motion 0.1.x cannot
open a project saved by this version: keep a copy before upgrading. The
installers remain unsigned.

### Added

- Text, rectangles, circles and lines can be created on any Koma without a
  provider, and elements can be removed. **Inspect** opens the Inspector for
  the selected object, also in a narrow window.
- Elements can be grouped and ungrouped. Select several elements with Shift or
  Ctrl/Command on the canvas or in Layers, then use **Group** (Ctrl/Command+G)
  or **Ungroup** (Ctrl/Command+Shift+G). Nothing moves on the canvas, each
  action is one undo step, and the same objects grouped on neighbouring Komas
  move as one object. Agents are not offered groups yet.
- Komas can be reordered by dragging them in the Koma strip. A bar marks the
  drop position, the strip scrolls at its edges, Escape cancels, and each drop
  is one undo step that behaves like the move buttons.
- A searchable **Deck overview** finds Komas by number, title and purpose, and
  moves the selected Koma to a numbered position in one undo step.
- Generation for the selected Koma creates a proposal with a preview. **Apply**
  changes only that Koma in one undo step; **Discard** leaves the project
  unchanged.
- After an interruption, Koma Motion offers to recover the unsaved work as a
  protected copy, or to discard it. The recovered copy must be saved under a
  new name.
- **Present** plays the whole presentation in the window or full screen, from
  the beginning (F5) or from the selected Koma (Shift+F5). Each Koma plays in
  order with its transition. Previous, next, pause and resume, replay, the
  position ("3 of 8") and exit are on screen and on the keyboard; Escape
  exits. A presentation advances on request; autoplay with a time per Koma
  is a setting of the open window and is not saved in the project.
  Transitions that cannot play are listed before the presentation starts:
  return to edit them, or cut across exactly the listed transitions. Edits,
  deletions, reordering and undo while presenting are followed.
- Each Koma can store its own hold duration for presenting and timed
  PowerPoint export, with undo. Komas without one use the global setting.
- A Brand Kit and matching project instructions can be created from brand
  material attached in the chat, reviewed with evidence per finding, and saved
  to the library.
- A quick-start guide opens from Welcome and from **Getting started**. It
  never opens by itself.
- macOS updates can be started from the app in Terminal. The release archive
  and app bundle are verified before replacement, and a rollback copy is kept.
- Claude Code can run through Google Vertex AI and Claude gateways configured
  in the environment or in Claude's settings file.
- A JSON Schema of the `.koma` format is published at
  `docs/schema/koma-project.schema.json`, generated from the runtime schema and
  checked against it by a unit test.
- Opt-in live generation test for Codex: `KOMA_LIVE_GENERATION=codex`.
- An optional local signing path for Windows and macOS packages, with a strict
  preflight. It has not been run with real certificates; published installers
  stay unsigned.

### Changed

- The model chooser lists the models and reasoning options that the installed
  CLIs report, instead of a built-in list. Format 4 stores reasoning choices
  per provider and model; saved choices are checked again before each run.
- An out-of-date transition shows a compact status in the Koma strip, between
  its source and destination Komas, with **Regenerate transition** on that
  transition. A failed or cancelled regeneration leaves both Komas unchanged.
- The Codex CLI provider has generated presentations on Windows with Codex CLI
  0.162.1 and is no longer marked experimental. It is not verified on macOS.
- CLI providers receive only their own API key, home folder and gateway
  settings, not those of the other providers.
- PowerPoint export uses Morph only for transitions that can play in Koma
  Motion; stale stored motion is exported as a fade.
- The project format documents which unknown data is kept, the compatibility
  rules until the format is stable, and when it will be declared stable.

### Fixed

- Corrupt embedded images and corrupt Brand Kit library logos are detected on
  open, import and reuse, shown as placeholders, and listed in Project health
  with a targeted repair.
- A failed Codex run shows the Codex error instead of the echoed prompt.
- Applying a Brand Kit returns keyboard focus to the picker after loading.

### Not included

- Code signing and notarisation of the published installers.
- Verification of the providers and of PowerPoint export on macOS.
- Opening a project by double-clicking a `.koma` file.

## [0.1.1] - 2026-10-02

Projects now use format 3. Older projects are upgraded in memory and marked
unsaved until saved in the current format. Keep a copy before upgrading.
The installers remain unsigned, and macOS updates still use the download page.

### Added

- Create a reusable Brand Kit from a local PDF or PPTX using Claude Code's
  Opus model. Preview the prepared content before sending, review and edit
  the proposal, and confirm any logo before saving a new library kit. PPTX
  preparation requires a local LibreOffice installation. Saving the kit does
  not change the open project; applying it is a separate undoable action.
- Project health and recovery: review format upgrades, missing images and
  motion issues, repair individual images or the Brand Kit logo, and save
  an upgraded copy. A failed open preserves the current editor session.
- Image generation through the Codex and Grok CLIs, with an image backend
  choice in the composer and validated image imports. Mock-provider tests
  cover generation, failure and cancellation; live image generation has
  not been verified.
- Compact model and Brand Kit pickers in the chat, with model search,
  favourites, and saved-kit previews and application.
- Three starters on the welcome screen and under **Settings, Templates**:
  **Solar system** (Deep Orbit), **Quarterly results** for the fictional
  Northwind Labs, and **Rapunzel story** (Golden Tower Tales). Each brings a
  Brand Kit and project instructions that ask for shape-drawn scenes with
  persistent objects that travel, grow and change colour between Komas, and
  puts a first request into the chat. Applying a starter to an open project is
  one step that Undo reverts. The mock provider still answers with its demo.
- Editable PowerPoint (`.pptx`) export from a native save dialog. Text, shapes
  and supported pictures remain editable. Choose static slides, slide fades or
  Morph for eligible continuous transitions, with optional automatic advance.
  Validation and result warnings identify approximations and omitted effects.
  The generated fixture opened without repair in Windows PowerPoint and
  survived edits, save and reopen; macOS PowerPoint is not yet verified.
- Session-only TXT, Markdown and PDF references for generation. A native dialog
  selects bounded files and extracts text locally; the chat shows the text and
  any truncation before sending. External providers require separate consent.
  Prompts mark source text as untrusted and use numbered source labels without
  sending reference filenames or IDs in that section. References are not saved
  in `.koma` projects or PowerPoint exports.
- Run activity in the chat: a pixel character follows the observed phases of a
  generation (starting, generating, checking, correcting, completed, failed,
  stopped), with the elapsed time. **Open run monitor** shows the same run with
  a timeline and the streamed text; it starts nothing new. Reduced motion
  shows a still pose.
- The chat shows what Claude writes while it generates. Only its visible text is
  streamed; thinking, tool input and error output are never shown. The text
  stays with the result. The mock provider streams a short demo narration;
  Codex and Grok show their phases.
- Model selection in the chat composer: the provider and the model are two
  controls, and the footer names the model the next run uses. Claude Code
  offers its aliases and model names, Grok lists the models of your sign-in on
  request, and any provider that accepts one takes a validated model id.
- Settings is organised into categories. **This project** holds the
  instructions, the time limit and the models, which are saved in the .koma
  file and can be undone. **Koma Motion** holds templates, providers, updates
  and About, which apply to every project. Each page names where its values
  are stored. Arrow keys, Home and End move between categories.
- Grok CLI provider. Detection and generation were verified on Windows with
  Grok 1.0.44. The CLI keeps its own sign-in. Koma Motion does not store an
  API key.
- Brand Kit library: save the Brand Kit of a project, logo included, create a
  blank kit, rename, duplicate, update and delete saved kits, and apply one to
  any project. The library is stored in the data folder of the application,
  outside project files. Applying a kit is undoable and marks the project as
  changed.
- Canvas editing: move, resize and rotate elements on the canvas, and edit
  text and replace images in place. Rotation stays within document limits.
- Project instructions, sent with every generation request, and reusable
  instruction templates stored by the application.
- A transition that cannot play is explained in one warning between the canvas
  and the preview controls. It names both Komas and the reason, links to both
  Komas, and for stale or damaged motion offers **Regenerate transition**,
  which asks the selected provider and model for new timing and rebuilds only
  that transition from the current Komas. A result is discarded if either Koma
  changed in the meantime. The Koma strip marks such in-betweens.

- Layers in the Inspector: every element of the Koma, frontmost first, with
  its type, name and whether it is hidden, locked or off the canvas. Select
  covered and hidden elements, show or hide and lock them, filter long lists,
  and bring elements forward or send them backward.
- Recalculate motion: a transition whose Komas changed after its motion was
  worked out is marked as out of date and can be rebuilt as one undoable
  step. Its duration, strategy, easing and rationale are kept.

### Changed

- The composer adapts to the sidebar width, Inspector text areas grow with
  their content, and empty-project states explain what appears after
  generation. Zoom is disabled until a Koma exists.
- A consistent visual system across the application: flat panels on one
  surface level with 44-pixel headers, a quieter top bar with the file name
  and save state in one chip, segmented tabs in the Inspector and the Brand
  Kit, a dot-grid desk under the canvas, and shared radius, shadow and focus
  styles. Decorative gradients were removed.
- The chat header no longer has the two help buttons. A time limit, when one
  is set, is shown under the composer; it is changed under Settings,
  Generation.
- The chat composer puts the provider, its model and the number of Komas
  side by side. The Koma count starts at 5 and offers Auto. The model list
  shows Default and the model id configured for the provider. The Audience
  field was removed: the agent infers the audience from the request.
- Play, Restart, the position control and Preview are disabled for a
  transition that cannot play, instead of holding the source Koma.
- Transition problems are no longer listed as load warnings or repeated in
  the Inspector. `parseProject` no longer adds them to its `warnings`; use
  `validateTransition` for them.
- `AgentProvider` has a second method, `generateTransition`, and
  `GenerationRunner` a second entry point, `executeTransition`.

- The Inspector shows one context at a time: the selected element, the Koma
  or its motion. Selecting on the canvas opens the element; a preview opens
  the motion. Element controls for the type come first; less frequent Koma
  settings fold away.
- The Brand Kit opens in a panel beside the canvas instead of replacing it,
  so the Komas and the transition controls stay available.
- Only one Koma Motion runs per data folder. Starting it again brings the
  open window to the front, so two processes can no longer overwrite each
  other's saved Brand Kits or instruction templates.
- Removed the 12-Koma generation and 200-Koma project caps across contracts,
  prompts, editing, and files; replaced the count dropdown with numeric input.
- Replaced short request, generated-element and text restrictions with documented
  memory/rendering budgets; retained bounded, validated output and file handling.
- Made generation deadlines optional and disabled by default. Format 3 upgrades
  legacy projects and disables their automatic deadline; cancellation remains available.
- Added large-deck pipeline, save/reopen, migration, timer, and safety-boundary tests.
- The agent chat is a sidebar to the right of the canvas instead of a panel
  below it. Collapse it to give the canvas its space back, and resize it by
  dragging its edge or with the arrow keys. The width and whether it is open
  are remembered by the application, not saved in the project. In a narrow
  window the open chat is shown in place of the Inspector, and the chat and
  the Brand Kit take turns: the chat comes back when the Brand Kit closes.

### Fixed

- Saving refuses to overwrite a project changed or removed outside the
  application. Local edits can be saved as a copy instead.
- Generation rechecks project edits and image assets before applying a
  result, so a pending response cannot silently replace newer edits.
- Replacing a Brand Kit logo preserves assets still used by canvas images
  and rejects replacements that would make the project impossible to save.
- The chat returns after closing the Brand Kit in a narrow window.
- Explicit model choices stay selected even when they match the provider's
  current default. Choosing Default still leaves model selection to the provider.
- The run monitor reports failure when generated Komas cannot be applied,
  including image assets replaced while a generation decision is pending.

## [0.1.0] - 2026-09-29

The first release: a vertical slice of the desktop application from the chat
to a saved file. Everything listed here is an early-stage prototype.

### Added

- Monorepo with a platform-independent document model (`@koma-motion/core`)
  with persistent object identity and a documented coordinate system.
- Runtime-validated, schema-versioned `.koma` project format (version 1) with
  deterministic serialisation, migrations for future versions and whole-file
  replacement.
- Brand Kit model, validation, readability checks and editor with a live
  preview.
- Deterministic motion engine that compares adjacent Komas by persistent
  identity and produces the operations hold, move, scale, rotate, fade in,
  fade out, colour change and replace.
- React renderer and transition preview with play, pause, restart, position
  and duration, and a behaviour for reduced motion.
- Agent provider architecture with a registry, detection, execution
  lifecycle, status events, cancellation, timeouts, structured errors, one
  bounded repair attempt and versioned prompt templates.
- Deterministic mock provider that works without any AI service.
- Claude Code CLI provider, verified on Windows.
- Codex CLI provider. Experimental: generation has not been verified.
- Exporter interface and a placeholder PowerPoint exporter that reports that
  export is not available.
- Electron desktop application with context isolation, a sandboxed window, an
  own protocol with a Content Security Policy and a validated IPC contract.
- Undo and redo for all document changes.
- Unit tests, application tests and CI on Windows and macOS.
- Installers for Windows and macOS, an application icon, and a stable and a
  nightly update channel. On Windows the application downloads and installs
  an update when the user chooses to. On macOS it opens the download page.
  The installers are not signed.

### Fixed

- Agent output with more than one possible answer is rejected even when a
  provider supplies structured output, and a result text of Claude Code that
  disagrees with its structured output is rejected.
- Diagnostics redact everything after an Authorization name, including
  values of letters only and quoted values with escaped quotes, and are
  processed in a time that is proportional to a bounded input.
- A transition is validated once for the same Komas and operations instead
  of once per frame of the preview.
- Saving and opening a project use one 64 MiB UTF-8 limit, including unknown
  extension data and the combined size of embedded assets. A project that
  saves can be opened again.
- Saving no longer replaces an existing file that is too large or otherwise
  impossible to inspect. A missing file can still be created. A failed save
  leaves the previous file in place and removes its temporary file.
- The sandboxed window can no longer send WebRTC traffic, including STUN and
  TURN over UDP or TCP. Files outside the renderer bundle can no longer be
  loaded through a junction, a symlink or a Windows alternate data stream.

### Not included

- PowerPoint export.
- Code signing and notarisation of the installers.
- Installing updates on macOS.
