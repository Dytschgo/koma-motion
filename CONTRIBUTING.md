# Contributing to Koma Motion

Thank you for your interest in Koma Motion. The project is an early-stage
prototype, which means that contributions can still shape its foundations.

By taking part you agree to follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Before you start

- For a bug, open an issue with the bug report template.
- For a feature, open an issue first so the direction can be discussed before
  you invest time. The [roadmap issues](https://github.com/Dytschgo/koma-motion/issues)
  show what is planned.
- For a security problem, follow [SECURITY.md](SECURITY.md). Do not open a
  public issue.

## Requirements

- Node.js 22.12 or newer
- pnpm 11
- macOS or Windows

## Setup

```sh
git clone https://github.com/Dytschgo/koma-motion.git
cd koma-motion
pnpm install
pnpm dev
```

## Checks

Run all checks before you open a pull request:

```sh
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

`pnpm check` runs the four commands in sequence. `pnpm test:e2e` runs the
application-level workflow test against the built application.

## Project layout

[ARCHITECTURE.md](ARCHITECTURE.md) explains the packages and the direction in
which they may depend on one another. The most important rules:

- `@koma-motion/core` depends on nothing but the schema library. It must not
  import Electron, React, Node.js modules, providers or exporters.
- Packages must never import from `apps/desktop`.
- The renderer reads the document model. It is not the source of truth.
- Exporter-specific concepts do not belong in the core model.

## Code guidelines

- TypeScript is strict. Do not use `any`. Avoid type assertions; validate
  instead.
- Data that enters from files, IPC or agents is validated at runtime with a
  schema. TypeScript types alone are not enough.
- Keep business logic out of React components. Pure functions in the packages
  are easier to test.
- Add or update tests with every behaviour change.
- Use "Koma" in the user interface. Use "slide" only for exported slides or
  when explaining compatibility with conventional presentation tools.
- Do not describe a feature as available unless it is implemented and tested.
- Never weaken the Electron security settings, not even for development.

## Commits and pull requests

- Use [Conventional Commits](https://www.conventionalcommits.org), for example
  `feat: add path motion` or `fix: keep z-order during replace`.
- Keep pull requests focused on one change.
- Describe what you changed, why, and how you tested it.
- Never commit secrets, API keys, `.env` files, signing material, build output
  or personal presentations.

## Licence

Koma Motion is released under the [MIT licence](LICENSE). By contributing you
agree that your contributions are licensed under the same terms.
