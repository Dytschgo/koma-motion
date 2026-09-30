# Agent providers

## Visual Brand Kit analysis

The Brand Kit library has a separate deck-analysis request path. It uses the
registered Claude Code provider with `--model opus` and inline PNG content
blocks over `stream-json` stdin. It does not call presentation generation,
send the current project, or grant file/shell/network tools. Structured output
uses JSON Schema Draft 7, which the installed Claude Code 2.1.285 accepts;
the default Zod 2020-12 dialect was rejected in the live compatibility check.
See [Brand Kit from deck](BRAND_KIT_FROM_DECK.md) for the data flow and limits.

Koma Motion does not run AI models. It orchestrates agent programs that are
installed on the computer of the user and turns their structured output into
Komas.

The code lives in `packages/agent-runtime`. Everything that starts processes
is in `packages/agent-runtime/src/node` and runs in the Electron main process.

## Integration status

| Provider        | Id            | Detection           | Generation                           |
| --------------- | ------------- | ------------------- | ------------------------------------ |
| Mock provider   | `mock`        | verified            | verified, covered by automated tests |
| Claude Code CLI | `claude-code` | verified on Windows | verified on Windows                  |
| Codex CLI       | `codex`       | verified on Windows | **implemented, not verified**        |
| Grok CLI        | `grok`        | verified on Windows | verified on Windows                  |

What "verified" means here:

- **Help inspection** on Windows, 29 September 2026, for Claude Code 2.1.283
  (`claude --help`) and Codex CLI 0.157.1 (`codex exec --help` and
  `codex features list`). The argument lists below come from that inspection.
  Flags that were not in the help output are not used.
- **Claude Code** detection and generation were tested on 29 September 2026
  with Claude Code 2.1.283 on Windows 11, with the model `claude-opus-5-5`.
  A request for three Komas was run once through the runtime and once through
  the application. Both runs produced a valid presentation. Those two runs
  used the earlier invocation: without `--safe-mode`, `--restricted` and
  `--no-chrome`, and with the complete environment of the application.
- **Claude Code with the current invocation**, which includes those three
  flags and passes only the allowlisted environment variables, was run once
  through the runtime on the same day and computer. The run produced a valid
  presentation. On 30 September 2026, the current invocation was also run
  through the Electron application on Windows with Claude Code 2.1.285,
  using its existing sign-in and default model. It produced three Komas.
- Neither detection nor generation of Claude Code has been tested on macOS.
- **Codex CLI** detection was tested with Codex CLI 0.157.1 on Windows 11,
  including the resolution of the npm command shim. The arguments for
  generation, including every `--disable`, were taken from that help output
  and from `codex features list`. Generation has never been run against a
  real Codex installation, with or without those flags. Treat it as
  experimental. Two points are known to be open: whether the response schema
  is accepted by the structured output feature of Codex, and the behaviour
  on macOS.
- **Grok** help was inspected on Windows on 30 September 2026 with Grok
  1.0.44 (`grok --help`, `grok --version`). Flags that were not in that help
  output are not used. `--no-auto-update` is described in the installed
  headless guide and is accepted by this binary, but it is absent from
  `grok --help`, so the provider does not pass it. Detection and a headless
  call with a one-field schema and one three-Koma generation were run on the
  same computer. The account was already signed in with grok.com.
  `XAI_API_KEY` was not set. Both used the allowlisted child environment.
  The generation produced a valid presentation. Grok has not been tested on
  macOS.

## The AgentProvider interface

```ts
interface AgentProvider {
  readonly id: string;
  readonly displayName: string;
  readonly metadata: ProviderMetadata;

  detect(): Promise<ProviderDetectionResult>;

  generatePresentation(
    request: PresentationGenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult>;

  generateTransition(
    request: TransitionRegenerationRequest,
    context: AgentExecutionContext,
  ): Promise<ProviderExecutionResult>;
}
```

`AgentExecutionContext` contains the execution id, the attempt number, the
rendered prompt, the model, an `AbortSignal` and a function to report progress.

`generateTransition` regenerates one transition whose Komas changed after its
motion was made. The CLI providers only see the rendered prompt, so both
methods start the same process; only the prompt, the response schema and the
progress message differ. `GenerationRunner.executeTransition` runs it with
the same detection, cancellation, timeout, validation and single repair
attempt as a presentation.

### Transition regeneration

