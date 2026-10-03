# Releases

Koma Motion is published for Windows and macOS through two channels in the
same GitHub repository. Both are early-stage prototypes.

| Channel | What it is                                           | How to get it                        |
| ------- | ---------------------------------------------------- | ------------------------------------ |
| Stable  | a version that was chosen for release. The default.  | the latest release of the repository |
| Nightly | a preview built from `main`, with unfinished changes | the prereleases of the repository    |

**The installers are not signed with a certificate.** Windows and macOS warn
when they are opened. See [Installing](#installing).

## Current state

| Topic                      | State                                                                       |
| -------------------------- | --------------------------------------------------------------------------- |
| Installer for Windows      | available: NSIS installer for x64, per user, no administrator               |
| Installer for macOS        | available: universal disk image and archive, macOS 13 or newer              |
| Application icon           | available                                                                   |
| Stable and nightly channel | available                                                                   |
| Updates on Windows         | available: downloaded and installed when the user chooses                   |
| Updates on macOS           | available: verified update runs in Terminal, then replaces and reopens app  |
| `.koma` file association   | registered by the installers; opening a project this way is not implemented |
| Code signing               | optional local packaging path; published installers still unsigned/ad hoc   |
| Notarisation               | optional local macOS ZIP path; published installers still not notarised     |
| Linux                      | not supported                                                               |

The repository contains no signing material, no credentials and no secrets.
The release workflows use only the token that GitHub gives to a workflow run.

## Installing

### Windows

Download `Koma-Motion-Setup.exe` from the
[latest release](https://github.com/Dytschgo/koma-motion/releases/latest) and
open it. Windows shows a warning because the installer is not signed: choose
"More info" and then "Run anyway". Koma Motion is installed for the current
user and needs no administrator rights.

From PowerShell, this downloads the installer, checks it against
`SHA256SUMS.txt` and runs it without a window:

```powershell
irm https://raw.githubusercontent.com/Dytschgo/koma-motion/main/scripts/install.ps1 | iex
```

### macOS

Download `Koma-Motion.dmg` from the
[latest release](https://github.com/Dytschgo/koma-motion/releases/latest),
open it and move Koma Motion to the Applications folder. macOS refuses to
open the application at first, because it is not notarised. Open System
Settings, go to "Privacy & Security" and choose "Open Anyway" for Koma
Motion.

From the Terminal, this downloads the disk image, checks it against
`SHA256SUMS.txt`, checks the signature and the required macOS version, and
installs into `~/Applications`, keeping a previous version as a backup:

```sh
curl -fsSL https://raw.githubusercontent.com/Dytschgo/koma-motion/main/scripts/install.sh | bash
```

Set `KOMA_MOTION_RELEASE_TAG=v0.1.0` before the command to install that
stable release instead of the latest. Nightly release pages include a
Terminal command that installs the specific nightly. The script does not
remove the quarantine of the download, so the "Open Anyway" step above is
still needed the first time.

The application is signed ad hoc. That lets it start on Apple silicon, but
it is no proof of where the application comes from.

**Managed Macs.** On a Mac that a company manages, an endpoint security tool
such as Elastic Endpoint can end the application a moment after it starts,
without a message and without the "Open Anyway" choice. This was observed on
a Mac enrolled in Intune. Neither the installer nor the application can do
anything about it: such tools want a Developer ID signature with
notarisation, which this release does not have (see
[Code signing](#code-signing)). Ask the administrators for an exception, or
use an unmanaged Mac.

### Checking a download

Every release contains `SHA256SUMS.txt` with the checksum of each file.

```sh
# macOS
shasum -a 256 Koma-Motion.dmg

# Windows, in PowerShell
Get-FileHash Koma-Motion-Setup.exe -Algorithm SHA256
```

The checksums protect against a damaged download. They do not replace a
signature: whoever can change a release can change its checksums.

## Update channels

The channel is chosen in **Settings, Updates**. Stable is the default.
Choosing Nightly asks for confirmation. The choice is stored on the computer,
in the data folder of the application, and belongs to no project.

- Koma Motion checks for updates when it starts and every four hours, in
  installed versions only. A check asks GitHub which releases exist and
  sends nothing about the user or a project.
- Nothing is downloaded or installed without a click. On Windows, "Download
  update" downloads the installer and "Restart to install" installs it. The
  restart is refused while a project has unsaved changes.
- On macOS, "Run update in Terminal" opens a command for the exact release.
  Terminal verifies its checksum and app bundle, asks Koma Motion to quit,
  replaces the app with rollback protection, and reopens it. Settings also
  shows the command with a copy button. Install Koma Motion in a writable
  Applications folder before updating.
- Koma Motion never installs an older version by itself. After switching
  from Nightly back to Stable, the installed nightly stays until a newer
  stable version exists.
- On the Nightly channel, a stable version that is newer than the latest
  nightly is offered. Stable `0.1.1` follows `0.1.1-nightly.20260929.1234`.

A newer version can change the format of projects. Keep copies of your
projects before you use nightly versions.

### How an update is protected

- Release information is read with a limit for time and size and is
  validated before it is used.
- An update is taken from exactly one release. Its manifest must name the
  version that was selected, and every file it lists must belong to that
  release and have a SHA-512 checksum.
- The installer is checked against the checksum of its manifest before it is
  installed.
- The window cannot name a release, a manifest or an installer: the channels
  of the update requests carry no addresses.

This protects against damaged and mixed-up files. Because the installers are
not signed, it does not protect against someone who can publish releases in
the repository.

## Version numbers

| Kind    | Example                       | Tag                            |
| ------- | ----------------------------- | ------------------------------ |
| Stable  | `0.1.0`                       | `v0.1.0`                       |
| Nightly | `0.1.1-nightly.20260929.1234` | `v0.1.1-nightly.20260929.1234` |

The version of the application is the `version` of
`apps/desktop/package.json`. A nightly uses the next patch of that version,
the date and the number of the workflow run. The version of a nightly is set
for its build only and is never committed.

Until version 1.0.0 every version can contain breaking changes, including
changes to the project format.

## Publishing a nightly

A nightly is built on request. There is no schedule, and a push to `main`
publishes nothing.

```sh
# The newest commit of main
gh workflow run nightly.yml --repo Dytschgo/koma-motion --ref main

# A chosen commit of main
gh workflow run nightly.yml --repo Dytschgo/koma-motion --ref main -f sha=<commit>
```

This **publishes a prerelease** when all checks pass. The workflow
(`.github/workflows/nightly.yml`):

1. refuses commits that are not part of `main`,
2. reuses the newest CI run for that exact commit only when the run completed
   successfully and formatting, lint, types, both platforms' unit tests and
   every Windows and macOS application-test shard and the required LibreOffice
   integration lane succeeded; otherwise it runs
   static checks on Windows and unit, build and application checks on both
   Windows and macOS and real LibreOffice integration on Windows,
3. packages the application for Windows and macOS with the version of the
   nightly,
4. installs the package and tests it: the application must report the
   expected version from the inside and complete the main workflow,
5. checks that the update manifests describe exactly the packaged files,
6. creates a draft with the checked files and publishes it as a prerelease.

Coverage decisions and report summaries use the policy helper from the exact
workflow revision (`github.workflow_sha`). The helper is copied outside the
checkout before selecting the guarded build SHA. Historical candidates therefore
use current release policy while their dependencies, tests, build and installers
still come from the chosen commit.

CI and release fallback application tests retain their JSON reports and traces
for seven days on successful and failed runs. Job summaries list flaky tests,
retry attempts and skipped tests, so a green run does not imply that every test
passed on its first attempt or that optional integrations ran. Native workers
remain serial within each shard. Optional LibreOffice cases remain skipped in
the default application lanes. A separate required Windows lane downloads the
pinned LibreOffice 26.2.6 MSI from The Document Foundation, checks its SHA-256,
and extracts it into a private runner directory. Its driver checks the actual
executable/version and requires five integration scenarios to pass with no
skips or flaky results: PPTX-to-PDF preparation and previews, proposal
cancellation/retry, bounded/invalid input rejection, shutdown during conversion,
and PPTX brand material beside an image. Reports, preview screenshots and
traces are retained for seven days. No live provider is used.

Stable/nightly fallback lanes preserve the driver and pinned provisioner from
the workflow revision before checking out the candidate. Missing historical
test files or scenarios fail the gate. Publishing needs this lane to succeed
or exact-commit CI evidence that includes the lane; older CI without it does
not cover current quality policy.

Each nightly release page includes a macOS Terminal command to install that
specific nightly with `scripts/install.sh`. The script verifies the disk
image against the release checksums before replacing the application.

A nightly is never marked as the latest release, and it has no files with
names that a link to the latest release could use.

## Publishing a stable release

1. Set the `version` in `apps/desktop/package.json` and in the root
   `package.json`, and describe the release in `CHANGELOG.md`.
2. Merge that change into `main` through a pull request.
3. Tag the commit of `main` and push the tag:

   ```sh
   git tag v0.1.0 <commit>
   git push origin v0.1.0
   ```

The workflow (`.github/workflows/release.yml`) runs the same steps as a
nightly, and in addition:

- refuses a tag that does not match the version of the application,
- adds `Koma-Motion-Setup.exe` and `Koma-Motion.dmg`, the names without a
  version that links to the latest release use,
- publishes the release **without** marking it as the latest,
- downloads the Windows installer and the macOS disk image and archive from
  the public release, compares them with the published checksums, installs or
  unpacks them and tests them,
- marks the release as the latest only after those tests passed.

Until the last step, the previous release stays the latest one, and
installed applications are not offered the new version.

Do not remove a check to get a release through. Keep earlier releases: they
are the way back.

## Files of a release

| File                                       | Purpose                                   |
| ------------------------------------------ | ----------------------------------------- |
| `Koma-Motion-Setup-<version>.exe`          | installer for Windows                     |
| `Koma-Motion-<version>-universal.dmg`      | disk image for macOS                      |
| `Koma-Motion-<version>-universal-mac.zip`  | archive for macOS                         |
| `*.blockmap`                               | lets an update download only what changed |
| `latest.yml`, `latest-mac.yml`             | update manifests of the stable channel    |
| `nightly.yml`, `nightly-mac.yml`           | update manifests of the nightly channel   |
| `SHA256SUMS.txt`                           | checksums of all files                    |
| `Koma-Motion-Setup.exe`, `Koma-Motion.dmg` | stable only: names without a version      |

## What has been verified

| Claim                                                   | Evidence                                                    |
| ------------------------------------------------------- | ----------------------------------------------------------- |
| The Windows installer installs, runs and uninstalls     | `scripts/verify-packaged.mjs`, on Windows 11 and in CI      |
| The macOS archive is signed ad hoc, universal, and runs | `scripts/verify-packaged.mjs`, in CI on macOS only          |
| The packaged application reports the expected version   | `e2e-packaged/packaged.spec.ts`                             |
| Channels, versions and manifests follow the rules above | unit tests of `src/main/updates` and of the release scripts |
| The channel is stored and survives a restart            | `e2e/updates.spec.ts`                                       |
| An update on Windows installs from a published release  | `scripts/verify-update.mjs`, by hand, see below             |

Packaged verification now edits an existing generated object, saves through
IPC, reopens the actual `.koma` file through a stubbed native dialog, and checks
its edited geometry and preserved generation history. It also checks packaged
version, process isolation and bundled fonts. Its smoke-mode updater check
only establishes that update checks are disabled; it does not establish
system-wide network isolation.

On macOS the verifier tests the update ZIP and DMG separately. It mounts the
DMG read-only at a unique private mount point, copies the app out, checks
`codesign` and both `lipo` architectures, and runs the packaged tests on that
copy. It detaches in `finally`, including after test/signature failure. A failed
detach retains the private directory rather than removing a mounted tree.
Each source has its own test-output directory. Script lifecycle tests verify
failure cleanup using synthetic files; actual DMG mounting and execution need
the hosted macOS package lane. Windows install/uninstall checks remain in the
temporary installer path.

Not verified:

- Updating to a newer stable version. No second stable version exists yet.
- Updating an application that is installed in the default folder. The test
  installs into a temporary folder.
- Installing on a Mac by hand, including the steps in "Privacy & Security".
- Windows on ARM64.
- The behaviour of virus scanners towards the unsigned installer.

### Testing an update

`scripts/verify-update.mjs` tests a real update on Windows. It uses the
network and the public releases, so it is run by hand and is no part of CI.

```sh
cd apps/desktop
node scripts/verify-update.mjs <installer> <stable|nightly> <expected version>
```

It installs the installer into a temporary folder, chooses the channel in
the settings, downloads the update, restarts to install it, and runs the
tests of the packaged application against the result. The application is
removed again at the end.

On 2026-09-30 this updated the published `0.1.0` to the published
`0.1.1-nightly.20260929.36646156587` on Windows 11.

## What is still needed

### Code signing

Unsigned installers show warnings, and some organisations block them.
Signing needs certificates that belong to a person or an organisation, which
is why signed distribution cannot be validated without the maintainer's
legitimate credentials. The current release and nightly workflows remain
unsigned on Windows and ad hoc on macOS.

- Certificates, private keys and passwords are never committed.
- Any future signing CI must limit secrets to protected release environments
  and trusted revisions. The existing workflows do not use signing secrets.
- Pull requests from forks never have access to signing secrets.

#### Optional local packaging

The opt-in wrapper uses the locked electron-builder 26 dependency and its
existing base packaging settings. It never publishes. Run from the repository
root after `pnpm install --frozen-lockfile`, on the platform being packaged:

```sh
node apps/desktop/scripts/package-signed.mjs win
# On macOS instead:
node apps/desktop/scripts/package-signed.mjs mac
```

Provide the inputs below through a protected signing host or secret store.
Keep certificate and key files outside the checkout; they are not package assets.
The script validates every required input before building or contacting a
signing service. Missing, blank, partial or conflicting groups fail. It does
not print credential values or forward child-process output, including failed
signing output. A failure approves no artifact for distribution; existing
files are retained for investigation. Do not treat an old output as a new
successful build.

The configuration is produced by `scripts/signed-configuration.mjs`. Signed
output is isolated in `apps/desktop/release/signed`, with `forceCodeSigning`
enabled. Its `afterPack: null` disables the ad-hoc hook for this path only.
The default YAML, ad-hoc hook, package commands and release workflows are
unchanged. Keep using `pnpm package:win` or `pnpm package:mac` for the current
unsigned/ad-hoc packages. No signed package has been produced or accepted
without credentials.

### Apple notarisation

- membership in the Apple Developer Program,
- a Developer ID Application certificate,
- credentials for the notary service, held outside the repository,
- the hardened runtime and the entitlements the application needs. Agent
  CLIs are started as child processes, which has to be tested under the
  hardened runtime,
- stapling the notarisation ticket to the application and the disk image.

With a signed and notarised application, updates on macOS can be installed
by an appropriate signed-update integration. This optional packaging path does
not change the current Terminal update flow.

The optional path builds a **universal ZIP only**, containing the signed,
notarised and stapled application. It requires these complete inputs:

| Input               | Purpose                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `CSC_LINK`          | absolute path to the Developer ID Application `.p12` file                         |
| `CSC_KEY_PASSWORD`  | nonempty password protecting that file                                            |
| `KOMA_MAC_IDENTITY` | certificate name without `Developer ID Application:` prefix, ending in `(TEAMID)` |
| `KOMA_MAC_TEAM_ID`  | the ten-character Apple developer team ID                                         |
| `APPLE_API_KEY`     | absolute path to an existing App Store Connect team-key `.p8` file                |
| `APPLE_API_KEY_ID`  | ten-character API key ID                                                          |
| `APPLE_API_ISSUER`  | team key issuer UUID                                                              |

For example, the identity's form is `Organisation Name (TEAMID1234)`; use
the name of your real certificate. Do not set `CSC_NAME`, Apple ID/password
or keychain-profile alternatives alongside this API-key path. Apple account
membership, certificate validity and notary permissions must be established
by the maintainer. Input presence is not credential validation.

The distribution enables hardened runtime and explicitly supplies
`build/entitlements.signed.mac.plist` for the app and its nested helpers.
It grants only `com.apple.security.cs.allow-jit`, as needed by current Electron;
it does not enable the App Sandbox, disable library validation or add the
older unsigned-executable-memory exception. Electron's notarization guidance
specifically advises against that exception on Electron 12 and newer.
[Electron notarization prerequisites](https://packages.electronjs.org/notarize/main/index.html#prerequisites)
and [Apple's notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
describe the signing and runtime requirements.

electron-builder performs signing and app notarization before making the ZIP.
The worker then requires a Developer ID Application authority, the configured
team and hardened-runtime flag, `codesign --verify --deep --strict`,
`xcrun stapler validate` and Gatekeeper `spctl --assess --type execute` on
the app. It rejects ad-hoc signatures. These checks are implemented but have
not been run with a real Developer ID identity or notary key. The installed
builder requires the identity qualifier without its certificate-type prefix;
see the [v26 macOS signing configuration](https://www.electron.build/v26/docs/features/code-signing/code-signing-mac/).

The signed path does **not** produce a signed or notarised DMG. A future DMG
path must sign the image, submit it to the notary service, staple and validate
its ticket **before** generating final checksums and update metadata. Stapling
after packaging changes artifact bytes. Follow
[Apple's custom notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow);
do not label the current default DMG as notarised.

Before distributing a credentialed build, run packaged startup/edit/save/reopen
on Intel and Apple silicon, downloaded-file Gatekeeper acceptance, update and
file-dialog checks, and real local subprocess checks under hardened runtime.
Koma Motion starts installed agent CLIs and LibreOffice as child processes and
also launches Electron utility helpers. Configuration tests do not prove
these paths work in a hardened, signed application. Validate them without
adding broad entitlements as a workaround. Live provider generation still
requires separate explicit authorization.

### Windows signing

- a code signing certificate. How certificates are issued and stored has to
  be checked when this is set up, because it affects how signing runs in CI,
- a timestamp, so that signatures stay valid after the certificate expires.

A new certificate has no reputation at first, so Windows can show a warning
for downloads even when they are signed.

The optional implementation uses **Microsoft Artifact Signing**, formerly
Azure Trusted Signing, through electron-builder 26's `win.azureSignOptions`.
It requires a validated **Public Trust** account/profile and the matching
publisher name, plus a service principal authorized to sign that profile:

| Input                         | Purpose                                           |
| ----------------------------- | ------------------------------------------------- |
| `KOMA_AZURE_SIGNING_ENDPOINT` | HTTPS regional `*.codesigning.azure.net` endpoint |
| `KOMA_AZURE_SIGNING_ACCOUNT`  | signing account name                              |
| `KOMA_AZURE_SIGNING_PROFILE`  | Public Trust certificate profile name             |
| `KOMA_SIGNING_PUBLISHER`      | exact certificate common name                     |
| `AZURE_TENANT_ID`             | service principal tenant UUID                     |
| `AZURE_CLIENT_ID`             | application/client UUID                           |
| `AZURE_CLIENT_SECRET`         | service principal secret value                    |

The regional endpoint must match the account's region. The identity-validated
account/profile, role assignment and current eligibility must be set up
through Microsoft's service. The wrapper rejects classic `CSC_*`/`WIN_CSC_*`
certificate inputs and alternative Azure credential groups, preventing an
accidental fallback to a different signer. The builder's Azure integration
installs its TrustedSigning PowerShell module from PSGallery on the signing
host; this is not part of the unsigned pipeline.
[electron-builder's v26 Azure setup](https://www.electron.build/v26/docs/features/code-signing/code-signing-win/)
documents the supported environment credential group and configuration.

SHA-256 file and timestamp digests and Microsoft's RFC 3161 timestamp service
are configured. After packaging, the wrapper requires Windows Authenticode
status `Valid`, a timestamp certificate and the exact publisher on both
the application executable and NSIS installer. It exits unsuccessfully if
those native checks fail. No account, service principal, trusted signature or
timestamp has been validated in this repository's credential-free tests.

Do not assume a newly issued public Windows certificate is an exportable
PFX suitable for unattended CI. Microsoft describes current OV/EV private-key
hardware protection requirements and cloud signing alternatives in its
[code signing options](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/code-signing-options).
Artifact Signing manages keys in hardware rather than distributing a PFX;
see [Microsoft's service overview](https://learn.microsoft.com/en-us/azure/artifact-signing/overview).
If a maintainer already has a legitimate certificate with an allowed export
or an HSM provider, that provider needs its own reviewed configuration; it is
not implemented by this wrapper. Signing is not a guarantee that SmartScreen
or organisational policy will accept a new download. Verify those outcomes
on clean machines after actual signing and packaged application checks.

### Further steps

- Open a project when its `.koma` file is opened in the file manager.
- An icon for `.koma` files.
- Builds for Windows on ARM64.
- The licences of the dependencies inside the application.
- Decide whether the Mac App Store is an option. Its sandbox restricts
  starting other programs, which is the core of the agent providers.
