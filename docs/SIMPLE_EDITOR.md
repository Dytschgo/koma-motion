# Simpler editor

This pass builds on the integrated editor in PR #112. It follows the request to
reduce duplicated controls, make common styling visual, and recover from failed
generation with one action.

## Research

Official guides consulted on 31 October 2026:

- [Gamma: adding and editing content](https://help.gamma.app/en/articles/11016385-where-do-i-start-when-adding-content-in-gamma): contextual editing and scoped agent requests. Koma keeps its canvas central and preserves the original scope when rechecking.
- [Pitch: slide styles](https://help.pitch.com/en/articles/4059534-create-your-own-slide-style): shared style defaults with a visual picker and optional exact color values. Koma now shares one picker across Brand Kit editing, review, and element/background controls.
- [Canva: Magic Design](https://www.canva.com/help/use-magic-design/): request-first generation with attachments and brand context beside the prompt. Koma retains these choices in the composer instead of duplicating model editors in Settings.

These are documented product patterns, not authenticated hands-on tests or a
claim that Koma implements their complete workflows.

## Decisions

| Surface              | Problem                                                                            | Result                                                                                  |
| -------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Models               | Editable in Chat and Settings                                                      | Chat owns the editor; Settings opens that same chooser                                  |
| Cancellation         | Stop in the composer and Cancel in the same chat                                   | One Stop control; the separate modal retains Cancel run                                 |
| Koma properties      | Add action and motion shortcut repeated navigation                                 | Use the Koma menu and Motion tab                                                        |
| Motion properties    | Preview repeated the main Preview action                                           | Use Preview in the main toolbar                                                         |
| Element details      | Raw layer number repeated stacking controls; persistent IDs exposed implementation | Keep visual stacking controls; remove the numeric layer and internal-ID section         |
| Colors               | Passive swatches and mandatory hex typing                                          | Shared visual picker fills the hex field; exact typing and validation remain            |
| Background and notes | Common fields folded away                                                          | Both directly visible in Koma properties                                                |
| Stopped run          | User cancellation styled as an error and repeated its message                      | Neutral status, one title, optional diagnostics                                         |
| Generation recovery  | Retry used current scope/count, potentially targeting another Koma                 | Recheck restores the original request scope/count and uses current consented references |
| Project health       | Repairable motion reported without a direct repair                                 | Fix motion rebuilds eligible invalid transitions together; one Undo restores them       |

## Recovery boundaries

The follow-up pass removes the repeated terminal status beside Run details.
Unusable generated output gets a short recovery instruction; the full original
error, validation issues and provider output stay together under Diagnostics.
Provider connection and sign-in messages remain in the summary when relevant.

Generation time limits use named minute/hour choices, with No limit as the
default. Existing exact values remain selected until the user changes them.
Changing a limit takes one undo step. The composer shows a short limit link that
opens this same setting.

Recheck retries generation; the provider runtime still validates output and may
perform its existing correction pass. Selected-Koma results still require Apply.
A run in progress or a pending proposal blocks another generation. Rechecks never
reuse detached reference text or skip external-provider consent. The retry uses
the current provider so the user can switch away from an unavailable one.

With no failed request, the chat command checks local document health and repairs
rebuildable invalid motion. It leaves unsupported effects and unresolved file or
asset problems visible. A missing original target requires a new request.
Provider authentication and missing source files still require user input; this
interface does not claim it can repair arbitrary provider code.

## Verification

The existing checks cover project editing, undo, save/reopen, generation,
cancellation, model discovery, consent and proposal review. Added checks cover
color picker/hex/undo behavior at 1120 x 700, button and typed Recheck after a
selection/scope change, and one-action motion repair with one-step Undo.
Pure tests cover command parsing, original scope/count, removed targets,
detached references, and preservation of content and valid motion.

Native evidence comes from hosted Windows/macOS CI. The OS color chooser itself
is not automated: tests drive its color input and observe document bindings.
Live-provider runs remain opt-in. Reports, skips, retries and final screenshots
must be inspected before calling the revised head verified.
