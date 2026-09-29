# PowerPoint export research

PowerPoint export is **not implemented**. Koma Motion contains an exporter
interface and a placeholder exporter that reports that export is not
available. The placeholder never writes a file.

This document lists what has to be investigated before an exporter can be
built. It separates what has been verified from what is assumed.

## Verified findings

Only findings that were tested in this project belong here.

| Finding                                                                                               | How it was verified                    |
| ----------------------------------------------------------------------------------------------------- | -------------------------------------- |
| The placeholder exporter returns the typed result `unsupported` and writes nothing to the destination | automated test in `packages/exporters` |
| The application shows the PowerPoint exporter as not available                                        | application test, settings dialog      |

**No finding about PowerPoint itself, about the file format or about any
library has been verified yet.**

## Assumptions to be tested

These statements are common knowledge or expectations. None of them has been
tested in this project. Each of them must be confirmed with a generated file
that is opened in PowerPoint on macOS and on Windows before it is relied on.

- A `.pptx` file is a ZIP package of XML parts that follows the Office Open
  XML standard.
- PowerPoint has a transition called Morph that animates objects between two
  consecutive slides.
- Morph matches objects across slides and offers a naming convention to force
  a match.
- Slides can advance automatically after a set time.

## Open research questions

### Editable PowerPoint generation

- Can every element type of the document model be written as a native,
  editable object: text as a text box, shapes as shapes, images as pictures?
- Which properties are lost or changed when the file is opened and saved in
  PowerPoint?
- Is a generated file accepted by PowerPoint without a repair prompt?

### Available open-source libraries

- Which libraries can write `.pptx` files from Node.js, and which are
  maintained?
- Which of them give access to transitions, object names and timing, and
  which only cover content?
- Is direct generation of the XML parts a realistic alternative, and how much
  of the standard would Koma Motion have to implement?

Candidates have to be evaluated before one is named here.

### Slide object positioning

- How do the logical units of the canvas (1920 x 1080 and 1440 x 1080) map to
  the units of a slide?
- Is the position of a rotated object defined in the same way: the top-left
  corner of the unrotated box, rotation around the centre?
- How are objects outside the slide handled?
- How is the drawing order (`zIndex`) expressed?

### Shape and text generation

- Which shape kinds have a direct counterpart: rectangle, rounded rectangle,
  circle, line?
- How is the corner radius of a rounded rectangle expressed?
- Does text wrap at the same positions as in the renderer of Koma Motion?
  Differences in font metrics can move line breaks.
- What happens when a font of the Brand Kit is not installed on the computer
  that opens the file? Can fonts be embedded, and may they be?
- How do font size, line height, alignment and vertical alignment map?

### Image embedding

- Which of the supported image types can be embedded without conversion: PNG,
  JPEG, WebP, GIF?
- How are `contain` and `cover` expressed? Is cropping needed?
- How is the corner radius of an image expressed?

### Native transition support

- Which transitions can be written to a file, and with which parameters?
- Can the duration of a transition be set, and in which range?
- Can easing be set for a slide transition?

### Object identity across slides

- How does PowerPoint decide that two objects on consecutive slides are the
  same object?
- Can `persistentId` be written in a form that controls this decision?
- What happens when the type of an object changes, as in a `replace`
  operation?

### PowerPoint Morph compatibility

- Can Morph be written to a file by a program, or only set in PowerPoint?
- Which operations of Koma Motion does Morph reproduce: move, scale, rotate,
  fade, colour change?
- How do entering and exiting objects behave under Morph?
- Does Morph support anything comparable to the `staged` strategy, in which
  objects leave, change and enter one after another?
- Which versions and licences of PowerPoint play Morph, and what do versions
  without it show?

### Timing and auto-advance

- Can slides advance automatically, and with which precision?
- What is the shortest time per slide that PowerPoint plays reliably?
- Does the timing behave the same in presenter view, in a window and in an
  exported video?

### Intermediate stop-motion frame generation

- How many intermediate slides per second are needed for motion to look
  continuous, and how many does PowerPoint play reliably?
- How do file size and loading time grow with the number of slides?
- How are intermediate slides kept out of the way when someone edits the
  exported presentation?
- How should the application warn before it generates a large number of
  slides?

See "Stop Motion Mode" in `MOTION_MODEL.md` for the concept.

### macOS PowerPoint behaviour and Windows PowerPoint behaviour

- Does the same file look and move the same in PowerPoint for macOS and
  PowerPoint for Windows?
- Which fonts are available on both?
- Are there differences in transitions, in timing or in text layout?
- How do other applications that open `.pptx` files behave, such as Keynote,
  Google Slides and LibreOffice Impress?

### Fallback strategies for unsupported effects

- What is exported when an operation has no counterpart: a cut, a fade, or
  intermediate slides?
- How does the application tell the user which effects were replaced, before
  and after the export?
- Is a fallback chosen per transition or for the whole presentation?

### Licensing implications

- Under which licences are the candidate libraries released, and are they
  compatible with the MIT licence of Koma Motion?
- Are there licence terms or patents that concern the file format or
  individual features?
- May fonts and images of a Brand Kit be embedded in an exported file?
- Which names and trademarks may the application and its documentation use?

## How to work on this

1. Pick one question.
2. Build the smallest file that answers it.
3. Open the file in PowerPoint on macOS and on Windows.
4. Record the result under "Verified findings", with the versions that were
   used and the way it was tested.

The issues "Research editable PowerPoint export" and "Prototype the
PowerPoint exporter" track this work.