The request (`TransitionRegenerationRequest`,
`packages/agent-runtime/src/contract/transition.ts`) describes the two Komas
(position, title, purpose and a summary of their elements), the operations
the application derived from them, the current settings, the allowed
strategies and easings, the duration range and the project instructions. It
is built from the project as it is when the user asks, and only for a
transition between two neighbouring Komas that can be compared.

The response contains four values: `strategy`, `durationMs` (100 to
10,000), `easing` and a non-empty `rationale`. The provider cannot change
the Komas or the element operations: the renderer rebuilds the operations
from the current Komas with `buildTransition` and replaces only that
transition. It applies the answer only when neither Koma and none of the
transition's settings changed while the provider worked, compared by content
fingerprints (`fingerprintKoma`). Otherwise the answer is discarded and the
transition stays marked as out of date.

IPC channel: `koma:providers:regenerate-transition`, request
`{ executionId, providerId, project, transitionId }`. It is cancelled with
`koma:providers:cancel` and reports progress with `koma:providers:status`,
like a generation. The model is the one configured for the selected provider.

### Differences to the originally proposed interface

| Proposal                                      | Implementation                        | Reason                                                                                                                  |
| --------------------------------------------- | ------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `generatePresentation` returns a presentation | it returns **raw output**             | The runtime validates every provider in the same way. A provider cannot skip or weaken validation.                      |
| optional `cancel(executionId)`                | `AbortSignal` in the context          | Cancellation cannot be forgotten by a provider, and timeouts use the same mechanism. `GenerationRunner.cancel` remains. |
| no metadata                                   | `metadata` describes the provider     | The interface shows whether a provider sends data to an online service and whether it supports model selection.         |
| the provider builds its own prompt            | the prompt is rendered by the runtime | Prompts are versioned in one place and are the same for every provider.                                                 |

## Provider detection

`detect()` reports one of three states:

| Availability  | Meaning                                            |
| ------------- | -------------------------------------------------- |
| `available`   | the provider can be used; the version is reported  |
| `unavailable` | the program is not installed or not on the `PATH`  |
| `error`       | the program was found but did not answer correctly |

CLI providers are detected by resolving the executable and running it with
`--version`, with a time limit of 15 seconds. Detection uses the same
allowlisted environment as generation.

Executables are resolved without a shell:

- The folders of `PATH` are searched, plus common installation folders
  (`~/.local/bin`, on macOS and Linux also `~/.npm-global/bin`,
  `/opt/homebrew/bin` and `/usr/local/bin`). Applications started from the
  macOS Dock do not inherit the `PATH` of the login shell.
- On Windows, `<name>.exe` is preferred. npm installs command line tools as
  `<name>.cmd` files, which can only run through a shell. For those, Koma
  Motion reads the path of the script from the `.cmd` file and starts
  `node.exe` with that script. The script and the `node_modules` directory
  next to the `.cmd` file are canonicalised with `realpath`. The script must
  be strictly inside that directory: the relative path is non-empty, is not
  absolute and does not start with `..` (a `..` segment is rejected). A
  string prefix such as `node_modules_evil`, or a junction that resolves
  outside the directory, is rejected. If either `realpath` fails, the shim
  is rejected.

Discovery searches `PATH` and the extra directories above. The containment
check does not stop a hostile `PATH` entry from pointing at a different
install. It does not solve path hijacking.

A provider that is not available does not affect the rest of the application.
A provider whose detection throws is reported as `error`.

## Execution lifecycle

`GenerationRunner.execute` runs these phases and reports each of them as a
status event:

| Phase        | What happens                                                         |
| ------------ | -------------------------------------------------------------------- |
| `preparing`  | the request is validated                                             |
| `detecting`  | the provider is detected                                             |
| `generating` | the provider works                                                   |
| `validating` | the output is extracted and validated                                |
| `repairing`  | only after invalid output: the provider is asked to correct it, once |
| `converting` | the application computes the motion and builds the presentation      |

An execution ends in one of four states: `succeeded`, `failed`, `cancelled`
or `timedOut`.

The result of an execution is a complete presentation or an error, never
something in between. The renderer applies a successful result in one
undoable step. After a failure the presentation is exactly what it was.

### Cancellation

`GenerationRunner.cancel(executionId)` aborts the signal of the execution.
CLI providers then end the process and the processes it started. On Windows
that is `taskkill /T /F`. Elsewhere the process group is sent `SIGTERM`, and
after a short delay the group is checked with signal `0` and sent `SIGKILL`
if it still exists, even when the leader has already exited. That POSIX
behaviour was not retested on macOS. The runner does not wait for a provider
that ignores the signal.

