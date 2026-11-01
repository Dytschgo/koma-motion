# Quiet Stage design: twenty Opus refinement loops

This ledger records twenty sequential design loops on the Quiet Stage interface
with the chat on the right. It is separate from
[QUIET_STAGE_HILL_CLIMB.md](QUIET_STAGE_HILL_CLIMB.md), which covers an earlier
set of rounds.

- Branch: `feat/ui-journey-hill-climb` (PR #112), started at
  `0874c43a493ead3179eb474af3b1f4da75c51533` on base
  `f4cca6fe52e65e047922f859f71d11bf9f545da8`.
- Fixed decisions: chat stays on the right with the composer at its bottom,
  beside a dominant canvas with the numbered filmstrip and transition dots;
  warm off-white and coral; contextual object controls; optional, floating or
  pinned Properties; Recheck as the single recovery action.

## How these loops were checked

No application was built, launched or rendered on the development computer.
Each loop started from the baseline CI captures of the starting revision (the
20-pass evidence for `0874c43`) or from the source, and was checked by reading
the changed source and diff, Prettier and `git diff --check`. These are source
and format checks only. Twenty source loops are not twenty native runs.

Native behaviour, the updated assertions and rendered appearance of the new
revision are pending the hosted CI and UI-confidence runs on the pushed head.
No screenshot in this ledger shows the new revision.

## Starting critique

From the baseline captures (`conversation-right-sidebar.png`,
`properties-with-right-chat.png`, `failure-prompt.png`, `failure-summary.png`,
`recheck-button.png`, `pinned-properties.png`, `brand-picker-1120.png`) and the
user's Properties screenshot:

1. The user's own messages render without a bubble, as an indented paragraph
   that reads like stray text. The CSS used an undefined variable.
2. Properties in the top bar and Generation options in the composer use the
   same sliders icon, side by side at 1120 px.
3. Explanatory prose that has to be studied: Purpose and hold-duration hints,
   hidden and locked sentences that repeat their badges, a three-clause
   proposal paragraph, starter instructions on Welcome.
4. Failure is signalled up to three times (alert, banner and a red composer
   ring), Recheck sits below the diagnostics, and the collapsed summary sits at
   the far end of the sidebar from the composer.
5. Disabled clutter in empty states: a zoom cluster with nothing to zoom, two
   disabled filmstrip buttons, and the start card pinned near the top.

Direction: keep the identity and every capability, remove repetition and
prose, keep one recovery action in a stable place next to where the person
types, and show controls only when they can act.

## Loops

| Loop | Surface                    | Result                      |
| ---- | -------------------------- | --------------------------- |
| 1    | Chat transcript            | Implemented                 |
| 2    | Top bar icons              | Implemented                 |
| 3    | Properties header          | Implemented                 |
| 4    | Koma properties            | Implemented                 |
| 5    | Element properties         | Implemented                 |
| 6    | Inspector frame            | Implemented                 |
| 7    | Failure entry              | Implemented, test added     |
| 8    | Composer failure state     | Implemented                 |
| 9    | Collapsed failure summary  | Implemented, test added     |
| 10   | Finished run row           | Implemented                 |
| 11   | Selected-Koma proposal     | Implemented                 |
| 12   | Empty canvas               | Implemented, test added     |
| 13   | Empty filmstrip            | Implemented, test added     |
| 14   | Chat empty state           | No change                   |
| 15   | Generation options at 1120 | No change                   |
| 16   | Motion properties          | Implemented                 |
| 17   | Transition controls        | No change                   |
| 18   | Welcome                    | Implemented                 |
| 19   | Settings                   | No change                   |
| 20   | Self-review                | Implemented (fix to loop 6) |

Sixteen loops changed the interface; four were validation loops without a
change.

### 1. Chat transcript: the user's message had no bubble

- Before: `.chat-user-bubble` set `background: var(--chat-message-background)`,
  a variable defined nowhere, so the request rendered as an indented paragraph
  with no container (`conversation-right-sidebar.png`).
- Decision: a quiet paper bubble at the end of the column, up to 85 % wide,
  with a smaller end corner; agent replies stay plain. Forced colours draw its
  border.
- Changed: `styles.css` `.chat-message-user`, `.chat-user-bubble`, forced-colours
  block.
- Evidence: source and diff. Contrast of the reference line (`ink-400` on
  `paper-200`) is about 4.8:1 by calculation. Rendering pending CI.

### 2. Top bar: Properties looked like Generation options

- Before: `PropertiesIcon` in the top bar and `OptionsIcon` in the composer
  drew the identical sliders glyph for different features.
- Decision: Properties uses a window-with-side-panel glyph. Accessible name and
  tooltip stay "Properties".
- Changed: `TopBar.tsx` `PropertiesIcon`.
- Evidence: source and diff; no selector depends on the glyph.

### 3. Properties header: a repeated Brand Kit route

- Before: the header held Properties, a Brand Kit button with swatches, Pin and
  Close. The Brand Kit also opens from the project menu, from Edit Brand Kit in
  the colour popover and from the quick-start guide.
- Decision: remove the header button; the header keeps only Pin and Close. The
  project menu remains the keyboard route.
- Changed: `PropertiesPanel.tsx`; removed the unused `.properties-brand*` rules;
  updated `.agents/skills/verify-koma-motion/studio.md`.
- Evidence: `git grep` found no test, guide or script using the header button;
  `openBrandKit` in `e2e/application.ts` uses the project menu.

### 4. Koma properties: helper paragraphs and duplicated headings

- Before (user's screenshot): "What this Koma should make the audience
  understand", "Wait before the next transition. Saved with this Koma; used for
  autoplay and timed PowerPoint export", a "Presentation timing" heading, and
  "Background" and "Speaker notes" headings repeating their only field label.
- Decision: drop both hints, rename the section "Timing", and let `Section`
  render without a title for a single self-labelled field. Field labels stay
  because they are the accessible names (`holdTiming`, `recovery`).
- Changed: `KomaPanel.tsx`; `inspector/parts.tsx` `Section` (optional title).
- Evidence: source and diff; `getByLabel` selectors unchanged.

### 5. Element properties: hidden and locked said three times

- Before: a hidden element showed a warning-coloured eye, a Hidden badge and a
  sentence; a locked one a coloured lock, a Locked badge and a sentence. Groups
  carried two explanatory paragraphs.
- Decision: keep the coloured toggle and the badge; remove the hidden sentence;
  shorten locked to "Unlock to edit." (the object toolbar's wording); groups
  keep their count and one line, "Matching groups on neighbouring Komas move
  together."
- Changed: `inspector/ElementPanel.tsx`.
- Evidence: `groups.spec.ts` still finds "This group contains 2 elements."; the
  "Selected element:" headings are unchanged.

### 6. Inspector frame: cut-off groups and empty-state prose

- Before: with Layers open, the scrolling properties above it end abruptly; in
  the user's screenshot the Background heading appears to belong to Layers. The
  no-Koma state had two sentences.
- Decision: fade the scroller's edges only on a side that still has content,
  with a scroll timeline, and remove the second empty-state sentence. Forced
  colours removes the mask.
- Changed: `Inspector.tsx` (`inspector-scroll`), `styles.css`
  (`@property --inspector-fade-*`, `inspector-edges`, `.inspector-scroll`).
- Evidence: source review. Menus and tooltips are portalled, so the mask
  cannot clip them. Chromium supports `animation-timeline`; without it the
  scroller simply has no fade.

### 7. Failure entry: Recheck below the diagnostics

- Before: in a failed entry, Recheck came after the Details disclosure, so
  opening diagnostics pushed the recovery action down by their full length.
- Decision: Recheck directly under the message, Details after it.
- Changed: `AgentConversation.tsx` `Entry`.
- Test: `runMonitor.spec.ts` opens Details and checks that the enabled Recheck
  ends above the Details summary.

### 8. Composer: a third failure signal

- Before: after a failure the prompt pill took a coral border and glow in
  addition to the alert in the conversation or the summary above the prompt.
  The draft looked invalid when it was not.
- Decision: remove the ring. The alert, the summary with Recheck and the dot on
  the chat button remain.
- Changed: `AgentComposer.tsx` (`ComposerChat.failed`, `data-failed`),
  `PromptDock.tsx`, `styles.css`.
- Evidence: no test used `data-failed`.

### 9. Collapsed failure summary: far from the prompt

- Before (`failure-prompt.png`): with the chat hidden, the summary with Recheck
  sat at the top of the sidebar, the full height away from the composer where a
  typed "recheck" also works.
- Decision: auto margins place the summary directly above the composer. DOM and
  Tab order are unchanged.
- Changed: `styles.css` `.prompt-failure`, `.prompt-failure + .prompt-composer`.
- Test: `quietStage.spec.ts` checks the gap between the summary and the request
  field is between 0 and 48 px before it rechecks.

### 10. Finished run row: detached at the far edge

- Before: "Run details · 0:03" sat at the right edge, 1 rem below the reply, and
  read as a separate item.
- Decision: start it on the reply's edge, 0.5 rem below it.
- Changed: `styles.css` `.chat-run-finished`.
- Evidence: source and diff; `runMonitor`, `cancelRetry` and `uiJourney` use
  the unchanged accessible name.

### 11. Selected-Koma proposal: paragraph under a repeated heading

- Before (`recheck-button.png`): the card heading repeated the transcript's
  "Proposal ready", then "Applies to this Koma only. Its saved hold time and
  other Komas stay unchanged. Neighboring motion may need repair."
- Decision: "Only this Koma changes." Motion problems after applying still show
  on the filmstrip marker with its own repair.
- Changed: `ScopedProposal.tsx`.
- Evidence: the heading text asserted by `selectedGeneration.spec.ts` is
  unchanged.

### 12. Empty canvas: start card at the top, disabled zoom

- Before (`failure-summary.png`): the start card sat near the top of an empty
  desk and a zoom cluster with three disabled buttons floated at its corner.
- Decision: centre the card; render zoom only when there is a frame.
- Changed: `styles.css` `.studio-empty`; `Workspace.tsx` zoom group.
- Test: `komaPane.spec.ts` checks the zoom group is absent after deleting the
  last Koma and returns enabled after Undo.

### 13. Empty filmstrip: disabled actions

- Before: Add Koma had two permanently disabled neighbours, Koma actions and
  Deck overview.
- Decision: render them only when there are Komas. Deleting the last Koma
  already returns focus to Add Koma; a menu whose trigger is gone restores focus
  through `focusSelected`.
- Changed: `KomaStrip.tsx`.
- Test: `komaPane.spec.ts` checks both are absent without Komas and enabled
  after Undo, next to the existing focus assertion.

### 14. Chat empty state (no change)

- Inspected: mark, question, one example button and, for Mock without Komas,
  "Try the three-Koma demo."
- Result: no change. The demo line discloses that Mock always makes the same
  demo and `workflow.spec.ts` protects it.

### 15. Generation options at 1120 px (no change)

- Inspected (`brand-picker-1120.png`): Model truncates to "Mock pro…" beside the
  Brand Kit.
- Result: no change. Rebalancing the columns would truncate Brand Kit names
  instead; the full model is in the tooltip and accessible description, and the
  picker-within-sidebar fix stays as it is.

### 16. Motion properties: a permanent status box and a repeated heading

- Before: "Ready to play" sat in a green bordered box even when nothing needed
  attention; "Intent" repeated its single field "Why this motion".
- Decision: the ready state is one small line; only a problem gets the framed
  box and Fix motion. The single field keeps its label without a heading.
- Changed: `inspector/MotionPanel.tsx`.
- Evidence: the `Motion status` region and its texts asserted by
  `inspector.spec.ts` are unchanged.

### 17. Transition controls (no change)

- Inspected: navigation, play, restart, the scrubber with its minimum width,
  duration and Motion details; the reduced-motion note.
- Result: no change. The scrubber fix stays, and the reduced-motion note
  explains why previews cut; `narrowWindow` and `preview-identity` protect it.

### 18. Welcome: instructions under the starter heading

- Before: "Each starter adds a Brand Kit, instructions and a first request in
  chat. Choose a provider and send it." above cards that describe themselves.
- Decision: keep the heading and the cards.
- Changed: `Welcome.tsx`.

### 19. Settings (no change)

- Inspected (`settings-templates-1120.png`): page description plus a scope note.
- Result: no change. The note states where a setting is saved and whether Undo
  applies, which `settings.spec.ts` and `settingsPages.test.ts` protect.

### 20. Self-review, with one correction

- Found: keyboard focus scrolls a field to the edge of the Inspector scroller,
  inside the loop 6 fade, which weakened the visible focus.
- Fixed: `scroll-padding-block: 1.75rem` on `.inspector-scroll`.
- Reviewed without further change:
  - Duplicate actions and text: Brand Kit, failure signals and empty-state
    controls each now have one route.
  - Long labels: the bubble wraps anywhere and the summary wraps.
  - Focus order: unchanged DOM order for moved items; focus returns to Add Koma
    after the last Koma is deleted.
  - Hover, press, forced colours and reduced motion: no new hover rules, and
    the bubble border and mask removal apply in forced colours.
  - Generation, error and proposal states: the alert, Recheck, Details, Run
    details, Apply and Discard all remain.
  - Sizes: the changes either remove elements or position them inside existing
    containers.

## Pending native evidence

Coordinator review preserves the twenty-round count and accepts removing the
duplicate Brand Kit route from the Properties header. It also disables the
Inspector edge mask while a field has focus, so focused content and its outline
stay fully opaque even at a scrolled edge. The mask's black stops use the existing
OKLCH colour convention. These are follow-up review corrections, not extra Opus
rounds.

The Windows VM preflight also enables the existing visual-capture scenarios at
1480 × 920 and 1120 × 700, retaining clean captures and actual viewport metadata.
These captures remain separate from the twenty full functional UI runs.

- The full CI workflow and the UI-confidence workflow must pass on the pushed
  head before these loops count as accepted.
- New captures of the changed states must be inspected: chat bubble,
  Properties header and icon, Koma and Motion tabs, failure entry with Details
  open, collapsed failure summary, proposal card, empty canvas and filmstrip,
  and Welcome. Check them at 1480 × 920, 1120 × 700 and the narrow regression
  windows.
