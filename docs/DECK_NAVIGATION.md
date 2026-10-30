# Navigating a long deck

The left pane follows the familiar presentation-editor layout: numbered,
rectangular thumbnails and an outline around the current Koma. Drag its right
edge to resize the thumbnails, double-click the edge to reset, or drag toward
the left edge to collapse. The header's collapse button does the same; **Show
Koma thumbnails** restores the pane and focuses the selected Koma. Width,
visibility and the details toggle are remembered on this device, independently
of the project and its undo history.

With a thumbnail focused, Up/Down selects the previous/next Koma, and Home/End
selects the first/last. The selected thumbnail scrolls into view. Ctrl (Command
on macOS) + Up/Down moves it one place; add Shift to move it to the beginning
or end. Ctrl/Command + D duplicates it, preserving its title, content, notes and
hold time with new document IDs. Control + M adds a next frame after it
using the existing new-Koma defaults. Delete asks for confirmation. These
shortcuts apply to thumbnails, so editing text elsewhere keeps its usual keys.
On macOS, Command + M keeps its native Minimize action; use Control + M to add.

Right-click a thumbnail, press Shift+F10, or use **Koma actions** in the footer
for the same insert, duplicate, move and delete actions. Arrow keys navigate
that menu; Escape closes it and returns focus. Each document action is undoable.
The footer also keeps the move, delete, Add Koma and Brand Kit controls visible.

**Show Koma details** restores thumbnail titles and the transition timing and
preview rows between Komas. Motion warnings and their recovery actions remain
visible in compact mode. The resize divider also supports Left/Right (Shift
for larger steps), Home for minimum width and End for maximum width.

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

Dragging is an addition for pointer users. Keyboard users can also use the
thumbnail shortcuts, up/down controls or **Move to position**. The deck overview
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
