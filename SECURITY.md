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

Security fixes are made on the `main` branch and published with the next
stable release. Earlier releases receive no fixes.

## Security philosophy

Koma Motion runs agent CLIs on your machine and turns their output into
documents. The design therefore rests on four rules:

1. **Agent output is untrusted input.** It is parsed as data, limited in size,
   validated against a schema, checked for invalid references and only then
   converted into the document model. It is never executed.
2. **The renderer is untrusted.** The user interface runs in a sandboxed
   process without Node.js, without filesystem access and without the ability
   to start processes or to open its own network connections. The main process
   may open a link to this repository in the system browser. That browser
   reaches the network.
3. **Privileged work happens in the main process**, behind a small set of
   named, validated IPC channels.
4. **Security is not weakened for development convenience.** There is no
   development server. Development builds are loaded through the same
   protocol, with the same Content Security Policy and the same isolation
   settings as production builds.

## Electron security boundary

| Measure                                       | Status                                                                                                                                                                                                                                     |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `contextIsolation`                            | Enabled                                                                                                                                                                                                                                    |
| `nodeIntegration`                             | Disabled                                                                                                                                                                                                                                   |
| `sandbox`                                     | Enabled for the renderer                                                                                                                                                                                                                   |
| `webSecurity`                                 | Enabled                                                                                                                                                                                                                                    |
| Preload API                                   | Small, typed, exposed through `contextBridge`                                                                                                                                                                                              |
| IPC channels                                  | Fixed allow-list; no generic "execute" channel                                                                                                                                                                                             |
| IPC payloads                                  | Validated with schemas in the main process; responses validated in the renderer                                                                                                                                                            |
| IPC senders                                   | Only the main frame of the application window is accepted                                                                                                                                                                                  |
| Content Security Policy                       | Sent with every file of the application; no remote content, no inline scripts, no `eval`                                                                                                                                                   |
| Connection allowlist                          | `(response-origin);webrtc=block` on every application response. `ConnectionAllowlists` is enabled before startup. This blocks WebRTC, including direct TCP and TURN. CSP `connect-src` and the session request filter do not cover WebRTC. |
| Session request filter                        | Cancels requests other than `koma://app/`, `data:` and unpackaged `devtools:`                                                                                                                                                              |
| Navigation                                    | Top-level navigation away from the application is blocked, as are subframe navigations of that window                                                                                                                                      |
| New windows                                   | Blocked. A normalised `https://github.com/Dytschgo/koma-motion` URL, or a subpath without a query, may be opened in the system browser                                                                                                     |
| Protocol files                                | Served only from a canonical path inside the renderer bundle. Junctions, symlinks, alternate data streams, Windows device names and trailing dots or spaces are rejected                                                                   |
| Permission requests (camera, microphone, ...) | Denied                                                                                                                                                                                                                                     |
| Remote content                                | Not loaded into the window. Opening a repository link reaches the network in the system browser                                                                                                                                            |

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
- What the user and the project contribute to a prompt is passed on standard
  input, not as an argument. Claude Code receives the fixed system
  instructions and the response schema as arguments.
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

### Updates

The main process is the only part of the application that uses the network
by itself, and it does so for updates only.

- Installed versions ask the GitHub API which releases of Koma Motion exist:
  when the application starts, every four hours and on request. The request
  contains nothing about the user or a project. Versions that are run from
  the source code do not check.
- Release information is untrusted input. It is limited in time and size,
  validated, and reduced to the files that are stored under exactly one
  release of this repository. Redirects are not followed.
- An update manifest must name the selected version. Every file it lists
  must belong to that release and carry a SHA-512 checksum, which is checked
  before anything is installed.
- Nothing is downloaded or installed without a request of the user. An older
  version is never installed.
- The window cannot name a release, a manifest or an installer. Its update
  requests carry a channel name and nothing else.

## Known limitations

- **The installers are not signed with a certificate and not notarised.**
  The checks above protect against damaged and mixed-up files. They do not
  protect against someone who can publish releases in the repository or
  change what GitHub delivers. See `docs/RELEASES.md`.

- On Windows, with this Electron build, a top-level page can still construct
  `RTCPeerConnection`. Local STUN on `127.0.0.1` and `::1`, TURN-UDP, TURN-TCP
  and TURNS then complete without a packet or a TCP connection at a listener
  on the loopback address. The listeners were checked with a local probe
  before the page ran. mDNS multicast, WebTransport, a completed TURN
  allocation and a TLS handshake were not measured.
- A same-origin child frame can still construct `RTCPeerConnection`. On
  Windows that terminated the renderer (Chromium issue 565837691) and sent no
  packets. Subframe navigations are cancelled and the constructor is replaced
  when the frame is created, but page script can call it on the initial
  `about:blank` document before that replacement runs. The window can close.
- A same-origin worker and a blob worker both failed to start during the same
  Windows run, and neither sent a packet. A worker that had started was not
  observed. The application protocol does not enable fetch.
- Resolving a protocol file checks the canonical path and then reads it. A
  local process that replaces a bundle file with a junction between those two
  steps can still be followed by the read. The renderer has no filesystem API
  it can use to do that.
- File symlinks are rejected when the operating system allows creating one.
  On this Windows machine, creating a file symlink failed with `EPERM`.
  Directory junctions were tested in the unit tests and in the running
  application. macOS was not exercised by the change that added these checks.
- The agent CLIs are separate programs with their own security properties.
  Koma Motion restricts how it starts them but cannot make guarantees about
  their behaviour.
- The redaction of diagnostics is pattern-based and cannot guarantee removal
  of every secret, prompt or environment value from arbitrary stderr.
