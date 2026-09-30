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
| Updates on macOS           | the application opens the download page; it cannot install updates          |
| `.koma` file association   | registered by the installers; opening a project this way is not implemented |
| Code signing               | not set up                                                                  |
| Notarisation               | not set up                                                                  |
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

### macOS

Download `Koma-Motion.dmg` from the
[latest release](https://github.com/Dytschgo/koma-motion/releases/latest),
open it and move Koma Motion to the Applications folder. macOS refuses to
open the application at first, because it is not notarised. Open System
Settings, go to "Privacy & Security" and choose "Open Anyway" for Koma
Motion.

The application is signed ad hoc. That lets it start on Apple silicon, but
it is no proof of where the application comes from.

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

The channel is chosen in **Settings, App updates**. Stable is the default.
Choosing Nightly asks for confirmation. The choice is stored on the computer,
in the data folder of the application, and belongs to no project.

- Koma Motion checks for updates when it starts and every four hours, in
  installed versions only. A check asks GitHub which releases exist and
  sends nothing about the user or a project.
- Nothing is downloaded or installed without a click. On Windows, "Download
  update" downloads the installer and "Restart to install" installs it. The
  restart is refused while a project has unsaved changes.
- On macOS, "Open the download page" opens the release in the browser.
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
2. checks the code: format, lint, types, unit tests, build, application tests,
3. packages the application for Windows and macOS with the version of the
   nightly,
4. installs the package and tests it: the application must report the
   expected version from the inside and complete the main workflow,
5. checks that the update manifests describe exactly the packaged files,
6. creates a draft with the checked files and publishes it as a prerelease.

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
- downloads the Windows installer from the public release, compares it with
  the published checksum, installs it and tests it,
- marks the release as the latest only after that test passed.

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
is why it cannot be set up without the maintainer.

- Certificates, private keys and passwords are never committed.
- Signing runs in CI with secrets that are limited to the release workflows
  and to protected tags.
- Pull requests from forks never have access to signing secrets.

### Apple notarisation

- membership in the Apple Developer Program,
- a Developer ID Application certificate,
- credentials for the notary service, stored as CI secrets,
- the hardened runtime and the entitlements the application needs. Agent
  CLIs are started as child processes, which has to be tested under the
  hardened runtime,
- stapling the notarisation ticket to the application and the disk image.

With a signed and notarised application, updates on macOS can be installed
by the application.

### Windows signing

- a code signing certificate. How certificates are issued and stored has to
  be checked when this is set up, because it affects how signing runs in CI,
- a timestamp, so that signatures stay valid after the certificate expires.

A new certificate has no reputation at first, so Windows can show a warning
for downloads even when they are signed.

### Further steps

- Open a project when its `.koma` file is opened in the file manager.
- An icon for `.koma` files.
- Builds for Windows on ARM64.
- The licences of the dependencies inside the application.
- Decide whether the Mac App Store is an option. Its sandbox restricts
  starting other programs, which is the core of the agent providers.
