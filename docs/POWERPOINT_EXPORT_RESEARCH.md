# PowerPoint export: implementation and evidence

Koma Motion exports editable `.pptx` slides. The application offers static
slides, slide fades and PowerPoint Morph for eligible continuous Koma
transitions. The export is a separate file; it does not change the `.koma`
project. This document distinguishes generated-file checks from a manual test
in PowerPoint.

## Current implementation

`packages/exporters` writes one slide per Koma. Text boxes, rectangles,
rounded rectangles, circles, lines and supported embedded pictures are native
PowerPoint objects. It preserves slide order, object stacking, editable text,
supported image data, slide background and speaker notes. A group's visible
children become separate editable objects. Objects continuing across Komas use
the same `!!` name derived from their persistent identity. Microsoft documents
that naming scheme for forcing Morph matches between slides in its
[Morph tips](https://support.microsoft.com/en-gb/powerpoint/morph-transition-tips-and-tricks).

Static export omits Koma motion. Fade export adds a slide transition. Morph
export uses Morph for continuous transitions that pass the motion engine's
stored-motion validation and have no replace, fade-in or fade-out operation;
other transitions use a slide fade. Stale or structurally invalid stored motion
produces a warning and a default 500 ms slide fade, with 500 ms automatic
advance when requested. Static slides remain exportable. The exporter does
not regenerate or change the stored motion. The file carries a
fade fallback for readers that cannot use its Morph extension. Optional
automatic advance uses a playable stored transition's duration; without it the slides
advance by click. The exporter validates before writing, returns warnings for
known losses and writes through a temporary file so a failed export does not
replace the destination.

Warnings cover unsupported or missing images, rounded image corners, font
weight approximation, flattened groups, unequal group scaling, omitted static
motion, invalid stored motion, Morph compatibility and transitions that fall back to fade. Unequal
group scaling may alter text, strokes or rotation. WebP assets become
placeholders. PowerPoint's fonts and layout may differ from the Koma canvas.
Easing, staged timing and per-element fades are not preserved. Morph is an
approximation of the Koma
motion engine, not an export of its exact frames or choreography.

Embedded image verification is reused by fidelity warnings and object
placement within one export. The cache holds only referenced project assets
and is discarded after that request. Missing or corrupt images still produce
a warning and placeholder for each placement; later exports verify assets
again.

The versions exercised in this prototype are locked in `pnpm-lock.yaml`:

| Library    | Version | Licence                                 | Role                                        |
| ---------- | ------- | --------------------------------------- | ------------------------------------------- |
| PptxGenJS  | 4.0.1   | MIT                                     | Native editable PowerPoint objects          |
| JSZip      | 3.10.2  | MIT or GPL-3.0-or-later; used under MIT | Add transition XML to the generated archive |
| image-size | 2.0.4   | MIT                                     | Inspect embedded image dimensions           |

PptxGenJS fits the existing TypeScript/Node main process and produces editable
objects without requiring an Office installation. Its [shape API](https://gitbrent.github.io/PptxGenJS/docs/api-shapes/)
and [text API](https://gitbrent.github.io/PptxGenJS/docs/api-text/) describe the
object properties. Position and corner-radius values are converted to inches;
font and stroke sizes are converted to points. Tests cover drawing order,
zero and nonzero corner radii, and text scaled within a group. This is a
verified implementation choice, not a benchmark of all available libraries.

The writer uses `pptxgenjs` for editable objects and adds transition XML to
the package. Microsoft's [Morph transition specification](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/41ca8fbf-efc8-49ac-8a32-7bd0856544bd)
describes the Morph element used here. Package and XML assertions test the
output structure; they do not prove how every PowerPoint version renders it.

## Verified in Windows PowerPoint

On **2026-10-01**, a generated three-slide fixture was opened in **Windows
PowerPoint 16.0.20430.20092** without a repair prompt. Native text was edited
from “Presentations” to “Editable slides”, and a circle was moved. The result
was saved as a separate `windows-edited-roundtrip.pptx`, closed and reopened;
the edits remained. PowerPoint showed slide 2 with Morph duration **0.90 s**
and advance after **1.20 s**, and slide 3 with Morph duration **1.20 s** and
click advance. In Slide Show, automatic advance reached the final slide.

The local evidence for that manual check is under
`D:\Code\KomaMotion-evidence\export-references-20261001\powerpoint-worker`
(generated and edited decks plus timing and final-slide screenshots). These
files are review evidence, not release assets. This test establishes that the
fixture was accepted, editable, saved and playable in that Windows version.
It does not establish pixel or font equality, exact Koma choreography or
behavior in every deck.

**macOS PowerPoint has not been tested with this exporter.** Microsoft lists
Morph support on Mac in its [PowerPoint Morph guidance](https://support.microsoft.com/en-us/powerpoint/use-the-morph-transition-in-powerpoint-for-mac-ipad-and-iphone),
but that is not a verification of a Koma-generated file. Keynote, Google
Slides, LibreOffice Impress and older PowerPoint versions are also unverified.

## Remaining work

- Compare text wrapping, fonts, image fitting, rotation and rounded corners
  against the Koma canvas using representative decks and installed fonts.
- Verify generated files and edit/save/reopen behavior in PowerPoint for macOS
  and other readers. Record product versions with each result.
- Measure how each Koma operation appears under Morph, particularly colour
  changes and object entry and exit. Do not infer exact choreography from the
  presence of a Morph transition.
- Test large decks, media combinations, file size and export time. Investigate
  font embedding only with a clear licensing and fidelity case.
- Research a separate Stop Motion Mode if exact intermediate frames become a
  product requirement; it is not part of this exporter.

The [export and reference verification guide](../.agents/skills/verify-koma-motion/export-references.md)
records the checks to run and the limits of each check.
