# Direct element authoring

Create a project and choose **Add first Koma**, or select an existing Koma.
In the canvas toolbar, choose Text, Rectangle, Circle or Line and choose
**Add**. This works without generating a presentation or signing in to a
provider. **Add image** continues to import an image from a local file.

New objects appear in the centre of the canvas, in front of existing layers,
and are selected. Text uses the current Brand Kit's body font and text colour;
shapes and lines use its primary colour. These values are copied into each
object. Changing the kit supplies defaults for later objects and future
generation; it does not restyle objects already in the presentation.

Each addition is one undo step, and Redo restores the same object identities.
Saving and reopening retains the objects and their styling. Creation observes
the element count and project safety budgets; a failed addition leaves the
document unchanged and shows an error.

Selecting an object on the canvas or in Layers opens its precise controls in
the **Inspect** tab. The toolbar's **Inspect** action also opens properties for
the current Koma without an object selected. **Chat** and **Inspect** share one
resizable dock at every window size; switching tabs keeps the canvas width,
chat draft and history. Selecting another Koma keeps the active dock tab.
Collapse the dock for more canvas room, then use **Show the chat** or **Show
Inspect panel** to return. Locked elements retain their existing edit limits.

## Selecting several elements

Shift-click or Ctrl/Command-click an object on the canvas or a row in Layers
to add it to the selection or remove it again. With the keyboard, press
Shift+Enter or Shift+Space on a focused canvas object or layer row. All
selected objects are outlined; handles and text editing need a single
selection. The Inspector lists the selection and offers **Group**. A plain
click, another Koma or a preview returns to a single selection.

## Groups

Select two or more elements of one Koma and choose **Group** in the canvas
toolbar or the Inspector, or press Ctrl/Command+G. The group is selected and
the Inspector shows it with its children. Select a group and choose
**Ungroup**, or press Ctrl/Command+Shift+G, to dissolve it; its former
children are selected. Each is one undo step.

- Nothing moves on the canvas. The group's box is the bounding box of what
  its children draw, including rotation, and its children keep their size,
  rotation and styling.
- The group takes the stacking place of its frontmost child, and the
  children keep their order within it. Objects that were between the grouped
  ones in the stacking order end up behind the group.
- Ungrouping applies the group's position, size, rotation and opacity to its
  children and puts them in the group's stacking place. A group with unequal
  horizontal and vertical scaling can only be dissolved approximately: text,
  strokes and corner radii use the smaller scale, and rotated children are
  not skewed. Group opacity is multiplied into each child, so overlapping
  translucent children can look slightly different.
- Locked elements cannot be grouped and a locked group cannot be dissolved.
  Groups cannot contain groups, and a group holds up to 200 elements.
- Children keep their identities, and the group's identity follows from its
  children. Grouping recomputes the motion to and from this Koma: see
  [Groups created in the application](MOTION_MODEL.md#groups-created-in-the-application).
- Saving and reopening keeps groups. The project format is unchanged:
  groups were already part of it.

Generation does not offer groups to agents yet.

## Motion

Direct creation, like other visual edits, leaves stored motion unchanged.
Review the resulting motion warning and choose **Fix motion** when
you want to update it. Creation never regenerates motion silently. Grouping
and ungrouping are the exception: like deleting an element, they change which
objects the Koma has, so the transitions on both sides are recomputed and stay
playable. Stop an active preview before adding, grouping or inspecting
elements.

Verification: `groups.spec.ts` selects on the canvas and in Layers, groups
with the keyboard, checks the Inspector, drawn positions and playable motion,
undo/redo, save/reopen, and ungroups with the Inspector and the keyboard in
the 1120 x 668 window used on CI. `grouping.test.ts` in `core`,
`motion-engine` and the desktop state cover geometry, stacking, identities,
motion and undo. `direct-authoring.spec.ts` exercises blank creation, all four
kinds, selection, undo/redo, real save/reopen through stubbed native dialogs,
narrow pointer/keyboard Inspector access, draft/focus preservation, and
explicit motion repair. `authoring.test.ts` covers Brand Kit defaults on both
supported aspect ratios, identities, z-order boundaries, validation and the
visual command contract. Mock tests do not verify real provider generation,
OS file-dialog operation or screen-reader behavior.
