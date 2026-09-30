# Studio editing and recovery

Build first and use the mock-provider workflow in `SKILL.md`. These specs use
isolated native Electron windows and synthetic files:

```powershell
pnpm --filter @koma-motion/desktop exec playwright test composer.spec.ts canvas-editing.spec.ts inspector.spec.ts transitionWarnings.spec.ts projectHealth.spec.ts
```

- Composer: create a project, choose provider/model/Koma count beside the request,
  toggle Auto, and verify values at a narrow chat width. The mock disclosure and
  Generate action must remain reachable in short windows.
- Canvas: open the fixture, select text and press Enter, type multiple lines,
  finish with Ctrl/Command+Enter, undo/redo, save and reopen. Escape discards a
  draft; invalid text retains its draft and prevents losing it on selection.
- Inspector: switch Element, Koma and Motion tabs with keyboard and pointer;
  select hidden and covered elements from Layers; change visibility and lock;
  verify restacking and Undo. Hide chat when the narrow layout replaces Inspector.
- Motion: an edit can make stored motion stale. Verify blocked playback and the
  warning, then use Recalculate motion to preserve timing locally or Regenerate
  transition to request new timing from the selected provider. Verify cancellation
  and edits while a request is in flight. Unsupported future effects are skipped
  without labeling the entire transition blocked.
- Project health: open damaged or older fixtures, inspect format and asset issues,
  repair only the selected asset, and verify save-copy recovery. General project
  warnings live in Project health; transition status remains visible by the canvas.

Preserve screenshots and failure traces outside the worktree before cleanup.
Record actual native content dimensions and source commit. macOS uses different
native line-selection shortcuts and may clamp windows to the available screen;
assert observed dimensions rather than assuming a resize request was honored.
