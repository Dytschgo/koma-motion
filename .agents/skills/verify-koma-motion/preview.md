# Preview controls

Entry: create a project, select Mock provider, Use the example request, Generate Komas. Wait for three buttons in the Komas list.

```powershell
pnpm --filter @koma-motion/desktop exec playwright test preview-identity.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'
```

Proof: scrub Position in the transition to 50 percent, then remove its transition with Undo. The Canvas stage must show the selected Koma at rest, the slider must return to 0 percent, and keyboard focus must survive. Also exercise deletion, reordering, paused duration edits with Undo/Redo, and scrubbing during playback.

The existing duration-edit spec starts paused; it is not evidence for changing duration during active playback. That claim needs a separate check while Pause is visible and progress is advancing.

Repeat the affected path with reduced motion. In an Electron test, set the native BrowserWindow size through the existing application's main-process handle and emulate `prefers-reduced-motion`. Check 1120 and 1280 pixels wide as well as the default 1480. The slider must have a positive usable width and accept keyboard and pointer input. Do not force input into a zero-width control or enlarge the window to conceal a failure. Capture the narrow rendered layout before teardown.

Playwright media emulation verifies the app's response to the preference. It does not prove that changing the OS accessibility setting was tested.
