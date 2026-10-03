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
remain available for one-position moves. Stop transition preview before moving
a Koma with either control.

The native regression uses a 100-Koma deck with customised transitions and
per-Koma holds. It exercises metadata search, narrow-window keyboard focus,
first-to-last and reverse moves, a middle move, invalid positions, undo/redo,
and saving/reopening through the application file dialogs. Pure tests separately
check object identity and retained transition objects for unchanged edges.