The promise that runs a CLI process always resolves. A failure to start,
including a synchronous spawn failure such as a Windows command line that is
too long, a non-zero exit, cancellation and an output limit are all reported
on the result. The promise does not reject for those outcomes.

### Timeouts

Executions run until completion or manual cancellation by default. Settings can
opt into a deadline covering all attempts; `timeoutSeconds: null` disables it.
The optional timer accepts 10 through 2,147,483 whole seconds (the signed
32-bit JavaScript timer boundary, about 24.9 days). Disable it for longer runs.
The separate 15-second CLI **version probe** remains bounded; it is not a
generation deadline. Providers and their services may impose their own limits.

### Structured errors

| Code                  | Meaning                                                        |
| --------------------- | -------------------------------------------------------------- |
| `invalidRequest`      | the request did not pass validation                            |
| `providerNotFound`    | there is no provider with this id                              |
| `providerUnavailable` | the provider is not installed or not working                   |
| `executionFailed`     | the program could not be started or ended with an error        |
| `timedOut`            | the time limit was reached                                     |
| `cancelled`           | the user stopped the execution                                 |
| `outputTooLarge`      | the output is above the size limit                             |
| `noStructuredOutput`  | the output contains no JSON object                             |
| `invalidResponse`     | the output does not follow the contract; the issues are listed |
| `conversionFailed`    | the motion between the Komas could not be computed             |
| `internalError`       | an unexpected error                                            |

## Structured response contract

Agents answer with data. Koma Motion does not parse prose.

### Request

`PresentationGenerationRequest` contains:

- the request of the user, objective and audience (the chat sends neither
  objective nor audience; the agent infers them from the request),
- the Brand Kit as structured data, without image data,
- the requested number of Komas,
- a summary of the existing presentation, when there is one,
- the canvas size,
- the allowed element types, transition strategies, easings and operations,
- the assets that may be used, as id and name,
- no built-in Koma-count limit (`constraints.maxKomas: null`); a caller may
  explicitly supply a smaller count constraint,
- technical rendering budgets of 2,000 elements per Koma and 100,000 UTF-16
  code units per text element. User requests have a 1 MiB UTF-8 input budget.

See [the complete limit audit](GENERATION_LIMITS.md) for memory rationale,
recovery, retained metadata limits, and project compatibility.

### Response

```jsonc
{
  "presentation": { "title": "…", "objective": "…", "audience": "…", "narrative": "…" },
  "komas": [
    {
      "key": "system",
      "title": "…",
      "purpose": "…",
      "speakerNotes": "…",
      "backgroundColour": "#182033",
      "elements": [
        {
          "persistentId": "motion-engine",
          "name": "Motion engine",
          "type": "shape",
          "x": 1228,
          "y": 540,
          "width": 200,
          "height": 200,
          "rotation": 0,
          "opacity": 1,
          "zIndex": 6,
          "text": null,
          "fontRole": null,
          "fontSize": null,
          "fontWeight": null,
          "textAlign": null,
          "verticalAlign": null,
          "textColour": null,
          "shape": "circle",
          "cornerRadius": null,
          "fillColour": "#FF7A59",
          "strokeColour": null,
          "strokeWidth": null,
          "assetId": null,
        },
      ],
    },
  ],
  "transitions": [
    {
      "fromKoma": "system",
      "toKoma": "motion-engine",
      "strategy": "staged",
      "durationMs": 1600,
      "easing": "easeInOut",
      "rationale": "…",
    },
  ],
  "visualRationale": "…",
  "warnings": [],
}
```

Design decisions:

- **Flat, without optional properties.** A property that does not apply is
  `null`. This is easy to describe in a prompt and works with the structured
  output features of agent CLIs.
- **No element operations.** Agents suggest strategy, duration, easing and a
  rationale. The motion engine computes what happens to each object.
- **No paths, commands or code.** Images refer to asset ids from the request.
- **Fonts by role.** Agents choose `heading` or `body`. The font families come
  from the Brand Kit.
- **No groups.** Groups exist in the document model but are not offered to
  agents in this version.

The contract does not ask for private reasoning, and Koma Motion does not
display or store any. `rationale` and `visualRationale` are short texts that
are written for the user.

