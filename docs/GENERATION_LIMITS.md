# Generation and project safety boundaries

Koma Motion has no subscription quota, built-in presentation length, or default
generation deadline. A requested count is a positive safe integer or `null`
(let the agent choose). Limits below protect specific resources; they do not
promise that every possible presentation fitting them renders at interactive speed.

## Audit and classification

| Limit / location                                                                                                                     | Decision                                                                  | Reason and recovery                                                                                                                                                                                                                                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MAX_REQUESTED_KOMAS` (12), request schema, response Koma/transition arrays                                                          | Removed                                                                   | Arbitrary presentation-size rule. Numeric input, prompt v4, semantic validation, conversion and IPC accept larger decks. An explicit caller-supplied `constraints.maxKomas` remains possible; the app uses `null`.                                                                                                                    |
| `MAX_KOMAS` (200), project presentation/transition arrays, insert/add/copy commands and strip                                        | Removed                                                                   | Arbitrary project-size rule. File bytes and schema validity govern saving, not Koma count. Add stays available and is undoable.                                                                                                                                                                                                       |
| `MAX_USER_REQUEST_LENGTH` (4,000), textarea and generation history                                                                   | Removed; input uses 1 MiB UTF-8 safety budget                             | Long briefs are ordinary work. A 1 MiB text budget admits hundreds of pages while bounding repeated renderer/IPC/prompt copies (at most about 2 MiB per UTF-16 copy, before JSON escaping). Oversize input is rejected with editable text retained. History no longer truncates requests; the full project byte budget still applies. |
| `MAX_AGENT_ELEMENTS_PER_KOMA` (40), core per-Koma elements (200)                                                                     | Raised to 2,000 top-level elements                                        | Each visible element adds layout/paint work; transitions can render both endpoints. This admits dense diagrams while bounding one frame to thousands of DOM/SVG element trees. Split denser material across Komas.                                                                                                                    |
| `MAX_AGENT_TEXT_LENGTH` (600), response/core text (5,000), Inspector textarea                                                        | Raised consistently to 100,000 UTF-16 code units                          | One text element can now hold substantial content. A single paragraph still has a finite browser shaping/layout cost (at most 200 KiB of UTF-16 text before renderer copies). Split exceptionally large text across elements/Komas.                                                                                                   |
| Group children (200), one level only                                                                                                 | Retained                                                                  | Bounds nested render-tree expansion; agents still cannot emit groups. Existing valid group-heavy projects remain valid; no stricter combined child-count rule is introduced.                                                                                                                                                          |
| Per-transition element operations (2,000)                                                                                            | Raised to 16,000                                                          | The 2,000-element budget needs room for multiple property changes per object, or disjoint source/target objects. Eight operations per maximum-size Koma provides headroom without removing the animation-work bound.                                                                                                                  |
| Runner default (300 seconds), project/UI maximum (900 seconds)                                                                       | Removed as product deadlines                                              | Default is `null`. Runs finish or are manually cancelled. Optional deadlines remain as an explicit runaway-process fallback.                                                                                                                                                                                                          |
| Optional deadline minimum (10 seconds), maximum                                                                                      | Minimum retained; maximum raised to 2,147,483 whole seconds               | Very short UI deadlines would terminate normal provider setup. The maximum is the JavaScript signed-32-bit timer boundary; larger timer delays can overflow into immediate execution. Disable the optional timer for longer runs. Direct runner deadlines are validated as positive integer milliseconds at most 2,147,483,647.       |
| CLI version probe (15 seconds; 64 KiB output)                                                                                        | Retained                                                                  | Detecting an executable must finish without hanging provider selection or collecting unlimited version output. This probe does not limit generation.                                                                                                                                                                                  |
| `MAX_AGENT_OUTPUT_LENGTH` (512 KiB characters)                                                                                       | Replaced with 8 MiB UTF-8 response boundary; compatibility alias retained | Larger presentations readily exceed 512 KiB. Extraction, structured output and Codex answer files share the byte boundary. An oversize answer fails with `outputTooLarge`; no partial deck or repair of truncated JSON is applied. Reduce detail or generate sections in separate projects.                                           |
| CLI combined stdout/stderr (8 MiB)                                                                                                   | Raised to 32 MiB                                                          | Allows duplicated structured/text envelopes and JSON escaping around an 8 MiB answer. Output buffers stop growing when the ceiling is crossed and the child process tree is terminated. Provider error envelopes cannot override this result.                                                                                         |
| `MAX_ARGUMENT_LENGTH` (24,000 code units), Windows quoted command line (32,767)                                                      | Retained                                                                  | OS/process launch safety. User content travels on stdin or a generated prompt-file path, so longer requests do not consume command-line space. Fixed system/schema arguments and model validation remain bounded; unsafe/NUL arguments are rejected.                                                                                  |
| Project file (64 MiB UTF-8), one concurrent file operation                                                                           | Retained                                                                  | JSON parsing, schema cloning, serialisation and IPC temporarily hold several copies. Asset bytes and unknown extensions count too. Read loops enforce the budget even if files grow after stat; oversized saves preserve the existing file. Reduce embedded images or split the project.                                              |
| Embedded image (2 MiB bytes / corresponding base64 characters), project assets (500)                                                 | Retained                                                                  | Base64 and IPC copies enlarge images; independent image resources add decode/cache overhead. Allowed image signatures/media types, safe relative asset paths and existing asset references remain checked. Resize/compress images or remove unused assets. This byte budget is not a decoded-pixel guarantee.                         |
| Generation history (200 entries), undo history (100 steps)                                                                           | Retained                                                                  | Bounds retained document/request history; neither limits active presentation size or execution duration. Undo uses shared immutable objects, but repeated whole-deck generations can still retain substantial memory.                                                                                                                 |
| Project instructions (8,000); template library (100 templates / existing file budget)                                                | Retained                                                                  | Separate, bounded reusable guidance and template storage from the instruction work already in this checkout. Long task briefs belong in the request. Their validation/draft-preservation workflow remains intact.                                                                                                                     |
| Metadata fields and warning arrays (below)                                                                                           | Retained                                                                  | Keep labels, summaries and diagnostics compact and compatible across agent, core, UI and stored history. These fields are not presentation body text.                                                                                                                                                                                 |
| Geometry, IDs, types and reference checks                                                                                            | Retained                                                                  | Data integrity and rendering safety. Counts/lengths do not bypass positive dimensions, finite numeric ranges, unique identities, adjacent transitions, supported types, or allowed asset IDs.                                                                                                                                         |
| Extension JSON: depth 32, 10,000 nodes/property, 1,000 keys/object, 256-character keys                                               | Retained                                                                  | Bounds traversal, recursion and future/unknown data while preserving valid extensions. Invalid or oversized data is rejected, never silently discarded to make a file fit.                                                                                                                                                            |
| Repair: one retry, 60,000-character previous-output excerpt, 30 reported issues                                                      | Retained                                                                  | Prevents retry loops and limits repeated provider context. Prompt v4 explicitly labels shortened excerpts as incomplete and requests the complete response. Every repaired answer is fully revalidated.                                                                                                                               |
| Existing-presentation summary: first 200 text characters per element                                                                 | Retained                                                                  | Bounded contextual summary only; does not modify stored text or generated output. The full request and all Komas/element identities are sent.                                                                                                                                                                                         |
| Diagnostics: 64 KiB scan window, normally 2,000 display characters; history summary 400 characters / 50 warnings of 1,000 characters | Retained                                                                  | Bounds secret scanning and diagnostic display. These excerpts are not structured presentation data and are never parsed as a complete response.                                                                                                                                                                                       |

Metadata bounds retained: presentation/Koma titles 300; objectives/purposes 2,000;
audience 1,000; narrative 10,000; speaker notes 20,000; element names/font family
120; image alt text 500; transition rationale 1,000; visual rationale 2,000;
agent warnings 20 strings of 500. Stored history permits 100 warnings of 1,000
and a 2,000-character summary. Project name is 200; asset names/paths 260,
metadata keys 100 and metadata string values 1,000. Brand Kit retains its name
(120), short style fields (1,000), preferred topics (30 strings of 120), and
reference notes (5,000). Provider/model identifiers retain safe alphabets and
40/80-character bounds. These are field-shape/metadata constraints, not deck quotas.

Geometry retains coordinates/dimensions within 20,000 logical units, positive
extents, rotation ±3,600, opacity 0–1, z-index ±10,000, font sizes 1–2,000,
weights 100–900, line height 0.5–4, stroke width 0–1,000 and radius 0–10,000.
Agent transition durations are accepted up to 600,000 ms and normalised to the
existing 100–10,000 ms playback range. This affects animation, not generation time.

## Allocation rationale and failure behavior

The 8 MiB answer budget is sixteen times the previous ASCII response allowance.
It bounds the raw response (up to roughly 16 MiB of UTF-16 storage), before parsed
objects, schema clones and conversion are added. The 32 MiB process stream budget
allows outer-envelope overhead and caps combined captured buffers. Concatenation
and UTF-8 decoding temporarily add copies; these are ceilings, not measured peak
RSS guarantees. Structured-object serialisation stops while traversing when its
coarse content budget is exceeded, then checks the exact UTF-8 length; JSON escaping
can temporarily expand that coarse budget by up to six times. Only one generation
runs in the desktop application at a time. Increasing these ceilings again should
include heap/working-set measurements with representative dense decks.

Provider/process failures, oversize output, invalid geometry/IDs/references and
conversion errors leave the current presentation untouched. The generated project
is checked against the whole-project budget before a successful proposal is returned.
Output is never silently shortened to fit. The user can retry with less detail or
separate projects; there is no automatic append-sections feature. Save errors keep
the working document available and do not overwrite the existing file.

## Compatibility

Format 3 is necessary because older readers reject both larger decks and a nullable
timeout. Versions 1 and 2 migrate in order; version 1 still gets empty active
instructions, preserving the instruction migration. Version 2 disables the old
mandatory timeout, reports that change on open, and keeps provider/model settings,
project guidance and content. Saved format-3 projects preserve an explicitly enabled
timeout. Older apps require an upgrade to read format 3. The sample legacy projects
remain legacy fixtures rather than being rewritten.

## Performance and verification

On Windows, the Electron fixture with two elements per Koma measured:

| Komas |   Open | Select last | Copy/add |   Save |
| ----- | -----: | ----------: | -------: | -----: |
| 250   | 260 ms |       74 ms |    88 ms | 136 ms |
| 1,000 | 479 ms |      172 ms |   293 ms | 353 ms |

These are single local runs including automation overhead, not benchmarks or dense
image-deck guarantees. Reproduce with `pnpm build`, then
`pnpm --filter @koma-motion/desktop exec playwright test koma-limit.spec.ts`.
The test also reorders, undoes/redoes, saves/reopens and verifies the larger input
and optional-deadline controls. No virtualization was added: this fixture remains
responsive. The strip still mounts all thumbnails and searches transitions for each
Koma; rerendering and full-project validation/serialisation will grow with content.
Transition lookups can become quadratic as both arrays grow. These are reproducible
scaling paths to profile if larger/dense decks become slow, not a claim that every
operation is constant-time or that arbitrary-size decks fit in memory.

Focused tests exercise 250 generated Komas, 65 elements in one Koma, text over 5,000
characters, requests over 4,000 characters, responses over 512 KiB, exact/oversize
UTF-8 boundaries, malformed inputs, IDs/geometry, file save/reopen, format migration,
and timer overflow. A mock with fake timers remains active at 16 minutes, completes
at 30 minutes, or cancels immediately with no timer left. This tests the runner and
mock lifecycle without a 30-minute wall-clock wait. Existing child-process tests
exercise cancellation and output termination; live-provider tests remain opt-in.

Final checks on 30 September 2026, Windows, local changes on
`37174f7d4bb7576e22069f7b8e6106aadfd9b2f6`:

- Frozen-lockfile install, format check, lint, typecheck, build and `git diff --check`: passed.
- `pnpm test`: 631 unit tests passed, 5 skipped; all 13 script tests passed.
- Electron: all 19 tests in `koma-limit.spec.ts`, `workflow.spec.ts`,
  `canvas-editing.spec.ts`, and `instructions.spec.ts` passed against the final build.
- Live-provider detection/generation remained disabled; POSIX-only cases were not
  run on Windows. Native file dialogs were stubbed, but IPC and file reads/writes
  were real. No macOS or live-provider generation performance claim is made.
- Screenshots and traces were copied outside the checkout before each subsequent
  Electron run. The final screenshots use the default 1464 × 855 content window;
  reduced-motion preference was not overridden by these tests.
