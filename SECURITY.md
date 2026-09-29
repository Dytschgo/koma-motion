# Security

Koma Motion is an early-stage prototype. It has not had a security audit.

## Reporting a vulnerability

Please do **not** open a public issue for a security problem.

Report it privately through GitHub:
[Report a vulnerability](https://github.com/Dytschgo/koma-motion/security/advisories/new).

Include what you found, how to reproduce it, and which version or commit you
tested. You will get a response as soon as a maintainer has reviewed the
report. There is no bug bounty.

## Supported versions

There are no releases yet. Security fixes are made on the `main` branch only.

## Security philosophy

Koma Motion runs agent CLIs on your machine and turns their output into
documents. The design therefore rests on four rules:

1. **Agent output is untrusted input.** It is parsed as data, limited in size,
   validated against a schema, checked for invalid references and only then
   converted into the document model. It is never executed.
2. **The renderer is untrusted.** The user interface runs in a sandboxed
   process without Node.js, without filesystem access and without the ability
   to start processes.
3. **Privileged work happens in the main process**, behind a small set of
   named, validated IPC channels.
4. **Security is not weakened for development convenience.** There is no
   development server. Development builds are loaded through the same
   protocol, with the same Content Security Policy and the same isolation
   settings as production builds.

## Electron security boundary

| Measure                                       | Status                                                                                   |
| --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `contextIsolation`                            | Enabled                                                                                  |
| `nodeIntegration`                             | Disabled                                                                                 |
| `sandbox`                                     | Enabled for the renderer                                                                 |
| `webSecurity`                                 | Enabled                                                                                  |
| Preload API                                   | Small, typed, exposed through `contextBridge`                                            |
| IPC channels                                  | Fixed allow-list; no generic "execute" channel                                           |
| IPC payloads                                  | Validated with schemas in the main process; responses validated in the renderer          |
| IPC senders                                   | Only the main frame of the application window is accepted                                |
| Content Security Policy                       | Sent with every file of the application; no remote content, no inline scripts, no `eval` |
| Navigation                                    | Blocked                                                                                  |
| New windows                                   | Blocked; allow-listed `https` links open in the system browser                           |
| Permission requests (camera, microphone, ...) | Denied                                                                                   |
| Remote content                                | Not loaded                                                                               |

### Filesystem

The renderer never receives a filesystem API and never chooses a path to
write to. Opening and saving happen through native dialogs shown by the main
process. The main process remembers the path that the user selected; `Save`
writes to that path only.

Images are read by the main process after the user selected them in a native
dialog. The file type is verified from the file content, the size is limited,
and the bytes are stored inside the project. Elements refer to images by asset
id. Project files cannot make the application read other files.

A project file is limited to 64 MiB of UTF-8. The window's save request is
held to the same limit, including unknown extension data and the combined
size of embedded images. Before a save replaces an existing file, that file
is inspected. A missing file can be created. A file that cannot be read, or
that is larger than the limit, is left unchanged: it might be a project from
a newer version of Koma Motion. One project file is read or written at a time.

### Agent providers

- CLIs are started without a shell, with an executable path and an explicit
  argument array.
- The prompt is passed on standard input, not as an argument.
- The only user-controlled argument is the optional model name, which is
  restricted to a safe alphabet.
- Agents are started with their tools disabled (Claude Code) or in a read-only
  sandbox (Codex), in an empty temporary working directory.
- Every execution has a timeout and can be cancelled.
- Standard output and standard error are limited in size. Diagnostics are
  redacted for common secret formats before they are shown.
- Commands, paths or code contained in agent output are never executed. Agent
  output cannot define filesystem paths: it can only refer to asset ids that
  already exist in the project.
- Koma Motion does not download or execute code.

Koma Motion does not store API keys. Agent CLIs use their own authentication.

## Known limitations

- Application builds are not code-signed or notarised yet. See
  `docs/RELEASES.md`.
- The agent CLIs are separate programs with their own security properties.
  Koma Motion restricts how it starts them but cannot make guarantees about
  their behaviour.
- The redaction of diagnostics is pattern-based and cannot guarantee removal
  of every secret, prompt or environment value from arbitrary stderr.
