# Agent providers

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

What "verified" means here:

- **Claude Code** was tested on 29 September 2026 with Claude Code 2.1.283 on
  Windows 11, with the model `claude-opus-5-5`. A request for three Komas was
  run once through the runtime and once through the application. Both runs
  produced a valid presentation. Neither detection nor generation has been
  tested on macOS.
- **Codex CLI** detection was tested with Codex CLI 0.157.1 on Windows 11,
  including the resolution of the npm command shim. The arguments for
  generation were taken from the help output of that version. Generation has
  never been run against a real Codex installation. Treat it as experimental.
  Two points are known to be open: whether the response schema is accepted by
  the structured output feature of Codex, and the behaviour on macOS.

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
}
```

`AgentExecutionContext` contains the execution id, the attempt number, the
rendered prompt, the model, an `AbortSignal` and a function to report progress.

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
`--version`, with a time limit of 15 seconds.

Executables are resolved without a shell:

- The folders of `PATH` are searched, plus common installation folders
  (`~/.local/bin`, on macOS and Linux also `~/.npm-global/bin`,
  `/opt/homebrew/bin` and `/usr/local/bin`). Applications started from the
  macOS Dock do not inherit the `PATH` of the login shell.
- On Windows, `<name>.exe` is preferred. npm installs command line tools as
  `<name>.cmd` files, which can only run through a shell. For those, Koma
  Motion reads the path of the script from the `.cmd` file and starts
  `node.exe` with that script. The script must be inside the `node_modules`
  folder next to the `.cmd` file.

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
CLI providers then end the process and the processes it started
(`taskkill /T /F` on Windows, a signal to the process group elsewhere). The
runner does not wait for a provider that ignores the signal.

### Timeouts

Every execution has a time limit that covers all attempts. The default is 300
seconds. It is stored in the project and can be set between 10 and 900
seconds in the settings.

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

- the request of the user, objective and audience,
- the Brand Kit as structured data, without image data,
- the requested number of Komas,
- a summary of the existing presentation, when there is one,
- the canvas size,
- the allowed element types, transition strategies, easings and operations,
- the assets that may be used, as id and name,
- limits: at most 12 Komas, 40 elements per Koma and 600 characters per text.

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

1. **Size limit.** Output above 512 000 characters is rejected. The output of
   a CLI is limited to 8 MB while it is being read, and the process is ended
   when it produces more.
2. **Extraction.** Accepted are a JSON object, a JSON object in a Markdown
   code block, and a JSON object surrounded by text. The text is parsed with
   `JSON.parse`. Nothing is evaluated.
3. **Unsupported values.** Element types, strategies and easings that Koma
   Motion does not know are reported by name.
4. **Schema.** Types, ranges, lengths and patterns.
5. **Semantics.** Duplicate Koma keys, duplicate persistent ids in one Koma,
   transitions that refer to missing or non-adjacent Komas, element types
   that the request does not allow, missing content, assets that do not exist
   in the project, and the limits of the request.
6. **Conversion.** Defaults are applied, the motion engine computes the
   operations, and the resulting presentation is validated against the schema
   of the document model.

### Repair

When the output fails at step 2, 3, 4 or 5, the provider is asked **once** to
correct it. The repair prompt contains the list of problems and the rejected
output. If the second output is also invalid, the execution fails with the
issues of the second attempt. There are never more than two attempts. Errors
of the program itself, such as a failed start, are not retried.

## Prompt templates

Prompts are versioned data in
`packages/agent-runtime/src/prompts/presentationGeneration.ts`. They are not
part of the user interface and not part of a provider.

| Template                  | Version | Purpose                               |
| ------------------------- | ------- | ------------------------------------- |
| `presentation-generation` | 1       | the first request                     |
| `presentation-repair`     | 1       | the correction of a rejected response |

Every template renders three parts:

- `system`: the role, the rules for persistent identity, layout and content,
- `user`: the request, the canvas, the Brand Kit as JSON, the allowed values,
  the available assets, the limits and the response schema,
- `responseJsonSchema`: the response contract as JSON Schema, generated from
  the same schema that validates the response.

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

Diagnostics never contain prompts, the output of the agent or environment
variables. Error output is reduced before it is shown: values that look like
API keys, tokens, authorisation headers or password assignments are replaced,
control characters are removed, and the text is limited to 2000 characters.
The reduction is based on patterns and cannot recognise every secret.

Messages of unexpected errors are replaced by a neutral message, because they
can contain anything.

## Security boundaries

| Rule                                 | Implementation                                                                        |
| ------------------------------------ | ------------------------------------------------------------------------------------- |
| The renderer cannot start processes  | providers run in the main process; the renderer sends a provider id and the request   |
| No shell                             | `spawn` with `shell: false`, an executable path and an argument array                 |
| The prompt is not an argument        | the prompt is written to standard input                                               |
| Arguments are controlled             | all arguments are fixed, except the model name, which must match a restricted pattern |
| The agent cannot act on the computer | Claude Code runs without tools; Codex runs in its read-only sandbox                   |
| No project context for the agent     | the working directory is an empty temporary folder that is removed afterwards         |
| Output is data                       | output is parsed as JSON and validated; it is never executed                          |
| Output cannot name files             | the response has no paths; asset ids are checked against the project                  |
| Executions end                       | time limit, cancellation and output limit                                             |
| No credentials in Koma Motion        | agent CLIs use their own sign-in; Koma Motion stores and asks for no keys             |

### Verified arguments

**Claude Code** (from the help output and two real runs of version 2.1.283):

```text
claude --print --output-format json --input-format text
       --tools "" --strict-mcp-config --disable-slash-commands
       --permission-prompts none --no-session-persistence
       [--model <model>] --system-prompt <text> --json-schema <schema>
```

The prompt is read from standard input. The output is one JSON object. Koma
Motion uses `structured_output` when it is an object and `result` otherwise,
and reports an error when `is_error` is true.

**Codex CLI** (from the help output of version 0.157.1, not run):

```text
codex exec --sandbox read-only --skip-git-repo-check --ephemeral --color never
           [--model <model>] --cd <temporary folder>
           --output-schema <temporary folder>/response-schema.json
           --output-last-message <temporary folder>/answer.json -
```

The final `-` reads the prompt from standard input. Koma Motion creates both
file paths itself and reads the answer from `answer.json`.

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
   starting the process, so that the rules above apply.
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
# Detection of both CLIs. Uses no model.
KOMA_LIVE_DETECTION=1 pnpm vitest run packages/agent-runtime/src/node/live.test.ts

# One generation with Claude Code through the runtime.
KOMA_LIVE_GENERATION=claude-code KOMA_LIVE_MODEL=claude-opus-5-5 \
  pnpm vitest run packages/agent-runtime/src/node/live.test.ts

# One generation with Claude Code through the application.
KOMA_LIVE_E2E=claude-code KOMA_LIVE_MODEL=claude-opus-5-5 pnpm test:e2e live
```
