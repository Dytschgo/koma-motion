# Motion model

Koma Motion treats a presentation as a sequence of visual states. This
document describes how those states are laid out, how objects keep their
identity, how motion is derived and how it is played.

The code lives in `packages/core` (the model) and `packages/motion-engine`
(diffing, validation and interpolation).

## Coordinate system

Every Koma is laid out on a **fixed logical canvas**.

| Aspect ratio | Logical canvas |
| ------------ | -------------- |
| 16:9         | 1920 x 1080    |
| 4:3          | 1440 x 1080    |

- The origin is the top-left corner. `x` grows to the right, `y` grows
  downwards.
- The `position` of an element is the top-left corner of its **unrotated**
  bounding box. `size` is the width and height of that box.
- `rotation` is measured in degrees, clockwise, around the centre of the box.
- Font sizes, stroke widths and corner radii use the same logical units.
- Elements may be partly or completely outside the canvas. Coordinates are
  limited to the range -20000 to 20000.
- `zIndex` decides the drawing order. Higher values are drawn in front.

### Why a fixed logical canvas

The alternative would have been normalised coordinates from 0 to 1. A fixed
canvas was chosen for these reasons:

- **Responsive rendering.** The renderer draws the canvas at its logical size
  and applies one scale factor. Nothing is laid out again when the window
  changes size, so a Koma looks the same at every size.
- **Consistent interpolation.** Positions, sizes and font sizes share one unit.
  An object that moves 100 units and grows by 100 units does so in the same
  visual proportion. With normalised coordinates, horizontal and vertical
  values would mean different distances.
- **Exporter mapping.** Presentation formats use absolute units on a page of
  known size. Mapping from a fixed canvas is one multiplication.
- **Predictable positioning.** Whole numbers such as `x: 96` are easier to
  read, to write and to review than fractions, for people and for agents.
- **Aspect ratio preservation.** The canvas size is derived from the aspect
  ratio of the presentation, so content cannot be stretched.

## Elements

| Type    | Content                                             | Style                                                                                   |
| ------- | --------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `text`  | plain text                                          | font family, font size, font weight, colour, alignment, vertical alignment, line height |
| `shape` | `rectangle`, `roundedRectangle`, `circle` or `line` | fill, stroke, stroke width                                                              |
| `image` | the id of an asset of the project and a description | fit (`contain` or `cover`), corner radius                                               |
| `group` | child elements in a local coordinate space          | none                                                                                    |

Notes:

- A `circle` fills its box, so a box that is not square produces an ellipse.
- A `line` runs from the middle of the left edge to the middle of the right
  edge of its box. Other directions use `rotation`.
- A `group` positions its children relative to its own top-left corner, in a
  space of `referenceSize`. When the size of the group differs from
  `referenceSize`, the children are scaled with it. Groups cannot be nested.
- Colours are stored as six-digit uppercase hex values such as `#FF7A59`.
  Transparency is expressed through `opacity`.

## Persistent identity

Every element has two identifiers:

- `id` identifies one element in one Koma.
- `persistentId` identifies a **visual object across Komas**.

Two elements in different Komas that share a `persistentId` are the same
object in two states. Example:

```text
Koma 1   element "el-a"  persistentId "motion-engine"  circle  200 x 200 at (1228, 540)
Koma 2   element "el-b"  persistentId "motion-engine"  circle  400 x 400 at (760, 380)
```

The motion engine reads this as one retained object that changes position and
size. It does not read it as one object that disappears and another that
appears. Within one Koma every `persistentId` is unique.

Adding a Koma in the application copies the selected Koma and keeps every
`persistentId`, because a new Koma is the next state of the same objects.

## Transitions

A transition connects two adjacent Komas:

| Property             | Meaning                                            |
| -------------------- | -------------------------------------------------- |
| `fromKomaId`         | the source Koma                                    |
| `toKomaId`           | the target Koma, which follows the source directly |
| `strategy`           | `continuous` or `staged`                           |
| `duration`           | milliseconds, 100 to 10000                         |
| `easing`             | `linear`, `easeIn`, `easeOut` or `easeInOut`       |
| `elementTransitions` | what happens to each object                        |
| `rationale`          | a concise, visible reason for the choreography     |

### Operations

| Operation      | Meaning                                                            |
| -------------- | ------------------------------------------------------------------ |
| `hold`         | the object does not change                                         |
| `move`         | the position changes                                               |
| `scale`        | the size changes                                                   |
| `rotate`       | the rotation changes                                               |
| `fadeIn`       | the opacity rises, or the object enters (`from` is `null`)         |
| `fadeOut`      | the opacity falls, or the object exits (`to` is `null`)            |
| `colourChange` | fill, stroke or text colour changes                                |
| `replace`      | content or a style that cannot be interpolated changes: cross-fade |

One object can have several operations, for example `move` and `scale`. Each
operation stores the state before and after, limited to the properties it
changes.

### How the motion engine derives operations

`diffKomas(from, to)` works in these steps:

