# Studio editing and recovery

Build first and use the mock-provider workflow in `SKILL.md`. These specs use
isolated native Electron windows and synthetic files:

```powershell
pnpm --filter @koma-motion/desktop exec playwright test composer.spec.ts chatBrandKit.spec.ts canvas-editing.spec.ts inspector.spec.ts transitionWarnings.spec.ts projectHealth.spec.ts
```

- Composer: create a project, choose a model from the compact searchable list beside
  Brand Kit below the request. The header must have no provider/model selector.
  Verify provider logos, cross-provider search, CLI-reported Models before default rows, and Favorites chosen by the user. Stars remain visible without hover:
  outlined when unselected, filled when favorited. Check
  one-step Undo/Redo of the combined provider/model choice. Pinning favorites must
  persist across restart without adding project undo entries. Open Model options
  in the footer for provider details and custom IDs; the main list has no provider
  dropdown. Toggle Auto and verify keyboard navigation at a narrow chat width. The mock
  disclosure, reference attachment, instructions and Generate action must remain
  reachable in short windows.
- Model capabilities: run `modelCapabilities.spec.ts`. The harness replaces CLI
  discovery with synthetic responses (ordinary tests never query live CLIs).
  Verify selected-row expansion only for reported reasoning menus, native radio
  keys, per-model persistence across save/reopen, refresh/loading/failure and
  removed-choice warnings, unsupported discovery, and Text/Images navigation at
  300 pixels. CLI defaults and custom IDs must remain available. Protocol unit
  tests cover independent per-provider parsing and bounded child-process exchanges.
- Chat Brand Kit chooser: select a saved kit beside the model, check the current
  selection after Undo/Redo, generate with the mock and save the project. Exercise
  empty/damaged libraries and retry, long names, outside-click/Escape dismissal,
  and mutual exclusion with the model picker. Capture wide and 300-pixel panels.
  The chooser lists existing kits; editing and management stay in the library.
- Image generation: run `imageGeneration.spec.ts`. The Images tab offers Off,
  Codex and Grok Imagine through existing CLI sign-ins. Each CLI manages
  its image model; do not claim explicit image-model version selection. Verify
  independent text/image choices, narrow layout, project persistence, atomic
  image/assets Undo/Redo, failure and cancellation. `KOMA_MOCK_IMAGES` provides
  synthetic success/failure fixtures only in unpackaged builds with the mock
  presentation provider. It must never enable a live generation test. API keys
  are not forwarded by the image adapter. A live image run requires an explicit
  request; protocol/capability detection alone is not image-output coverage.
  Both initial and repair prompts must name the chosen image backend and tell
  the text agent to return `imageRequests` for the app to dispatch. Grok uses
  headless `image_gen`; only numbered images in the newly created CLI session
  may be imported. Test rejected paths, unrelated tool results, failures and
  cancellation with synthetic CLI peers. Grok retains its own session history.
- Canvas: open the fixture, select text and press Enter, type multiple lines,
  finish with Ctrl/Command+Enter, undo/redo, save and reopen. Escape discards a
  draft; invalid text retains its draft and prevents losing it on selection.
  Drag the selected element's rotation handle and verify its Inspector value,
  then verify Undo and Redo restore the previous and rotated angles.
- Inspector: switch Element, Koma and Motion tabs with keyboard and pointer;
  select hidden and covered elements from Layers; change visibility and lock;
  verify restacking and Undo. Hide chat when the narrow layout replaces Inspector.
- Motion: an edit can make stored motion stale. The Koma strip shows a compact
  status on that transition, between its source and destination Komas, with
  Regenerate transition. The explanation and links to both Komas are in the
  disclosure. Verify blocked playback, then use Recalculate motion in the
  Inspector to preserve timing locally or Regenerate transition to request new
  timing from the selected provider. Verify running, succeeded, failed and
  cancelled states, and that a failed or cancelled regeneration keeps both
  Komas. Unsupported future effects are skipped without labeling the entire
  transition blocked.
- Project health: open damaged or older fixtures, inspect format and asset issues,
  repair only the selected asset, and verify save-copy recovery. General project
  warnings live in Project health; transition status stays on the transition in
  the Koma strip.

Preserve screenshots and failure traces outside the worktree before cleanup.
Record actual native content dimensions and source commit. macOS uses different
native line-selection shortcuts and may clamp windows to the available screen;
assert observed dimensions rather than assuming a resize request was honored.