## Validation of agent output

All agent output is untrusted. It passes these steps, in this order:

1. **Size limit.** An 8 MiB UTF-8 response budget applies to both raw text
   and serialised structured output before choosing between them. Serialisation
   also stops on a coarse content budget while traversing an object, before
   building an arbitrarily large string. Invalid/circular values return
   `noStructuredOutput`; excess output returns `outputTooLarge` without repair.
   Combined CLI stdout and stderr stop at 32 MiB, allowing envelope overhead.
   Answer files are read in bounded chunks, at most 8 MiB plus one byte even
   if the file grows during reading. Partial responses are never accepted.
   Errors explain the memory boundary and suggest reducing detail or generating
   sections in separate projects. See [allocation rationale](GENERATION_LIMITS.md).
2. **Envelope.** A plain object from the provider (not `null` and not an
   array) is an explicit envelope and is preferred. It is accepted when the
   raw text is empty, when that text contains no JSON object, or when the
   object in the text is the same JSON value (no numeric tolerance, and keys
   inherited from a prototype do not count). If the text contains a different
   object, the result is `invalidResponse` with the issue `inconsistentOutput`.
   The two bodies are not merged, and the more permissive one is not chosen.
   That failure may be repaired once. When structured output is absent or is
   not a plain object, only the text is used.
3. **Extraction.** Text is parsed as data with `JSON.parse` and is never
   executed. If the trimmed text is one JSON object, that object is used.
   Otherwise one left-to-right scan records balanced `{...}` spans. Braces and
   escapes inside strings do not affect the scan, and an unmatched `{` does
   not hide a later object. Only outermost objects are parsed. An outermost
   object whose own `komas` property is an array is contract-shaped; that
   check only chooses a candidate. Exactly one contract-shaped object is used,
   so an earlier example such as `{}` is ignored. More than one contract-shaped
   object is `noStructuredOutput`: the response contains more than one
   possible answer and is not guessed. With none, exactly one parsed object is
   used, including fenced JSON and an object followed by prose. Several such
   objects are ambiguous and are rejected. An empty response, an array, or
   text with no JSON object is `noStructuredOutput`.
4. **Unsupported values.** Element types, strategies and easings that Koma
   Motion does not know are reported by name.
5. **Schema.** Types, ranges, lengths and patterns.
6. **Semantics.** Duplicate Koma keys, duplicate persistent ids in one Koma,
   transitions that refer to missing or non-adjacent Komas, element types
   that the request does not allow, missing content, assets that do not exist
   in the project, and the limits of the request.
7. **Conversion.** Defaults are applied, the motion engine computes the
   operations, and the resulting presentation is validated against the schema
   of the document model.

### Repair

When the output fails at step 2, 3, 4, 5 or 6, the provider is asked **once**
to correct it. The repair prompt contains the list of problems and the
rejected output. If the second output is also invalid, the execution fails
with the issues of the second attempt. There are never more than two
attempts. `outputTooLarge` stops the execution without a repair. Errors of
the program itself, such as a failed start, are not retried.

## Prompt templates

Prompts are versioned data in
`packages/agent-runtime/src/prompts/presentationGeneration.ts`. They are not
part of the user interface and not part of a provider.

| Template                  | Version | Purpose                                               |
| ------------------------- | ------- | ----------------------------------------------------- |
| `presentation-generation` | 2       | the first request                                     |
| `presentation-repair`     | 2       | the correction of a rejected response                 |
| `presentation-generation` | 1       | retained previous wording; the runner does not use it |
| `presentation-repair`     | 1       | retained previous wording; the runner does not use it |
| `transition-regeneration` | 1       | new settings for one transition                       |
| `transition-repair`       | 1       | the correction of a rejected transition response      |

The transition templates are in
`packages/agent-runtime/src/prompts/transitionRegeneration.ts`. All project
data in them, including titles, element names and text, is wrapped as
untrusted data.

Every template renders three parts:

- `system`: the role, the rules for persistent identity, layout and content,
- `user`: the request, the canvas, the Brand Kit as JSON, the allowed values,
  the available assets, the limits and the response schema,
- `responseJsonSchema`: the response contract as JSON Schema, generated from
  the same schema that validates the response.

