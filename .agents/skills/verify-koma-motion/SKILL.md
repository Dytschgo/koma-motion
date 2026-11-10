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
```

Run commands separately and stop on a failure. Building must report `Built Koma Motion into apps/desktop/out`. The workflow spec waits for the actual application window and exercises Create, Generate with the mock provider, preview, edit, save, and reopen. Do not infer readiness from a delay.

Prepare a fresh absolute evidence directory outside every checkout before each
native invocation, including commands in the feature guides. Record the clean
revision being tested; if local changes remain, retain the status and diff and
describe the result as a dirty revision. Use a GUID so two runs cannot share
output names. For another machine, change the evidence root to an existing
absolute directory outside its worktrees.

```powershell
$komaVerifyOutput = Join-Path 'D:/Code/KomaMotion-evidence' ('native-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $komaVerifyOutput | Out-Null
git rev-parse HEAD | Set-Content (Join-Path $komaVerifyOutput 'revision.txt')
Set-Content (Join-Path $komaVerifyOutput 'status.txt') -Value ((git status --short) -join [Environment]::NewLine)
Set-Content (Join-Path $komaVerifyOutput 'local.patch') -Value ((git diff --binary) -join [Environment]::NewLine)
$env:PLAYWRIGHT_JSON_OUTPUT_NAME = Join-Path $komaVerifyOutput 'report.json'
pnpm --filter @koma-motion/desktop exec playwright test workflow.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'
```

Record the invocation and exit code alongside that report. Preserve skipped
and retried attempts; a retry success does not establish that the first run
passed. Verify the report's outcomes rather than only its file existence.

For a manual session, `pnpm start` launches the built app. The repository scripts and `e2e/application.ts` remove `ELECTRON_RUN_AS_NODE`; preserve that behavior. Launching Electron directly with this variable set starts plain Node instead.

## Isolation and teardown

`e2e/application.ts` creates a unique temporary directory and Electron user-data profile per test. It starts the built desktop application, waits for its first window and DOM readiness, records renderer errors, and closes that instance after each test. Tests run with one worker. Keep UI runs serial unless their resources and output directories are separately isolated.

Teardown answers the close prompt with Do not save and removes that test's temporary directory. Never terminate all Electron or Node processes. For a manual session, close only the window you opened.

## Evidence and limits

Record the command, revision, dirty status, platform, outcome, skipped tests,
retries, and actual assertions exercised. Always pass the fresh external
`--output` directory; the default `apps/desktop/test-results` is shared by
successive runs and can be overwritten. Failure traces and screenshots written
with `test.info().outputPath()` then survive profile teardown in that external
directory. Put other captures there too; include observed native content size,
reduced-motion setting, and source revision in the handoff.

Native Open and Save dialogs are stubbed in application tests. They verify IPC and actual project-file handling after selection, not operation of the OS dialog. An accessibility assertion is not a screen-reader test. Mock generation does not verify Claude/Codex authentication, flags, sandbox behavior, or structured-output compatibility.

For a changed implementation, also run the repository's format, lint, typecheck, unit-test, and build checks. Existing green CI does not verify a later local patch or an integration of independent branches.

## Intermittent failures

One pass does not show that a test is stable. Repeat a new or changed native
test, and any test you suspect, without retries and with a fresh output
directory. Repeat the whole file too: some failures need tests that follow one
another.

```powershell
pnpm --filter @koma-motion/desktop exec playwright test recovery.spec.ts --repeat-each 12 --retries=0 --output "$komaVerifyOutput/repeat" --reporter 'line,json'
```

Report failures as a count of the runs, with the command and revision. A failure
that needs timing can depend on what else uses the machine, so say whether
anything else ran, and where the real pointer was if input is involved.

CI retries a failed native test once. A test that passes only on that retry
keeps its job green, so each Application tests job reports it twice: under
"Warning: passed only on retry" in the job summary, and as a warning annotation
named "Test passed only on retry" on the run and in the pull request's checks.
The failed attempt's trace is in the job's `application-test-results-*`
artifact. Treat it as a failure to diagnose. The `UI confidence` workflow
repeats native tests without retries: its focused repetition runs on pull
requests that touch the renderer or the native tests, and the complete suite
runs twenty times every Monday against `main` or on demand with
`gh workflow run "UI confidence" --ref <branch>`.

`launchApplication` returns once the window is shown and its page has the
window's final size. Do not act on a window obtained another way before then:
the first layout of the window resizes the page, which closes open menus.

## Feature paths

- [Settings and instructions](settings.md): category navigation, project model choices,
  time limits, templates, and draft recovery.
- [Generation activity](generation-activity.md): streamed output, run monitoring,
  cancellation, failure, and reduced motion.
- [Brand Kit from deck](deck-brand-kit.md): local PPTX/PDF preparation, disclosure,
  isolated review, library save, logo confirmation, cancellation, and optional live Opus analysis.
- [Brand profile from reference files](brand-profile.md): brand material attached in the chat,
  file limits, disclosure, separate review of Brand Kit and instructions, one library entry,
  save retry, and applying or undoing both in one step.

- [Brand Kit drafts](brand-kit.md): character-by-character input, independent validation, navigation, undo, and project replacement.
- [Preview controls](preview.md): transition identity, scrubbing, document edits, duration, and reduced motion at supported window sizes.
- [Presentation player](presentation.md): whole-deck playback, keyboard, full screen, autoplay, the review of transitions that cannot play, and edits while presenting.
- [Persisted motion](persisted-motion.md): warnings, blocked interpolation, stacking, and unchanged source files.
- [Mock project workflow](project-workflow.md): create, generate, edit, save, and reopen.
- [External file conflicts](file-conflicts.md): refuse a stale save and keep local edits in a copy.
- [Project health and recovery](../../../../docs/PROJECT_HEALTH.md): format upgrades, failed opens, targeted asset repairs, dismissal, and keyboard access.
- [Composer, canvas, Inspector and motion](studio.md): integrated editing and recovery paths.
- [PowerPoint export and references](export-references.md): editable PPTX package and Windows PowerPoint checks, bounded text extraction, session privacy and mock-provider consent.

If a named spec is absent from the checkout, report that prerequisite; do not silently substitute another test or claim the feature was covered.

## Separately requested real generation

[Real Claude Code generation](live-generation.md) is a separate opt-in path
for an explicit request to use the user's signed-in CLI. It is not part of
the mock workflow above or ordinary CI. It retains the real generated deck
and verifies editing, save/reopen, and transition preview.
