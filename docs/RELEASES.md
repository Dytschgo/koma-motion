# Releases

Koma Motion has **no releases yet**. There are no installers, no signed
builds and no update mechanism. The application runs from the source code.

This document describes what is needed before a release can be published.
Nothing in it is set up.

## Current state

| Topic                    | State                                                   |
| ------------------------ | ------------------------------------------------------- |
| Build from source        | works: `pnpm build` and `pnpm start`                    |
| Installer for macOS      | not available                                           |
| Installer for Windows    | not available                                           |
| Application icon         | not available, Electron shows its default icon          |
| Code signing             | not set up                                              |
| Notarisation             | not set up                                              |
| Automatic updates        | not available                                           |
| Release automation       | not set up, CI only checks the code                     |
| `.koma` file association | not available, projects are opened from the application |

The repository contains no signing material, no credentials and no secrets,
and the CI workflow uses none.

## macOS packaging

To be decided and built:

- a packaging tool that creates an application bundle and a disk image,
- builds for Apple silicon and for Intel, or a universal build,
- the bundle identifier, for example `org.komamotion.app`,
- the registration of the `.koma` file type, so that projects open with a
  double click,
- the hardened runtime and the entitlements the application needs. Agent
  CLIs are started as child processes, which has to be tested under the
  hardened runtime,
- whether the application can be distributed through the Mac App Store. The
  App Sandbox restricts starting other programs, which is the core of the
  agent providers.

## Windows packaging

To be decided and built:

- a packaging tool and an installer format,
- builds for x64 and for ARM64,
- installation for one user without administrator rights,
- the registration of the `.koma` file type,
- an uninstaller that removes the application and leaves projects alone.

## Application icons

- A source image of at least 1024 x 1024 pixels.
- `.icns` for macOS and `.ico` for Windows, with all required sizes.
- An icon for `.koma` files.

The application mark is typographic so far. The small two-frame mark in the
top bar is drawn in code and is not an icon file.

## Code signing

Unsigned applications show warnings on both platforms, and macOS refuses to
open them without extra steps. Signing needs certificates that belong to a
person or an organisation, which is why it cannot be set up without the
maintainer.

Rules for this repository:

- Certificates, private keys and passwords are never committed.
- Signing runs in CI with secrets that are limited to release workflows and
  to protected branches or tags.
- Pull requests from forks never have access to signing secrets.

## Apple notarisation

Required:

- membership in the Apple Developer Program,
- a Developer ID Application certificate,
- credentials for the notary service, stored as CI secrets,
- signing with the hardened runtime before the submission,
- stapling the notarisation ticket to the application and the disk image,
- a test of the downloaded disk image on a computer that has never run the
  application.

## Windows signing

Required:

- a code signing certificate for Windows. How certificates are issued and
  stored has to be checked when this is set up, because the requirements for
  the storage of private keys affect how signing can run in CI,
- a timestamp, so that signatures stay valid after the certificate expires,
- signing of the installer and of the executables inside it.

A new certificate has no reputation at first, so Windows can show a warning
for downloads even when they are signed.

## Release artefacts

For every release:

- a disk image for macOS and an installer for Windows,
- checksums of all files,
- the entry of the release in `CHANGELOG.md`,
- the licences of the dependencies that are part of the application. This
  has to be generated during the build.

Version numbers follow semantic versioning. Until version 1.0.0 every release
can contain breaking changes, including changes to the project format.

## GitHub Releases

Planned, not set up:

- a workflow that starts from a version tag,
- builds on macOS and on Windows runners,
- signing and notarisation,
- a draft release with the artefacts, which a maintainer reviews and
  publishes.

## Update distribution

Not available. To be decided:

- whether the application checks for updates, and whether that is on or off
  by default. Koma Motion works offline and blocks the window's own network
  connections today, so a check for updates would be the first network access
  of the application itself. A repository link can already open in the system
  browser.
- where updates are downloaded from,
- how updates are verified. An update must be signed by the same identity as
  the installed application,
- how users are informed about changes to the project format before they
  update.

## Checklist for the first release

- [ ] Application icon
- [ ] macOS packaging
- [ ] Windows packaging
- [ ] `.koma` file association on both platforms
- [ ] Signing on both platforms
- [ ] Notarisation
- [ ] Release workflow
- [ ] Licences of dependencies in the application
- [ ] Tests of the installed application on both platforms
- [ ] Decision about update distribution
