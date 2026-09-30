# Create a Brand Kit from a presentation

Open **Brand Kit → Library → Create Brand Kit from deck**. Choose a local
PPTX or PDF, inspect the prepared slide previews, then choose **Send selected
content and analyze**. The workflow uses the connected Claude Code provider
and its `opus` alias. Review the evidence, edit any field, give the kit a
library name, and choose **Save new Brand Kit**.

Saving adds a library item. It does not change the open project. Select the
saved kit and choose **Apply to this project** afterward; that action uses
the existing project history and asset-copy flow and can be undone.

## Requirements and supported files

- PDF processing is bundled, using PDF.js 6.3.289 in a separate sandboxed
  Electron renderer. No PDF service or separate PDF application is needed.
- PPTX needs a local LibreOffice installation. Standard Windows and macOS
  installation locations are detected. For a portable installation, set
  `KOMA_LIBREOFFICE_EXECUTABLE` to its absolute executable path before
  launching Koma Motion. This is local application configuration; neither
  the renderer nor the agent can choose an executable.
- Use an up-to-date Claude Code installation with an existing sign-in.
  The input path was exercised with Claude Code 2.1.285 on Windows. CLI
  detection checks the version; a successful analysis also requires valid
  authentication and access to Opus.
- Maximum input size: 32 MiB. Maximum pages: 200. Up to 20 evenly spaced
  slides, including the first and last, are prepared. The exact numbers are
  shown before analysis and saved in the kit's provenance. Unselected slides
  are not analyzed; this is a sample, not an exhaustive deck review.
- Each selected slide is rendered within 1280 × 720 pixels and contributes
  at most 20,000 extracted text characters. There is no OCR pass. The image
  remains available to Opus when text extraction finds nothing.

Password-protected/encrypted documents cannot be processed. Export an
unprotected copy. PPTX files with macros, embedded objects, active content,
external relationships (including hyperlinks or linked images), unsupported
media, or malformed archive structures are rejected. Export a self-contained
static PDF instead. The original file is never modified.

LibreOffice can substitute missing fonts and change some PowerPoint effects.
Inspect the prepared previews before analysis. Exact typefaces may remain
uncertain, especially in PDF files; reference notes should explain this.

## What leaves the computer

Selection and preparation are local. Nothing is sent to an agent until the
user presses **Send selected content and analyze**. That action sends the
listed slides' extracted text and PNG previews, plus the listed extracted
logo candidates, to Anthropic through the existing Claude Code authentication.
The dialog identifies Claude Code and Opus immediately before this action.

The original deck, original path, current project, unrelated files, and
unrelated project assets are not included in the request. No new service,
API credential store, or credential setup is introduced. Claude Code controls
its own authentication and may use an existing API-key environment value
instead of its subscription sign-in, as it does for other Koma requests.

Images travel as base64 content blocks over stdin, using
`--input-format stream-json --output-format stream-json`. They are not
filesystem references. The invocation disables built-in tools, MCP servers,
skills, customizations, Chrome integration, and session persistence. It
uses an empty working directory, restricted mode, and no permission prompts.
Nonessential CLI traffic and official marketplace auto-install are disabled
for this child process. No unrestricted file, shell, or network tools are
granted to the model. Admin-managed CLI policies still apply.

See Anthropic's [streaming image input contract](https://code.claude.com/docs/en/agent-sdk/streaming-vs-single-mode),
[CLI reference](https://code.claude.com/docs/en/cli-reference), and
[environment variables](https://code.claude.com/docs/en/env-vars).

## Review, confidence, logos, and provenance

The proposal is validated against the existing Brand Kit field limits plus a
strict analysis schema. It includes observations, slide references,
confidence, and warnings. References outside the selected sample and unknown
logo IDs are rejected. Low-confidence findings require uncertainty notes.
Every Brand Kit field can be edited before saving.

Only bounded, decoded, re-encoded whole PNG images recurring in a PPTX are
offered as candidates. The agent can nominate one, but it is saved only if
the user confirms that it is the logo. The workflow never crops a slide to
invent a logo. PDF logo extraction and vector/JPEG logo candidates are not
implemented; those kits can be saved without a logo.

The kit stores the source filename, analysis date, provider/model alias,
selected slide numbers, and total slide count. It does not store the deck,
original path, previews, or extracted text. A confirmed logo uses the
existing hash-named Brand Kit library asset store. Saving always creates a
new kit; it never replaces an existing one in this workflow.

## Failure and cancellation

Cancel closes the analysis and discards late replies. Switching project or
leaving the library also discards the draft. Provider timeout, invalid output,
unsafe input, or rendering failure does not save a partial kit. A library
write failure keeps the reviewed draft open for retry.

Temporary files use an isolated directory. Preparation removes it on success,
failure, or cancellation; normal app shutdown waits for cancellation and
cleanup. Prepared images and text then live only in the draft's memory until
it is saved or closed. As with other local applications, an OS crash or forced
termination cannot guarantee completion of cleanup.

PPTX preflight limits archives to 5,000 members, 128 MiB expanded, 16 MiB per
member, 2 MiB per XML part, and bounded compression ratios and nesting. CRCs
and internal references are checked; no archive paths are extracted. Local
conversion has a 60-second deadline and a monitored 128 MiB temporary-storage
budget (checked every 200 ms, not an OS filesystem quota). PDF rendering has a
90-second deadline and rejects images over 16 million pixels. The sandboxed
rendering window can be destroyed without terminating the project window.
Analysis has a three-minute deadline, bounded request/output sizes, and no
automatic partial-save or text-only fallback.

## Verification coverage

Windows is the locally exercised platform. The implementation has no Windows-only
PDF processing dependency and includes macOS LibreOffice discovery, but macOS
rendering, LibreOffice conversion, packaging, and live CLI input remain
unverified. Do not treat Windows mock tests as proof of those paths.

The unpackaged development build also offers a clearly labelled local mock
provider for workflow testing. It returns a demonstration proposal, not
inferred visual identity. Packaged builds do not offer or accept that provider
for deck analysis.
