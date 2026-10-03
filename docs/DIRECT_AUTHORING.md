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

Choose **Inspect** after selecting an object on the canvas or in Layers to
open its precise controls. In a narrow window, this collapses the chat to make
room for the Inspector. The Inspect button keeps keyboard focus. **Show the
chat** returns to the retained draft. In a wide window, both panels remain
visible. Locked elements remain inspectable, with their existing edit limits.

Direct creation, like other visual edits, leaves stored motion unchanged.
Review the resulting motion warning and choose **Recalculate motion** when
you want to update it. Creation never regenerates motion silently. Stop an
active preview before adding or inspecting elements.

Verification: `direct-authoring.spec.ts` exercises blank creation, all four
kinds, selection, undo/redo, real save/reopen through stubbed native dialogs,
narrow pointer/keyboard Inspector access, draft/focus preservation, and
explicit motion repair. `authoring.test.ts` covers Brand Kit defaults on both
supported aspect ratios, identities, z-order boundaries, validation and the
visual command contract. Mock tests do not verify real provider generation,
OS file-dialog operation or screen-reader behavior.
