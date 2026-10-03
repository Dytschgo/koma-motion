# Presentation player

Entry: create a project, select Mock provider, Use the example request, Generate Komas. Wait for three buttons in the Komas list. Stale decks are written with `serialiseProject` and opened through the stubbed Open dialog.

```powershell
pnpm --filter @koma-motion/desktop exec playwright test presentation.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'
```

Set `KOMA_EVIDENCE_DIR` to a folder outside the checkout to keep screenshots of the player, the review, the halted prompt, the shortcuts and full screen. With `KOMA_SCREENSHOTS=1` they are taken at the real device scale.

Proof:

- **Present**, From the beginning, or F5. The player is a modal dialog named Presentation, separate from the editor's transition preview, which stays available after Escape.
- Keyboard: Right/Space/Page Down advance, Left/Page Up go back, Home and End, K pauses a transition (the stage must not change while paused), R replays the transition into the current Koma, Escape exits. Next during a transition arrives at once. Tab reaches every enabled control.
- From the selected Koma (Shift+F5) and autoplay with a 1 second time per Koma reaches the last Koma and stops with "End".
- Full screen: `BrowserWindow.isFullScreen()` becomes true after **Full screen** and false after Escape, when the window was not full screen before.
- Review: a stale transition after the start is listed by Koma numbers and titles. **Return to edit** selects its source Koma and shows the transition warning. **Present and cut across it** cuts across that step only; the stage never shows "Transition from" for it and Replay stays disabled.
- Halted: a stale step before a later start is not reviewed. Reaching it shows "The transition to Koma N cannot play"; Next does not cross it until **Cut to Koma N**.
- Edits: Ctrl+Z and Ctrl+Y while presenting change the position count without leaving a deleted Koma on screen; removing every Koma ends the presentation with a message. With no Komas, Present is disabled and F5 explains why.
- Reduced motion: emulate `prefers-reduced-motion`; transitions cut and the player says so.

The full-screen check uses the native window state. It was verified on Windows; macOS animates full screen into its own Space, so a slow runner can need the poll's full timeout. Playwright media emulation is not a test of the operating system setting.

Saved timing: run `holdTiming.spec.ts` with `presentation.spec.ts` and
`export-references.spec.ts`. Set explicit 1 s and 2.5 s holds in Inspector →
Koma, Undo/Redo, save a copy, and reopen. Check that global fallback remains
selected for untimed Komas. Autoplay must preserve the hold across pause/resume,
start each transition after the current hold, and remain at End. Reduced motion
changes only animation time. The export spec checks the global fallback field
and its resulting `advTm`; unit tests compare explicit holds to transition time.
