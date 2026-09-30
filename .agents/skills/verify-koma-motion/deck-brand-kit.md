# Brand Kit from deck verification

Run from a dedicated worktree with the merged Brand Kit library dependency.
Record revision, worktree status, Windows/macOS version, Claude version, and
LibreOffice version. Preserve `apps/desktop/test-results` outside the worktree
before another UI run overwrites it.

## Offline application workflow

Do not set any `KOMA_LIVE_*` variables for the mock run. Build first.
Set `KOMA_LIBREOFFICE_EXECUTABLE` to a trusted local LibreOffice executable for
PPTX integration. If omitted, the focused PPTX test explicitly skips; report it.

```powershell
pnpm build
pnpm --filter @koma-motion/desktop exec playwright test deckBrandKit.spec.ts
```

The checked-in `e2e/fixtures/decks` files are synthetic Northstar slides, not
user data. The PDF and PPTX show navy backgrounds, amber rectangles, teal
circles, white text, and a recurring whole PNG logo. `encrypted.pdf` is a
password-protected copy for rejection testing.

The workflow records selection, prepared content, progress, review/edit, save,
and explicit apply screenshots. It checks filename-only provenance, logo
storage for PPTX, no logo for PDF, original project bytes and clean state after
library save, and project change only after Apply. Native file pickers are
stubbed, as in the existing Electron harness; this does not verify OS dialog
interaction. Encrypted-PDF rejection checks temporary-directory cleanup.

## Explicit live verification

Only when the user requests live provider verification, run separately:

```powershell
$env:KOMA_LIVE_DECK_ANALYSIS = '1'
pnpm --filter @koma-motion/desktop exec playwright test deckBrandKit.live.spec.ts
Remove-Item Env:KOMA_LIVE_DECK_ANALYSIS
```

This sends the synthetic PDF's prepared slide images/text to Anthropic through
Claude Code `--model opus`. It verifies disclosure, analysis, validated review,
and a library save in an isolated app profile. Preserve `live-review.txt` and
screenshots. Record the CLI's actual resolved model separately when probing
the input protocol; the saved provenance identifies the requested alias.

Mock results do not verify model perception or authentication. Test both
desktop platforms before asserting platform-wide live input support.

## Unit and regression checks

`pnpm test` covers strict request/response validation, agent flag isolation,
provider failures and late responses, archive integrity/expansion limits,
encrypted and malformed archives, active/external content rejection, logo
dimensions and no-logo handling, draft cancellation, temporary cleanup, and
library-save retry. Run format, lint, typecheck, full unit tests, and build
after implementation changes. Also exercise the existing Brand Kit library
and project workflow specs.