From version 2, the Brand Kit JSON and the existing-presentation summary are
wrapped between `<<<UNTRUSTED_DATA>>>` and `<<<END_UNTRUSTED_DATA>>>`, with
one sentence that the text inside is data, not instructions. Those values
are imported project data. The person's own request stays outside the
delimiters and remains the instruction. The delimiters are prompt wording.
They are not a boundary, and they do not stop a model from following text
inside the data. Response validation is unchanged. Version 1 is still in
`presentationGeneration.ts` with the previous wording.

The template and version that were used are part of the diagnostics of every
execution. A change to the wording that can change results gets a new
version instead of an edit of an existing one.

## Logging and diagnostics

The application does not write log files. Diagnostics are shown with a failed
execution and contain:

- provider, start time and duration,
- the prompt template and its version,
- per attempt: exit code, length of the output and an excerpt of the error
  output of the program.

Error output is reduced before it is shown: values that look like API keys,
tokens, authorisation headers or password assignments are replaced, control
characters are removed, and the text is limited to 2000 characters. Pattern
redaction cannot guarantee removal of every secret, prompt or environment
value from arbitrary stderr.

Messages of unexpected errors are replaced by a neutral message, because they
can contain anything.

## Security boundaries

| Rule                                        | Implementation                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The renderer cannot start processes         | providers run in the main process; the renderer sends a provider id and the request                                                                                                                                                                                                                                                                        |
| No shell                                    | `spawn` with `shell: false`, an executable path and an argument array                                                                                                                                                                                                                                                                                      |
| The request of the user is not an argument  | Claude and Codex read the request, the Brand Kit and the project context from standard input. Grok does not read a prompt from standard input, so that text is written to a file Koma Motion creates in the temporary directory and the argument is that path. Claude and Grok receive the fixed system instructions and the response schema as arguments. |
| Arguments are controlled                    | all arguments are fixed, except the model name, which must match a restricted pattern                                                                                                                                                                                                                                                                      |
| The invocation limits what the agent can do | Claude: no tools, safe mode, restricted mode, Chrome disabled; managed settings still apply. Codex: read-only, which still allows reads; generation has not been run. Grok: no built-in tools, web search disabled, subagents disabled, plan mode disabled, permission mode `dontAsk`, sandbox profile `strict`.                                           |
| No project context for the agent            | the working directory is an empty temporary folder that is removed afterwards                                                                                                                                                                                                                                                                              |
| Output is data                              | output is parsed as JSON and validated; it is never executed                                                                                                                                                                                                                                                                                               |
| Output cannot name files                    | the response has no paths; asset ids are checked against the project                                                                                                                                                                                                                                                                                       |
| Executions end                              | time limit, cancellation and output limit                                                                                                                                                                                                                                                                                                                  |
| No credentials in Koma Motion               | Koma Motion stores and asks for no keys. Claude keeps its existing sign-in. Codex auth still uses `CODEX_HOME`. Grok keeps its existing sign-in under its own home directory, or `XAI_API_KEY` when the parent process already has it.                                                                                                                     |

### Child environment

CLI children do not inherit the application environment. Detection and
generation both pass an explicit environment, and `spawn` uses that object
alone. When a caller of `runProcess` omits `env`, the child still inherits,
so unrelated process calls do not change.

A name is copied only when the parent already has a string value:

- Windows and the process: `SystemRoot`, `SYSTEMROOT`, `windir`,
  `SystemDrive`, `PATH`, `Path`, `PATHEXT`, `COMSPEC`, `TEMP`, `TMP`,
  `USERPROFILE`, `HOMEDRIVE`, `HOMEPATH`, `HOME`, `APPDATA`, `LOCALAPPDATA`,
  `PROGRAMDATA`, `USERNAME`, `USERDOMAIN`, `LANG`, `LC_ALL`, `LC_CTYPE`.
- TLS and proxies, because corporate installs need them: `SSL_CERT_FILE`,
  `SSL_CERT_DIR`, `NODE_EXTRA_CA_CERTS`, `HTTP_PROXY`, `HTTPS_PROXY`,
  `NO_PROXY`, and the same names in lowercase.
- Auth named by the installed help or by this document: `ANTHROPIC_API_KEY`,
  `OPENAI_API_KEY`, `CODEX_HOME`, `XAI_API_KEY` and `GROK_HOME`.

No other `*_TOKEN` or `*_KEY` variables are copied. `CODEX_HOME` is not
repointed. On Windows, Node keeps one spelling of a case-insensitive name,
and the platform also adds `LOGONSERVER`. That name is not on the allowlist
and cannot be removed by it.

