# Brand profile from reference files verification

Read [SKILL.md](SKILL.md) for the isolated Electron harness and the
mock-provider policy. Record revision, worktree status, platform and whether
LibreOffice was available. Preserve the Playwright output outside the worktree.

## Offline application workflow

Do not set any `KOMA_LIVE_*` variables. Build first. Set
`KOMA_LIBREOFFICE_EXECUTABLE` to a trusted local LibreOffice executable for the
PPTX test. If omitted, that test explicitly skips; report it.

```powershell
pnpm build
pnpm --filter @koma-motion/desktop exec playwright test brandProfile.spec.ts --output "D:\Code\KomaMotion-evidence\brand-profile-<run>"
```

The spec attaches a PNG, a JPEG made from it and the synthetic Northstar PDF
through the stubbed native dialog, from the Brand Kit picker of the chat. It
checks:

- the disclosure lists each file with its prepared previews, shows no path,
  and defaults to Claude Code · Opus; the mock is selected explicitly;
- uploaded images are decoded by the sandboxed renderer of the built app;
- the review keeps Brand Kit fields and instructions in separate regions,
  shows low confidence and the font caveat, and edits to both are kept;
- reviewing changes neither the project nor the library;
- Save and apply writes one library entry with instructions, logo and
  file-name provenance, and changes kit, logo and instructions of the project;
- one Undo restores all three, and Redo applies them again;
- a second project applies the saved profile from the library;
- nine files, an unsupported file and a text file named `.png` attach nothing;
- cancelling an analysis keeps the files, leaves no late proposal, and changes
  nothing; `KOMA_MOCK_OUTCOME=invalid` output is refused without a review;
- a failed library write applies nothing, keeps the reviewed draft, and
  succeeds on retry;
- Enter in a review field does not send the chat request.

The Claude selection is never run by this spec. Provider unavailability is
covered by unit tests, because the test machine may have Claude Code installed.

## Unit and regression checks

`pnpm test` covers the request and response contract, refused agent output,
the Claude invocation with a stubbed CLI, file-count, size, type, dimension
and text limits, the exhibit budget, provider unavailability without fallback,
cancellation and late results, save retry, the library entry, and applying and
undoing a profile. Also run `deckBrandKit.spec.ts`, `brandKitLibrary.spec.ts`
and `chatBrandKit.spec.ts`: they share the renderer, the library and the
picker with this workflow.

## Not verified by the mock workflow

What Opus infers from real brand material, Claude Code authentication and
structured-output compatibility for this schema, and the native file dialog.
A live run needs a separate explicit request. Use only synthetic material for
it and record the resolved model.
