# Real Claude Code generation

This is a separate, opt-in workflow. Use it only when the user has requested
real generation through their locally signed-in Claude Code CLI. It sends a
synthetic brief to Anthropic using that account. Keep the standard mock
verification workflow free of `KOMA_LIVE_*` variables.

## Prepare

Record the source revision and any local changes. Install dependencies with
`pnpm install --frozen-lockfile`, then run `pnpm build` from the repository
root. Building must report `Built Koma Motion into apps/desktop/out`.

Check `claude --version`. Installation detection does not prove sign-in;
if generation reports an authentication error, report it rather than changing
the user's account or credentials. Leave `KOMA_LIVE_MODEL` unset to use the
CLI's default model.

## Run on Windows

Run serially with other Electron verification sessions:

```powershell
$env:KOMA_LIVE_E2E = 'claude-code'
$komaLiveEvidence = Join-Path $env:TEMP ('koma-live-' + [guid]::NewGuid().ToString('N'))
$env:KOMA_LIVE_OUTPUT_DIR = $komaLiveEvidence
try {
  pnpm --filter @koma-motion/desktop exec playwright test live.spec.ts --output "$komaLiveEvidence/native-results"
} finally {
  Write-Host "Live generation evidence: $komaLiveEvidence"
  Remove-Item Env:KOMA_LIVE_E2E, Env:KOMA_LIVE_OUTPUT_DIR -ErrorAction SilentlyContinue
}
```

The test creates a unique Electron profile, selects Claude Code, sets the
project's time limit to 600 seconds, and requests three Komas for a fictional
cafe. It waits for generation to finish, then checks visible text, edits a
text element, exercises Undo/Redo, saves and reopens the edit, previews both
transitions, and checks for renderer errors. The app's normal validation and
CLI restrictions remain active.

Preview durations are set to two seconds in the reopened copy so automation
can observe playback. Those duration edits are not saved; the evidence
projects retain their generated durations.

## Evidence and cleanup

Use a fresh absolute output directory per run. The test writes fixed names:
`claude-code.koma`, `claude-code-edited.koma`, Koma screenshots,
`reopened.png`, and `verification.json`. The original project retains the
AI result; the edited copy demonstrates persistence. Inspect the screenshots
for readable layout and clipping; automated assertions do not establish
visual quality or factual accuracy.

The harness closes only its own application and removes its temporary
profile. Evidence in `KOMA_LIVE_OUTPUT_DIR` survives teardown and subsequent
Playwright runs. Without that variable, evidence goes into
`apps/desktop/test-results/live`, which the next test run clears. Report the
source revision, CLI version, platform, selected model or CLI default, test
result, and evidence location. Do not include account identifiers or keys.

Open the original `.koma` file in the built app to try the generated deck.
Open/Save dialogs in the automated test are stubbed; file handling is real.
This workflow does not exercise PowerPoint export. Codex live generation and
macOS Claude generation are not covered by it.

## Starters

`starters.live.spec.ts` generates each built-in starter with the same opt-in
variables and keeps `<starter>.koma`, a screenshot per Koma, two frames per
transition, a video and `verification.json` in `KOMA_LIVE_OUTPUT_DIR/<starter>`.
`KOMA_LIVE_STARTER=solar-system|finance-report|rapunzel` runs one starter.
Each starter can take several minutes; the project time limit is 1500 seconds.

```powershell
$env:KOMA_LIVE_E2E = 'claude-code'
$komaLiveEvidence = Join-Path 'D:/Code/KomaMotion-evidence' ('starters-' + [guid]::NewGuid().ToString('N'))
$env:KOMA_LIVE_OUTPUT_DIR = $komaLiveEvidence
pnpm --filter @koma-motion/desktop exec playwright test starters.live.spec.ts --output "$komaLiveEvidence/native-results"
```
