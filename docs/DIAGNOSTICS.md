# Failure handling and the diagnostics log

Koma Motion handles four kinds of failure in a defined way and writes what
happened to a small log on the user's computer. Nothing is sent anywhere.

## What happens when something fails

| Failure                                    | What the user sees                                                           | What the application does                                                                                   |
| ------------------------------------------ | ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| An error while the interface renders       | A screen in the window: **Something went wrong**, with **Reload window**     | Lets a recovery capture under way finish, logs the error, reloads on request                                |
| The renderer process is gone               | A native question: **Reload window** or **Quit Koma Motion**                 | Forgets the lost page's project, logs the reason, reloads or quits                                          |
| The window does not respond                | A native question: **Keep waiting**, **Reload window**, **Quit Koma Motion** | Logs it. Reload ends the renderer process first. The question closes by itself when the page responds again |
| An uncaught exception in the main process  | A native message: **Koma Motion has to close**                               | Logs it and exits with code 1                                                                               |
| An unhandled rejection in the main process | Nothing                                                                      | Logs it and continues                                                                                       |

Every reload ends at the existing recovery offer described in
[Crash recovery](CRASH_RECOVERY.md). There is no second recovery mechanism.
When the page of a running application is lost, the main process forgets the
file path, the unsaved state and the recovery session of that page, lets
recovery writes that were already admitted finish, and reads the recovery
record from disk again. The reloaded page then asks for the offer exactly as
it does after a restart. A project without unsaved changes has no snapshot:
the reloaded window shows the start screen, and the project is opened again
from its file with **Open a project**.

After a render error the document is not captured again. Captures follow an
edit after 600 ms, so the snapshot misses the newest edit at most. That edit
may be what the interface could not show, and a snapshot that contains it
would fail the same way after every reload.

### Reasons for a lost renderer

| Reason reported by Electron          | Answer                                             |
| ------------------------------------ | -------------------------------------------------- |
| `crashed`, `abnormal-exit`, `killed` | Offer reload or quit                               |
| `clean-exit`                         | The same. The window is empty either way           |
| `oom`, `memory-eviction`             | The same, and the message says that memory ran out |
| `launch-failed`                      | The same, and the message says it may fail again   |
| `integrity-failure`                  | Quit only. A reload would start the same code      |
| A reason this version does not know  | Offer reload or quit                               |
| The third loss within one minute     | Quit only. Reloading is not helping                |

Dismissing the question reloads, so an empty window is never left behind.
Quitting from these questions does not ask to save: the page that could save
is gone. Unsaved changes stay in the recovery snapshot for the next start.

### Why an uncaught exception ends the application

The main process owns every file Koma Motion writes: projects, the Brand Kit
library, templates and the recovery record. After an exception that no code
expected, it is not known which of its state is still true, and continuing
could write that state to disk. Without a handler, Electron shows a message
and keeps running. Koma Motion logs the error, tells the user once and exits.
It does not restart itself, which would turn an error at startup into a loop.

An unhandled rejection is different: a background task failed after its
caller had moved on. No statement was interrupted halfway, so the state is
not in doubt, and ending the application would discard unsaved work for no
gain. It is logged.

In an automated run of a packaged build (`KOMA_SMOKE=1`) the message for an
uncaught exception is not shown, because nobody could dismiss it. The exit
code is the same.

## The diagnostics log

The main process writes `logs/koma-motion.log` in the private data folder of
the application. No other process writes it, and the window cannot read it.

- **Bounded.** One file holds at most 512 KiB. A full file becomes
  `koma-motion.previous.log`, replacing the one before, so the log takes at
  most about 1 MiB. One entry is at most 8 KiB.
- **One JSON object per line**, with `time`, `level` and `event`. Text from
  outside cannot start a new entry.
- **Rate-limited.** 200 entries at once, then one per second. Failed IPC
  requests and reports of the window have tighter limits of their own. An
  entry says how many were left out.
- **Never fails its caller.** If the log cannot be written, entries are
  dropped and writing is tried again after 30 seconds.

### What it records

| Event                                                         | Content                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `app.start`, `app.quit`                                       | Version, packaged or not, platform, architecture, OS release, runtime versions, exit code         |
| `window.renderer-gone`, `window.unresponsive`, and the choice | Reason, exit code, what was offered and chosen                                                    |
| `window.page-reloaded`                                        | That the page was loaded again                                                                    |
| `app.child-process-gone`                                      | Type, reason and exit code of a helper process such as the GPU process                            |
| `main.uncaught-exception`, `main.unhandled-rejection`         | Name, message, code and stack of the error                                                        |
| `renderer.error`                                              | Class of the error, call sites and React component names. No message                              |
| `updater.status`, `updater.message`                           | Update state, channel, version, and what the native updater reports                               |
| `ipc.failed`                                                  | Channel, and name, message, code and stack of the error                                           |
| `ipc.returned-failure`                                        | Channel and status. Not the sentence shown to the user                                            |
| `provider.run-failed`                                         | Provider id, error code, duration, and kind, outcome, exit code and output length of each attempt |

### What it leaves out

The log is built so that the content of a project does not reach it.

- Requests and responses of IPC channels are never recorded, only that one
  failed. Projects, prompts, reference text, brand material and images
  travel in those requests.
- For a provider run, the error output of the provider, the prompt template
  and the message are dropped. They can quote the request.
- For an error of the window, the message is dropped in the window and the
  rest is filtered again in the main process. The window holds the project,
  and an error message can quote a value.
- A schema error is reduced to the code and location of each issue.
- Every text is passed through the credential redaction of
  `packages/agent-runtime/src/node/redact.ts`.
- File paths are reduced. Paths inside the application (`<app>`) and its data
  folder (`<app-data>`) keep their inner part, because it names code and
  files of Koma Motion. Every other absolute path, including everything in
  the home directory, keeps only a well-known file extension:
  `<home>/…/*.koma`. A file name can contain spaces and quotes, so the end of
  a path cannot be found reliably: a path in quotes is removed up to the last
  such quote on its line, and a path without quotes to the end of its line.

Limits: redaction and path reduction match patterns. The message of an error
of the main process is kept, and such a message could in principle quote
something. Text that does not start like an absolute path, such as a
relative path or a file name alone, is not recognised. The log should be read
before it is shared.

### Getting the log

**Settings > About > Diagnostics log** and the screen after a render error
offer two actions:

- **Copy diagnostics** puts version, platform and the newest entries, at most
  64 KiB, on the clipboard.
- **Open log folder** shows the folder in the file manager.

Both run in the main process. The window names no path and receives no log
text. See the IPC table in [ARCHITECTURE.md](../ARCHITECTURE.md).

## Verification

`crashHandling.spec.ts` ends the renderer process of the running application
with `webContents.forcefullyCrashRenderer()`, answers the native question,
and checks that the reloaded page offers and restores the committed edit. It
also checks that an unanswered question does not keep the application from
quitting, that a render error leads through the reload screen to the same
offer, and that the log holds the error without its message and without
project content. The render error is caused by replacing the page's own
`ResizeObserver` from the test; there is no hook in the application for it.

Unit tests cover the log (rotation, bounds, redaction, write failure, rate
limit), path reduction, the decision per reason, the window supervisor with a
substituted dialog, and both process error handlers.

Not exercised by automated tests: a page that really stops responding, the
native message for an uncaught exception, and every reason other than
`crashed` in a running application. Native questions are answered by
substituting `dialog.showMessageBox`, as in the other application tests.
