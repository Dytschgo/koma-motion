---
name: verify-koma-motion
description: Build and exercise the Electron application with isolated mock-provider fixtures and preserve evidence for review.
---

# Verify Koma Motion

Use the repository's Electron Playwright harness. Browser-only rendering does not verify preload, IPC, project files, or process isolation.

## Prepare and launch

Run from the repository root. Record `git rev-parse HEAD` and `git status --short` with the results; a checkout with local changes is not the same revision as its HEAD.

On Windows, use PowerShell. Node and pnpm requirements are in `package.json`. Never enable `KOMA_LIVE_*` for this workflow. Before running tests, check that no such environment variables are already set:

```powershell
if (Get-ChildItem Env: | Where-Object Name -Like 'KOMA_LIVE_*') {
  throw 'Live-provider variables are set; do not run this verification environment.'
}
pnpm install --frozen-lockfile
pnpm build
pnpm --filter @koma-motion/desktop exec playwright test workflow.spec.ts
```

Run commands separately and stop on a failure. Building must report `Built Koma Motion into apps/desktop/out`. The workflow spec waits for the actual application window and exercises Create, Generate with the mock provider, preview, edit, save, and reopen. Do not infer readiness from a delay.

For a manual session, `pnpm start` launches the built app. The repository scripts and `e2e/application.ts` remove `ELECTRON_RUN_AS_NODE`; preserve that behavior. Launching Electron directly with this variable set starts plain Node instead.

## Isolation and teardown

`e2e/application.ts` creates a unique temporary directory and Electron user-data profile per test. It starts the built desktop application, waits for its first window and DOM readiness, records renderer errors, and closes that instance after each test. Tests run with one worker. Keep UI runs serial unless their resources and output directories are separately isolated.

Teardown answers the close prompt with Do not save and removes that test's temporary directory. Never terminate all Electron or Node processes. For a manual session, close only the window you opened.

## Evidence and limits

Record the command, revision, platform, outcome, skipped tests, and actual assertions exercised. Preserve `apps/desktop/test-results` outside the checkout before another test run overwrites it. Failure traces are enabled. Put extra screenshots outside the temporary profile; include the native window size, reduced-motion setting, and source revision in the handoff.

Native Open and Save dialogs are stubbed in application tests. They verify IPC and actual project-file handling after selection, not operation of the OS dialog. An accessibility assertion is not a screen-reader test. Mock generation does not verify Claude/Codex authentication, flags, sandbox behavior, or structured-output compatibility.

For a changed implementation, also run the repository's format, lint, typecheck, unit-test, and build checks. Existing green CI does not verify a later local patch or an integration of independent branches.

## Feature paths

- [Brand Kit drafts](brand-kit.md): character-by-character input, independent validation, navigation, undo, and project replacement.
- [Preview controls](preview.md): transition identity, scrubbing, document edits, duration, and reduced motion at supported window sizes.
- [Persisted motion](persisted-motion.md): warnings, blocked interpolation, stacking, and unchanged source files.
- [Mock project workflow](project-workflow.md): create, generate, edit, save, and reopen.
- [External file conflicts](file-conflicts.md): refuse a stale save and keep local edits in a copy.
- [Project health and recovery](../../../docs/PROJECT_HEALTH.md): format upgrades, failed opens, targeted asset repairs, dismissal, and keyboard access.

The focused specs were introduced by separate draft PRs. If a named spec is absent from the checkout, report that prerequisite; do not silently substitute another test or claim the feature was covered.

## Separately requested real generation

[Real Claude Code generation](live-generation.md) is a separate opt-in path
for an explicit request to use the user's signed-in CLI. It is not part of
the mock workflow above or ordinary CI. It retains the real generated deck
and verifies editing, save/reopen, and transition preview.
