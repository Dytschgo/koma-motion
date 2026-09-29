# Changelog

All notable changes to Koma Motion are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Koma Motion has not had a release yet. Until version 1.0.0, any release may
contain breaking changes, including changes to the project format.

## [Unreleased]

First vertical slice of the desktop application. Everything listed here is an
early-stage prototype.

### Added

- Monorepo with a platform-independent document model (`@koma-motion/core`)
  with persistent object identity and a documented coordinate system.
- Runtime-validated, schema-versioned `.koma` project format (version 1) with
  deterministic serialisation, migrations for future versions and atomic
  saving.
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

### Not included

- PowerPoint export.
- Installers, code signing and automatic updates.
