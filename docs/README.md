# Documentation

Start with the [README](../README.md) for what Koma Motion is and with
[ARCHITECTURE.md](../ARCHITECTURE.md) for how the code is organised.
[CONTRIBUTING.md](../CONTRIBUTING.md) and [SECURITY.md](../SECURITY.md) cover
contributions and vulnerability reports.

## Using the product

| Document                                                          | Contents                                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [Direct authoring](DIRECT_AUTHORING.md)                           | adding text, shapes and images by hand, multiple selection, groups                 |
| [Simpler editor](SIMPLE_EDITOR.md)                                | decisions that removed duplicated controls: one colour picker, Recheck, Fix motion |
| [Deck navigation](DECK_NAVIGATION.md)                             | the Koma pane and the searchable overview of a long deck                           |
| [Selected Koma proposals](SELECTED_KOMA_GENERATION.md)            | generating one Koma and applying or discarding the proposal                        |
| [Brand Kit from a deck](BRAND_KIT_FROM_DECK.md)                   | proposing a Brand Kit from a PPTX or PDF; formats, privacy, limits                 |
| [Brand profile from references](BRAND_PROFILE_FROM_REFERENCES.md) | proposing a Brand Kit and instructions from attached brand material                |
| [Brand Kit library logos](LIBRARY_LOGO_VALIDATION.md)             | how saved logos are validated and what happens to a corrupt one                    |
| [Project health](PROJECT_HEALTH.md)                               | asset and motion issues, and the repairs the panel offers                          |
| [Crash recovery](CRASH_RECOVERY.md)                               | the recovery snapshot, its lifecycle and limits                                    |
| [Generation limits](GENERATION_LIMITS.md)                         | technical safety boundaries of requests, output, files and rendering               |

## Format and model

| Document                                       | Contents                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------- |
| [Project format](PROJECT_FORMAT.md)            | the `.koma` file, schema versions, migrations and compatibility     |
| [JSON Schema](schema/koma-project.schema.json) | the generated schema of the project format                          |
| [Motion model](MOTION_MODEL.md)                | canvas, persistent identity, operations, strategies and diagnostics |

## Agents

| Document                              | Contents                                                                    |
| ------------------------------------- | --------------------------------------------------------------------------- |
| [Agent providers](AGENT_PROVIDERS.md) | the provider contract, the CLI providers, what was verified, and live tests |

The guides agents use to verify the native application are in
[`.agents/skills/verify-koma-motion`](../.agents/skills/verify-koma-motion/SKILL.md).
[Multi-agent development](MULTI_AGENT_WORKFLOW.md) describes worktrees for
parallel work on this repository.

## Releases

| Document                | Contents                                                                  |
| ----------------------- | ------------------------------------------------------------------------- |
| [Releases](RELEASES.md) | installing, the stable and nightly channels, updates, publishing, signing |

The [changelog](../CHANGELOG.md) lists what each version changed.

## Plans and research

| Document                                           | Contents                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------- |
| [Implementation plan](IMPLEMENTATION_PLAN.md)      | the first milestone, current limitations and the next milestones      |
| [PowerPoint export](POWERPOINT_EXPORT_RESEARCH.md) | how the exporter works, what PowerPoint was verified to do, and gaps  |
| [Stop-motion frames](STOP_MOTION_RESEARCH.md)      | research for Stop Motion Mode; nothing in it is implemented           |
| [Asset packages](ASSET_PACKAGES.md)                | design for projects with separate asset files; nothing is implemented |

## Screenshots

[`screenshots/`](screenshots) holds the captures the README shows.
`apps/desktop/e2e/screenshots.spec.ts` writes into this folder.

## Archive

Records of finished work. They describe the revision they were written for and
are not kept up to date.

| Document                                                                      | Contents                                                       |
| ----------------------------------------------------------------------------- | -------------------------------------------------------------- |
| [Quiet Stage: 20 improvement rounds](archive/QUIET_STAGE_HILL_CLIMB.md)       | interaction corrections of the canvas-first interface          |
| [Quiet Stage design loops](archive/QUIET_STAGE_DESIGN_OPUS_ROUNDS.md)         | twenty design loops with the chat on the right (PR #112)       |
| [Brand Kit from deck](archive/verification/brand-kit-from-deck/README.md)     | Windows verification report with captures                      |
| [Brand profile](archive/verification/brand-profile-from-references/README.md) | Windows verification report with captures                      |
| [Deck workspace](archive/verification/deck-workspace/README.md)               | verification and performance measurements of the deck overview |
| [Quick-start guide](archive/verification/quick-start-guide/README.md)         | verification report with captures                              |
| [Presentation player](archive/verification/presentation-player)               | captures of the player; there is no written report             |
