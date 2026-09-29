# Changelog

All notable changes to Koma Motion are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Koma Motion has not had a release yet. Until version 1.0.0, any release may
contain breaking changes.

## [Unreleased]

First vertical slice of the desktop application. Everything listed here is an
early-stage prototype.

### Added

- Monorepo with a platform-independent document model (`@koma-motion/core`).
- Runtime-validated, schema-versioned `.koma` project format with
  deterministic serialisation and atomic saving.
- Brand Kit model, validation, contrast checks and editor.
- Deterministic motion engine that compares adjacent Komas by persistent
  identity and produces element-level transition operations.
- React renderer and transition preview driven by the transition model.
- Agent provider architecture with a registry, detection, execution lifecycle,
  cancellation, timeouts and structured errors.
- Deterministic mock provider that works without any AI service.
- Claude Code CLI provider and Codex CLI provider. See
  `docs/AGENT_PROVIDERS.md` for what has and has not been verified.
- Exporter interface and a placeholder PowerPoint exporter that reports that
  export is not available.
- Electron desktop shell with context isolation, a sandboxed renderer and a
  narrow, validated IPC surface.