### Verified arguments

Help was inspected on Windows on 29 September 2026: Claude Code 2.1.283 and
Codex CLI 0.157.1.

**Claude Code:**

```text
claude --print --output-format json --input-format text
       --tools "" --strict-mcp-config --disable-slash-commands
       --permission-prompts none --no-session-persistence
       --safe-mode --restricted --no-chrome
       [--model <model>] --system-prompt <text> --json-schema <schema>
```

The request is read from standard input. The system instructions and the
response schema are arguments: both are fixed text of Koma Motion and contain
nothing the user or a project wrote. The output is one JSON object. Koma
Motion passes `result` and `structured_output` to validation, which rejects
the output when the two disagree, and reports an error when `is_error` is
true.

`--bare` is not used. Its help text says Anthropic auth is strictly
`ANTHROPIC_API_KEY` or `apiKeyHelper` via `--settings`, and that OAuth and
the keychain are never read. Passing it would drop the existing sign-in.
`--setting-sources` is not passed either: the help text does not offer an
empty value, and `--safe-mode` and `--restricted` already cover user,
project and local settings.

`--safe-mode` starts with customizations disabled. Admin-managed policy
settings still apply. `--restricted` removes built-in tools that run
commands or code, and WebFetch, unless `--tools` names them. `--tools ""`
names none. It also ignores user, project and local settings files.
`--no-chrome` disables Claude in Chrome. Managed policy settings cannot be
turned off by these flags.

Claude keeps its existing sign-in. `ANTHROPIC_API_KEY` is passed through
only when the parent process already has it, because the `--bare` help text
names that variable. Koma Motion does not store keys.

**Codex CLI** (from help and `codex features list`, not run as a generation):

```text
codex exec --sandbox read-only --skip-git-repo-check --ephemeral
           --color never --ignore-user-config --ignore-rules
           --disable hooks --disable plugins --disable plugin_sharing
           --disable remote_plugin --disable browser_use
           --disable browser_use_external --disable browser_use_full_cdp_access
           --disable computer_use --disable shell_tool
           [--model <model>] --cd <temporary folder>
           --output-schema <temporary folder>/response-schema.json
           --output-last-message <temporary folder>/answer.json -
```

The final `-` reads the prompt from standard input. Koma Motion creates both
file paths itself and reads the answer from `answer.json`.

`--ignore-user-config` does not load `$CODEX_HOME/config.toml`. Auth still
uses `CODEX_HOME`. `--ignore-rules` does not load user or project execpolicy
`.rules` files. `--disable` is an invocation override (`-c features.<name>=false`).
It is not `codex features disable`, which would write `config.toml` and is
never called. The disabled features are the stable, enabled features from
`codex features list` that grant extra capability: `hooks`, `plugins`,
`plugin_sharing`, `remote_plugin`, `browser_use`, `browser_use_external`,
`browser_use_full_cdp_access`, `computer_use` and `shell_tool`. Disabling
`shell_tool` is the supported control that turns off the shell tool. There
is no verified flag that means no filesystem access. `--sandbox read-only`
still allows reads.

MCP servers normally come from `config.toml`, which `--ignore-user-config`
skips. MCP servers or plugins configured outside that file are not covered
by a stronger verified switch. `CODEX_HOME` is not pointed at a sandbox.

`OPENAI_API_KEY` and `CODEX_HOME` are passed through only when the parent
already has them, so API-key auth and the existing auth files still work.
Koma Motion does not store keys. Generation with this combination was not
executed. The arguments come from help plus `features list`, not from a live
run.

**Grok** (help of Grok 1.0.44 on Windows, 30 September 2026, then run):

```text
grok --prompt-file <temporary folder>/prompt.txt
     --output-format json
     --json-schema <schema>
     --verbatim
     --tools ""
     --disable-web-search
     --no-subagents
     --no-plan
     --permission-mode dontAsk
     --sandbox strict
     --cwd <temporary folder>
     [--model <model>]
     --system-prompt-override <text>
```

The request is the contents of `prompt.txt`. Koma Motion creates that file.
It contains the user's request, project instructions, the Brand Kit, a text
summary of existing Komas, asset ids and names, and the response schema.
Standard input is empty. `--json-schema` is the response contract as one
JSON argument. On this version it implies `--output-format json`. The
printed object has `text` and, when the schema is used, `structuredOutput`.
Koma Motion passes both to validation and does not read `thought`. An object
`{"type":"error","message":"..."}` is a provider error. That error shape is
the one described by the installed headless guide. It was not produced by
the successful calls below.

