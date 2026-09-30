# Working in Koma Motion

Read `CONTRIBUTING.md` and `ARCHITECTURE.md` before changing the application.
Use `.agents/skills/verify-koma-motion/SKILL.md` for native application checks.

## Parallel work

- Keep the main checkout on `main`. Give each concurrent writer a separate
  worktree and branch, created from a recorded commit of `origin/main`.
- Put worktrees in a sibling `KomaMotion-worktrees` directory, with one named
  folder per task. See [the workflow](docs/MULTI_AGENT_WORKFLOW.md) for commands.
- Assign an absolute working directory, owned files, acceptance criteria, and
  allowed Git actions. One coordinator owns integration and merges. Workers
  must not edit another worktree or push directly to `main`.
- Coordinate shared schemas, lockfiles, generated screenshots, and changes to
  the same user flow before implementation. Separate files can still conflict
  in behavior.
- Install and build in each worktree. Do not share `out` directories. Electron
  tests already isolate profiles; use a separate test output directory per run.
- Preserve dirty work and unique commits. Remove a worktree only after its work
  is merged or archived and useful ignored evidence has been retained.

## Acceptance

Run formatting, lint, type checking, unit tests, build, and relevant Electron
tests on the combined revision. Use mock providers by default. Live provider
tests require a separate explicit request. Do not turn a skipped test into a
claim of coverage. Review changed assertions against the user behavior they
protect, especially when integrating Inspector, chat, and motion changes.

Merge only when the user has authorized it and the current integrated revision
has passed the applicable checks. Never bypass repository protections.
