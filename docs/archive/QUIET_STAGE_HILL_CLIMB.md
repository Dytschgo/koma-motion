# Quiet Stage: 20 improvement rounds

Baseline: `80def01fbc67a406bccdbd1644a11b97ef7410da`. These rounds refine the approved canvas-first interface. Each round inspected one interaction, made a bounded correction, and checked its source preconditions. Native verification runs on the combined revision through hosted CI; these are not 20 claims of separate native runs.

| Round | Improvement                                                                         |
| ----- | ----------------------------------------------------------------------------------- |
| 1     | Open menus upward with ArrowUp and focus the last enabled action                    |
| 2     | Jump to menu actions by typing their first letter                                   |
| 3     | Dismiss anchored menus when the surrounding workspace scrolls                       |
| 4     | Dismiss menus when the application loses focus                                      |
| 5     | Close an open menu when its triggering action becomes unavailable                   |
| 6     | Focus colour and geometry popovers only after they become visible                   |
| 7     | Close toolbar popovers safely when the window is resized                            |
| 8     | Dismiss toolbar popovers when their canvas scrolls without blocking popup scrolling |
| 9     | Let Tab leave a toolbar popover without leaving a stale panel open                  |
| 10    | Do not offer outgoing object motion on the final Koma                               |
| 11    | Clear object popovers when transition playback starts                               |
| 12    | Clear object popovers when a canvas drag begins                                     |
| 13    | Associate toolbar colour and size triggers with their actual dialogs                |
| 14    | Expose the selected object colour value without opening Properties                  |
| 15    | Clear the failed indicator when the inline failure is dismissed                     |
| 16    | Escape closes generation options and returns focus to the request                   |
| 17    | Expose the Enter-to-generate shortcut on the send action                            |
| 18    | Keep actionable recovery instructions visible instead of truncating them            |
| 19    | Make palette swatches easier to select with touch or a trackpad                     |
| 20    | Keep colour and geometry popup contents reachable in short or zoomed windows        |

Regression coverage lives in `apps/desktop/e2e/quietStage.spec.ts`. It exercises menu entry and letter navigation, focus loss and canvas scrolling, object-popup focus and dismissal, outgoing motion availability, recovery dismissal with retained history, and Escape from generation options. Existing colour, geometry, preview, scope, save/reopen and provider fixtures run alongside it.

The final PR check results determine acceptance. Live providers remain opt-in. No native app, build or test workload is run on the user's PC.
