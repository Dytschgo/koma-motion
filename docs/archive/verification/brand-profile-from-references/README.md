# Brand profile from reference files: Windows verification

Verified on 2 October 2026 against implementation commit
`fae278449a10ecb6754e80e1f59cc85706dce326`, with a clean worktree. This evidence
commit adds documentation and captures only.

The feature branch is `feat/brand-profile-from-references`, based on `main` at
`89be0a5917f49ff31d8b6850e247eda74e78b48c`.

## Environment

- Windows 11 Pro build 26200; Node 24.18.0; pnpm 11.25.0.
- Built Electron application launched through the repository's
  isolated-profile Playwright harness. Native file-picker responses were
  stubbed; the actual preload, IPC, sandboxed renderer, files and library
  persistence ran.
- Mock provider only. No `KOMA_LIVE_*` variable was set and no content was sent
  to a provider.
- LibreOffice was not installed and `KOMA_LIBREOFFICE_EXECUTABLE` was not set.
- Native window 1480 × 920, renderer viewport 1448 × 842, device scale factor
  0.5, reduced motion false. See [recorded environment](environment.json).

## Results

| Check                                  | Result                                  |
| -------------------------------------- | --------------------------------------- |
| `pnpm format:check`                    | passed                                  |
| `pnpm lint`                            | passed                                  |
| `pnpm typecheck`                       | passed                                  |
| `pnpm test`                            | 976 passed, 6 skipped (live tests)      |
| `pnpm build`                           | passed                                  |
| `playwright test` (whole suite)        | 117 passed, 16 skipped, 0 failed        |
| `brandProfile.spec.ts` within that run | 6 passed, 1 skipped (PPTX, LibreOffice) |

The 16 skipped Electron tests are the live-provider specs, the capture-only
specs, and three tests that need LibreOffice: the PPTX case of this workflow
and two of the existing deck workflow.

## Captures

Fixtures are the synthetic Northstar logo, a JPEG made from it, and the
synthetic Northstar PDF.

1. [Attached material and disclosure](01-attached-and-disclosure.png)
2. [Prepared content](02-prepared-content.png)
3. [Review: Brand Kit](03-review-brand-kit.png)
4. [Review: project instructions](04-review-instructions.png)
5. [Saved and applied](05-saved-and-applied.png)
6. [Reuse in another project](06-reuse-in-another-project.png)

## Not verified

- **PPTX in this workflow.** The test skipped. PPTX uses the same local
  conversion as the deck workflow, which was verified with LibreOffice in
  [its own report](../brand-kit-from-deck/README.md), but the combination was
  not run here.
- **Claude Code and Opus.** No live analysis was run: what Opus infers from
  real material, authentication, and whether the installed CLI accepts this
  response schema are unverified. The invocation flags are the ones the deck
  workflow uses; the schema is new.
- **Provider unavailability in the built app.** It is covered by unit tests
  only, because this machine has Claude Code installed.
- **The native file dialog and macOS.**