`grok models` on this installation reported a grok.com sign-in and these
model ids: `grok-4.7` (default), `grok-4.7-build-fast`, `grok-4.6` and
`grok-4.5`. The provider does not store that list. An empty model uses the
CLI default. A model name is passed only when it matches the restricted
model pattern. `--model grok-4.7` was accepted in a separate call. The
`modelUsage` key of that call was `grok-4.7-build`.

The argument list above was run once with a one-field schema, no `--model`,
the allowlisted environment and the existing sign-in. `XAI_API_KEY` was not
set. The process exited 0, printed no standard error, and returned
`{"ok": true}` in both `text` and `structuredOutput`, with `stopReason`
`end_turn` and `num_turns` 1. `--model grok-4.7` was accepted in a separate
call that also passed `--sandbox strict`, `--max-turns 1` and
`--no-auto-update`. That call likewise exited 0. `--max-turns` is not used:
it was only tried with the one-field schema, and the installed guide
describes structured-output retries. The presentation schema is larger than
the one-field schema and fits in one argument.

On 30 September 2026 the argument list above, with no `--model`, generated
a presentation through `GenerationRunner` on Windows. Grok 1.0.44 used the
existing grok.com sign-in and the allowlisted environment. `XAI_API_KEY`
was not set. The process exited 0 after 420 seconds, with empty standard
error. The first response was valid, so there was no repair. It produced
three Komas and retained motion between them. Diagnostics recorded the
prompt template `presentation-generation@3`, which is the template the
runner used for that run.

Grok writes a session. `grok --help` has no flag that disables session
persistence, and the successful JSON included a `sessionId`. The transcript
is stored by the CLI under `~/.grok/sessions`, or under `$GROK_HOME` when
that variable is already set. Koma Motion does not copy or delete those
files.

`--tools ""` allowlists no built-in tools. The installed headless guide says
MCP meta-tools can remain unless they are denied. This installation had no
`mcp.json`. `--permission-mode dontAsk` does not prompt, and the installed
permissions guide says tools outside the built-in read-only set are not
run in that mode. MCP was not given a separate live test. User config in
`~/.grok/config.toml` is still loaded. There is no verified flag that skips
it. The permissions guide says a CLI permission mode overrides the config
mode for that process.

`--sandbox strict` is the most restrictive profile in the installed sandbox
guide. That guide's platform table lists Linux and macOS, not Windows. The
Windows calls, including the presentation run, passed the flag, exited 0,
and printed no sandbox message. That does not prove the profile was
enforced.

`XAI_API_KEY` and `GROK_HOME` are copied only when the parent process
already has them. Koma Motion does not store keys and has no API-key
setting. Sign in with `grok login`, or `grok login --device-auth` on a
machine without a browser. Install on Windows with:

```powershell
irm https://x.ai/cli/install.ps1 | iex
```

On macOS or Linux the installed getting-started guide uses
`curl -fsSL https://x.ai/cli/install.sh | bash`. Those installers were not
run as part of this verification. The provider looks up `grok` on `PATH`
and in the usual installation directories, including `%USERPROFILE%\.grok\bin`
on Windows.

### Remaining trust

- Admin-managed Claude settings still apply. Managed policy settings cannot
  be disabled by the flags above.
- Codex read-only is not "no filesystem access".
- Codex generation was not run. The Codex argument list is unverified against
  a real generation.
- Grok session transcripts stay in the CLI's own data directory. User Grok
  config and hooks still load. Sandbox enforcement on Windows is not
  established. MCP meta-tools were not given a separate test.
- Prompt wording, including the untrusted-data delimiters, is not a boundary.
- `PATH` discovery still trusts the local install locations on `PATH` and the
  extra installation folders searched beside it. The child receives that
  `PATH` when the parent has it.
- On Windows, a custom environment still receives `LOGONSERVER` from the
  platform.

## MockAgentProvider

The mock provider needs no AI service, no network and no API key. The whole
application can be used with it.

- It is deterministic: the same request and Brand Kit produce the same output,
  and the application derives the identifiers from the request, so the
  resulting presentation is identical as well.
- It always creates the same story with three Komas and reports a warning when
  another number was requested.
- It pretends to work for 1.2 seconds and reports three progress messages, so
  that progress and cancellation can be seen.
