# Verify PowerPoint export and reference files

Run from the repository root against a recorded revision. Read
[SKILL.md](SKILL.md) for the isolated Electron harness, mock-provider policy,
test-output retention and general checks. Keep live-provider variables unset.
Use mock providers for every automated path below; a real CLI call requires
a separate explicit request.

## Automated checks

Install in the current worktree, then run format checking, lint, type checking,
unit tests and build. The exporter unit tests inspect the generated `.pptx`
package for native text, shapes, pictures, stacking, persistent `!!` names,
transition XML, warnings and failure behavior. Reference tests cover UTF-8,
invalid or oversized files, extraction bounds, failed reads without source
paths, prompt source labels and untrusted text in generation and repair.

```powershell
pnpm install --frozen-lockfile
pnpm format:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Run `export-references.spec.ts` against the built application after preparing a
fresh external `$komaVerifyOutput` and JSON report path as shown in `SKILL.md`:

```powershell
pnpm --filter @koma-motion/desktop exec playwright test export-references.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'
```

If the spec is absent, report that fact and do not claim export or reference
behavior was covered by it. Record the exact assertions and result.
Electron tests stub native dialogs, so they verify the app's IPC and file
handling after a choice, not the operating system's dialog UI.

For export, exercise the validation warnings, static/fade/Morph options,
automatic advance, cancellation, destination failure and preserving the
current `.koma` project. Inspect the actual output package for editable
objects and transition data; a successful IPC response alone is insufficient.

For references, attach TXT, Markdown and PDF fixtures through the mocked
native selection. Exercise PDF extraction through the disposable sandboxed
helper in the built application. Inspect clipped-text notices, remove a reference, replace
the project, and verify attachments are absent after replacement and from
saved `.koma` and exported `.pptx` files. Check that an external provider
requires fresh consent when the provider or attachment set changes. The mock
provider path verifies preparation and prompt construction without sending
content online. Assert that the provider prompt contains extracted text as
marked untrusted data with ordinal source labels, and excludes the local path,
filename and reference ID. A failed read must not return an OS error path.

Limits to exercise: five attached files, 10 MiB each, 20 MiB per selection, 40 PDF
pages, 100,000 extracted characters per file and 200,000 combined. UTF-8
decoding is strict and PDF extraction has a 15-second timeout. Corrupt or
image-only PDFs should fail with a useful message. A clipped reference should
be marked and reviewable before generation.

## Manual PowerPoint check on Windows

Automated package checks do not establish that PowerPoint accepts or plays a
deck. On Windows, open a newly generated three-slide fixture in PowerPoint.
Record the PowerPoint version, source revision, file hash and whether it opens
without repair. Confirm text is editable as text, move a native shape, save to
a _separate_ file, close, reopen and inspect the edits. Check the displayed
Morph/fade choice and transition and advance timings on the relevant slides.
Play Slide Show through the final slide. Preserve the generated file, edited
file and screenshots outside the checkout. Do not infer exact Koma motion or
font equality from a successful playback.

The 2026-10-01 Windows check used PowerPoint 16.0.20430.20092. Its local
evidence is in
`D:\Code\KomaMotion-evidence\export-references-20261001\powerpoint-worker`.
That fixture opened without repair; edits to text and a circle survived save
and reopen; slide 2 showed Morph 0.90 s and After 1.20 s, slide 3 showed Morph
1.20 s and click advance, and Slide Show reached the last slide. This is a
record of that fixture and version, not a substitute for a fresh check after
exporter changes. PowerPoint for macOS has not been verified.

## Evidence handoff

Report the exact revision and dirty status, platform, commands, passed and
skipped tests, the assertions actually exercised, fixture hashes and output
locations. Keep generated decks and screenshots outside the checkout, and do
not overwrite another run's Playwright output. Do not claim a test passed when
it was absent or skipped.