1. Check both Komas for duplicate persistent ids and validate them.
2. Index the visible top-level elements of both Komas by `persistentId`.
3. Objects in both Komas are **retained**, objects only in the target
   **enter**, objects only in the source **exit**.
4. For retained objects compare position, size, rotation, opacity and colours.
   Differences below 0.001 units count as no change.
5. A change of type, content or of a style that cannot be interpolated (for
   example the text or the font size) becomes `replace`.
6. Objects without any change get `hold`.
7. Operations are sorted by `persistentId` and then by a fixed order.

The result is deterministic: the same two Komas always produce the same
operations in the same order, whatever the order of the elements is.

Invisible elements do not take part. The children of a group move with their
group and are not compared individually.

### What agents decide and what the application decides

An agent suggests `strategy`, `duration`, `easing` and `rationale`. The
application:

- always computes the element operations itself,
- replaces unsupported strategies and easings with the defaults,
- limits the duration to the supported range,
- reports every adjustment as a warning.

After every change to a Koma or to the order of the Komas, `syncTransitions`
recomputes the operations. Settings and rationale of existing transitions are
kept.

### Strategies

`continuous` animates every object across the whole duration.

`staged` divides the duration:

| Role               | Part of the duration |
| ------------------ | -------------------- |
| objects that exit  | 0% to 40%            |
| retained objects   | 20% to 80%           |
| objects that enter | 60% to 100%          |

## Playback

`computeFrame({ from, to, transition, progress })` returns what is visible at
a progress between 0 and 1.

- At progress 0 the frame is exactly the source Koma. At progress 1 it is
  exactly the target Koma.
- A stored transition that fails a semantic check is reported and is not
  played. The file is not rewritten: the project still opens, and the stored
  operations stay as they were written. For that transition, any progress
  below 1 shows the source Koma and progress 1 shows the target Koma.
  Playback does not apply the stored coordinates.
- Semantic failures are a missing endpoint, endpoints that do not follow one
  another, an element reference that is not the element in that endpoint, an
  operation with neither endpoint, two operations on one object that are
  duplicates or that write the same property, and operations that are not the
  difference of the two Komas. `fadeIn` and `fadeOut` both write opacity.
  `hold` conflicts with any other operation on that object. A `replace`
  cross-fade may be stored together with property operations such as `move`:
  that is how a replaced object also changes geometry.
- An operation name this version does not know is skipped and reported. It
  does not by itself disable the other operations of a transition that is
  otherwise valid.
- A replaced object is drawn twice while it cross-fades: the outgoing state
  and the incoming state, both following the interpolated geometry.
- `zIndex` is not interpolated. For a progress strictly between 0 and 1, an
  object that exists in the source keeps the source `zIndex`. An object that
  only enters uses the target `zIndex`. Objects that share a `zIndex` and
  exist in the source keep the source array order. Entering objects keep the
  target array order and paint after source objects with the same `zIndex`.
  A replace cross-fade keeps both layers on the source `zIndex`, outgoing
  immediately before incoming, so the two layers overlap. At progress 1 the
  target `zIndex` and the target array order are shown unchanged.

The renderer draws frames. It has no knowledge of how they were computed, and
the motion model does not depend on an animation library: the preview uses
`requestAnimationFrame` to advance the progress.

### Reduced motion

When the operating system asks for reduced motion, the preview does not move
objects. It shows the source Koma, then cuts to the target Koma.

## Planned extensions

The following operations are planned. None of them is implemented.

- morph between shapes
- reveal
- camera shift and zoom
- motion along a path
- mask transitions
- intermediate stop-motion frames

The model is prepared for them in two ways: operations are a list per object,
so new kinds can be added without changing existing ones, and playback skips
operations it does not know instead of failing.

## Stop Motion Mode (concept, not implemented)

The long-term goal is a presentation that behaves like a stop-motion
animation when it is advanced slide by slide in presentation software that
has no suitable animation of its own.

The idea is to insert intermediate Komas between two major Komas:

```text
Major Koma A
  -> Intermediate Koma A1
  -> Intermediate Koma A2
  -> Intermediate Koma A3
Major Koma B
```

How the current model supports this:

- `computeFrame` already produces the complete state of every object at any
  progress. An intermediate Koma is a frame at a chosen progress, stored as a
  Koma.
- Intermediate Komas keep the `persistentId` of every object, so they stay
  part of the same motion.

Open design questions:

- **Frame density.** The number of intermediate Komas per transition must be
  configurable, per presentation and per transition.
- **Marking.** Intermediate Komas must be distinguishable from major Komas, so
  they can be regenerated, hidden in the Koma strip and excluded from editing.
  This needs a new property and therefore a new schema version.
- **Number of slides.** Ten transitions with twelve intermediate Komas each
  produce 120 additional slides. The application must show the resulting
  number and ask for confirmation before it generates an excessive amount.
- **Timing.** Whether exported slides can advance automatically, and how
  precisely, depends on the presentation software. See
  `POWERPOINT_EXPORT_RESEARCH.md`.
- **Cross-fades.** A frame of a `replace` operation contains two layers of one
  object. An intermediate Koma has to store them as two elements.