- Its output passes through the same validation as the output of every other
  provider.
- To regenerate a transition, it keeps the current strategy, duration and
  easing and writes a rationale that counts the objects that change, enter
  and leave. It pretends to work for 1.2 seconds as well.

The story:

| Koma | Title                | What it shows                                                                 |
| ---- | -------------------- | ----------------------------------------------------------------------------- |
| 1    | One connected system | five connected components, the motion engine as a small circle                |
| 2    | The motion engine    | the circle moves to the centre and grows, the other components step back      |
| 3    | Motion you can edit  | the circle moves aside, the output grows into a Koma, supporting points enter |

It contains moved, scaled, entering, exiting, replaced and unchanged objects
in the colours of the Brand Kit, and a rationale for both transitions.

## Adding a provider

1. Create a class that implements `AgentProvider`. For a CLI, use
   `CliEnvironment` from `src/node/cliEnvironment.ts` for detection and for
   starting the process, and pass `childEnvironment()` as `env`, so that the
   rules above apply.
2. Read the help output of the CLI and run it before you write the
   invocation. Do not assume flags. Document the verified arguments here.
3. Start the agent with the fewest capabilities it can work with.
4. Return the raw output. Do not parse or validate it in the provider.
5. Add tests with a replaced `CliEnvironment`. See
   `src/node/node.test.ts`.
6. Register the provider in
   `apps/desktop/src/main/ipc/registerHandlers.ts`.
7. State in this document what was verified, with version and platform.

## Live tests

Tests against installed CLIs are skipped unless they are requested, because
generation uses the account of the person who runs them.

```sh
# Detection of Claude Code, Codex and Grok. Uses no model. Each CLI must be installed.
KOMA_LIVE_DETECTION=1 pnpm vitest run packages/agent-runtime/src/node/live.test.ts

# One generation with Claude Code through the runtime.
KOMA_LIVE_GENERATION=claude-code KOMA_LIVE_MODEL=claude-opus-5-5 \
  pnpm vitest run packages/agent-runtime/src/node/live.test.ts

# One generation with Grok through the runtime. Leave the model unset for the CLI default.
KOMA_LIVE_GENERATION=grok pnpm vitest run packages/agent-runtime/src/node/live.test.ts

# One generation with Claude Code through the application.
KOMA_LIVE_E2E=claude-code pnpm test:e2e -- live.spec.ts
```

Build first with `pnpm build`. Leave `KOMA_LIVE_MODEL` unset to use the CLI's
default model, or set it to a model your account supports. Installation
detection checks the executable and version; it does not check sign-in.

The Electron test sends a fictional cafe launch brief. It sets the project's
time limit to 600 seconds, checks visible generated text in each Koma, edits
text, undoes and redoes the edit, saves and reopens the edited project, and
plays both transitions. It also checks for renderer errors. Native Open and
Save dialogs are stubbed, but the project files are written and read by the
application.

For observation, the test sets each preview to two seconds in the reopened
copy without saving that change. Both evidence projects keep their original
generated transition durations.

It preserves the generated `claude-code.koma`, a separate
`claude-code-edited.koma`, screenshots and `verification.json` in
`apps/desktop/test-results/live`. Playwright clears its test-results folder
on the next run. Set `KOMA_LIVE_OUTPUT_DIR` to a fresh absolute directory
outside that folder to retain the files across runs. Use a different
directory for each run; the test uses fixed filenames within it.

On Windows, run this separately from the mock verification workflow:

```powershell
$env:KOMA_LIVE_E2E = 'claude-code'
$komaLiveEvidence = Join-Path $env:TEMP ('koma-live-' + [guid]::NewGuid().ToString('N'))
$env:KOMA_LIVE_OUTPUT_DIR = $komaLiveEvidence
try {
  pnpm test:e2e -- live.spec.ts
} finally {
  Write-Host "Live generation evidence: $komaLiveEvidence"
  Remove-Item Env:KOMA_LIVE_E2E, Env:KOMA_LIVE_OUTPUT_DIR -ErrorAction SilentlyContinue
}
```

Open `claude-code.koma` in Koma Motion to test the original result. The edited
copy demonstrates persistence. These are editable Koma projects; PowerPoint
export is not implemented.

Generation and repair prompt version 4 retain project instructions and imported-data
separation, remove the product Koma-count rule, and label a shortened repair excerpt
as incomplete. The full corrected response must pass validation again.
