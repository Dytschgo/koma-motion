# Changelog

All notable changes to Koma Motion are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Until version 1.0.0, any release may contain breaking changes, including
changes to the project format.

## [Unreleased]

### Added

- Grok CLI provider. Detection and generation were verified on Windows with
  Grok 1.0.44. The CLI keeps its own sign-in. Koma Motion does not store an
  API key.
- Brand Kit library: save the Brand Kit of a project, logo included, create a
  blank kit, rename, duplicate, update and delete saved kits, and apply one to
  any project. The library is stored in the data folder of the application,
  outside project files. Applying a kit is undoable and marks the project as
  changed.
- Canvas editing: move and resize elements on the canvas, and edit text and
  replace images in place.
- Project instructions, sent with every generation request, and reusable
  instruction templates stored by the application.

### Changed

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
