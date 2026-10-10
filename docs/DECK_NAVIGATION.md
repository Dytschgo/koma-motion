# Navigating a long deck

Open **Deck overview** above the Koma strip to find a Koma by its number, title
or purpose. Search terms are matched together, ignoring case. Result numbers
always refer to the full deck. Filtering the overview does not change the deck
or imply a transition between the filtered results.

The search field receives focus when the overview opens. Press Enter to select
the first match, or Arrow Down to focus the results. Arrow Up and Arrow Down
move through the results; Home and End reach the first and last match. Enter
selects a focused Koma and reveals it in the strip. Escape closes the overview
and returns focus to its button without changing the current selection.

To reorder the selected Koma, enter a whole number in **Move to position** and
choose **Move Koma**. Positions run from 1 to the deck's Koma count. Invalid
positions and the current position do not change the document. Each move is
one undo step, preserves the selected Koma's identity, content and hold timing,
and reconnects motion only where adjacency changes. Existing adjacent pairs
keep their stored transition IDs and settings. The strip's up/down controls
remain available for one-position moves, including during preview. A move that
changes the previewed pair cancels that preview. Stop transition preview before
using the overview's direct-position form.

## Dragging in the Koma strip

Any Koma in the strip can also be dragged to a new place with the mouse. A
press becomes a drag after a few pixels of movement, so a click still selects
the Koma. While dragging, the Koma is dimmed and a bar marks the gap it will
drop into; no bar is shown where dropping would leave the order unchanged.
Holding the pointer near the strip's top or bottom edge scrolls the strip in
that direction, so a Koma can reach positions that are off screen, including
in the 1120 x 668 window used by CI.

Dropping applies the same move as the up/down controls and **Move to
position**: one undo step, the same transition handling, and the same
unsaved-changes state. The dropped Koma becomes the selected Koma. Dropping a
Koma beside itself, pressing Escape during the drag, or losing the pointer
changes nothing and records no undo step. A polite live region announces the
result, for example "Koma 2 moved to position 1." or "Move cancelled.".

Dragging is an addition for pointer users. Keyboard and screen-reader users
reorder with the up/down controls or **Move to position**. The deck overview
does not support dragging, because its results can be filtered and their
numbers refer to the full deck.

The native regression (`e2e/komaDrag.spec.ts`) runs in the small window. It
drags a Koma upwards, checks the indicator, order, selection, announcement and
unsaved state, undoes and redoes, cancels with Escape, drops in place, holds a
drag at the strip's edge until it scrolls, mixes a drag with the move buttons,
and saves. Pure tests cover the gap and offset geometry, edge scrolling and
announcements, and check that a drop matches the equivalent position move.

The native regression uses a 100-Koma deck with customised transitions and
per-Koma holds. It exercises metadata search, narrow-window keyboard focus,
first-to-last and reverse moves, a middle move, invalid positions, undo/redo,
and saving/reopening through the application file dialogs. Pure tests separately
check object identity and retained transition objects for unchanged edges.
