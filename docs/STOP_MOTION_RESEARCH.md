# Stop-motion frames: research and recommendation

Status: research for [issue #13](https://github.com/Dytschgo/koma-motion/issues/13).
Nothing in this document is implemented. It answers the open questions of the
"Stop Motion Mode" concept in [the motion model](MOTION_MODEL.md#stop-motion-mode-concept-not-implemented)
and proposes the format decision that [issue #8](https://github.com/Dytschgo/koma-motion/issues/8)
lists as open ("Decide how intermediate Komas are marked").

Stop motion means this: an exported deck behaves like an animation when it is
advanced slide by slide, even in presentation software that has no suitable
animation of its own. Between two major Komas the export inserts intermediate
slides. Each one shows the transition at a fixed moment, and the slides advance
automatically at a short interval.

## Summary of recommendations

| Question                           | Recommendation                                                                                                                                                                                                                                                               |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Frame density                      | Configure **frames per second** for the presentation (default 12, range 1–30). Each transition's frame count comes from its duration. An optional per-transition count (0–300) overrides that value.                                                                         |
| Marking and keeping out of editing | **Do not store intermediate Komas.** They are derived from two major Komas and their transition whenever they are needed, at export time or in a read-only preview. The format stores only the density settings, so a Koma needs no "intermediate" marker.                   |
| Warning before excessive slides    | Compute the exact slide count and an estimated file size before export. Warn and ask for confirmation above 150 added slides or 50 MB. Refuse above 2,000 slides in total.                                                                                                   |
| Cross-fades                        | Write the `outgoing` and `incoming` layers of a `replace` as two separate objects with complementary opacity, in the order and `zIndex` that `computeFrame` produces.                                                                                                        |
| Timing of exported slides          | `advTm` is stored in whole milliseconds, and PowerPoint's own UI shows hundredths of a second. Use cut transitions (no effect) and spread the rounding error so each transition keeps its total time. The frame rate PowerPoint actually achieves has **not been measured**. |

## What exists today

- `computeFrame` in [`packages/motion-engine/src/frame.ts`](../packages/motion-engine/src/frame.ts)
  (line 231) returns the complete visible state at any progress from 0 to 1. Easing and
  the staged timing windows are applied inside it
  ([`easing.ts`](../packages/motion-engine/src/easing.ts), `getOperationProgress`). Frames
  sampled at evenly spaced progress values are therefore evenly spaced in
  time, and the eased motion appears in the distance objects move between frames.
- A `Frame` is a background plus ordered `FrameLayer`s. A `replace` produces
  two layers, `outgoing` and `incoming`, on the source `zIndex`, with the
  outgoing layer immediately before the incoming one (`frame.ts` lines 351–377).
- The PowerPoint exporter writes one slide per Koma
  ([`PowerPointExporter.ts`](../packages/exporters/src/powerpoint/PowerPointExporter.ts),
  `addMotion`, lines 371–413). It sorts elements by `zIndex` and then by array
  order (`sorted`, line 49), which is the order `computeFrame` already returns.
  It maps opacity to `transparency` for text, shapes and pictures.
- Slide timing is written by `transitionXml` (line 341):
  `advTm` comes from the Koma's `holdDurationMs` or the global export hold, and
  `p14:dur` from the inbound transition's `duration`. `holdDurationMs` is limited
  to 1,000–60,000 ms ([`koma.ts`](../packages/core/src/schema/koma.ts), lines 10–17).
  Frame intervals of 33–100 ms cannot go through that field.
- Transition durations are limited to 100–10,000 ms
  ([`transition.ts`](../packages/core/src/schema/transition.ts), lines 142–144).
- Stored transitions must connect adjacent Komas. A transition whose endpoints
  are not adjacent fails the semantic check (`nonAdjacentKomas` in
  [`presentation.ts`](../packages/core/src/schema/presentation.ts)) and is not played.

## Measurements

A throwaway script, which is not committed, used the real motion engine,
schemas, serialiser and PowerPoint exporter on
`examples/generated-with-claude-code.koma`. That project has 3 Komas, 2 transitions with 2,600 ms
of motion in total, `replace`, `fadeIn` and `fadeOut` operations, and one staged
transition. For each frame rate the script inserted `round(duration × fps / 1000) − 1` intermediate
Komas at progress `i / (n + 1)`, converted each frame into a Koma, validated
the result against `komaProjectSchema`, serialised it and exported it as static PPTX.
Run on 2026-10-10 under Windows 11 with Node 24.18.

| fps | added slides | total slides | `.koma` if stored | PPTX (shapes and text) | PPTX with one 480 KB picture | largest move between frames |
| --- | ------------ | ------------ | ----------------- | ---------------------- | ---------------------------- | --------------------------- |
| –   | 0            | 3            | 23 KB             | 72 KB                  | 1.5 MB                       | –                           |
| 6   | 13           | 16           | 189 KB            | 286 KB                 | 8.0 MB                       | 374 units                   |
| 12  | 29           | 32           | 393 KB            | 549 KB                 | 16.0 MB                      | 249 units                   |
| 24  | 61           | 64           | 804 KB            | 1.1 MB                 | 31.9 MB                      | 124 units                   |
| 30  | 76           | 79           | 994 KB            | 1.3 MB                 | 39.3 MB                      | 103 units                   |

Findings:

- **Computing frames is not the cost.** All intermediate frames together took
  less than 3 ms. A static PPTX export of 79 slides took 23 ms without pictures
  and 0.8 s with one picture.
- **Storing frames in the project would multiply its size.** Every stored
  intermediate Koma added about 13 KB to the `.koma` file. At 24 fps the
  example grew 35-fold.
- **Pictures are duplicated for every slide.** With one 480 KB picture, every
  added slide added about 0.5 MB to the PPTX. The exporter (PptxGenJS 4.0.1)
  writes a separate media part for each slide that places the picture. Picture-heavy
  decks, not slide count, decide the file size.
- **A frame converted to a Koma passes schema validation** once the incoming
  layer of a cross-fade gets its own persistent id (see below).
- At 6 fps one object jumped 374 logical units (about a fifth of the canvas
  width) between two frames. That reads as a slideshow, not as motion. At 12 fps
  the largest step was about 250 units, at 24 fps about 125.

## 1. Frame density

### Recommendation

Configure density as **frames per second**, not as a fixed count per transition.

- Presentation setting `framesPerSecond`: an integer from 1 to 30, default **12**.
  Classic stop-motion animation runs at 12 drawings per second ("on twos"), and
  12 fps keeps the slide count and the per-frame step reasonable (see the table).
- Intermediate slides for a transition: `n = max(0, round(duration × fps / 1000) − 1)`.
  The two major Komas are the first and last frame. A 900 ms default transition
  at 12 fps gets 10 intermediate slides.
- Per-transition override `stopMotionFrames`: an integer from 0 to 300, or
  `null` to use the presentation rate. 0 means a cut with no intermediate slides,
  which suits a transition that should not animate. 300 is the count for
  30 fps × 10 s, the longest transition.
- Frame `i` of `n` is sampled at `progress = i / (n + 1)`. Evenly spaced samples
  keep the slide interval constant. Easing remains visible as uneven distances.
- **Skip duplicate frames.** A staged transition or a `hold` can produce
  consecutive frames that are equal. Merge them into one slide and add their
  intervals. This saves slides without changing timing. Comparing the layer
  lists of the frames is enough to detect this.

Frames per second rather than a fixed count keeps motion speed consistent
across transitions of different length. Users still think in "how many slides".
The export dialog therefore shows the resulting count per transition and in
total (see section 3).

### Where it lives

The setting describes how finely motion is sampled. It does not describe a
PowerPoint feature, and an in-app "stepped preview" can use it too. It can
therefore belong to the model without violating the rule that exporter
concepts stay out of `core` ([ARCHITECTURE.md](../ARCHITECTURE.md#dependency-direction)).

A first release can avoid a schema change. It offers only the presentation rate
in the export dialog, as an `ExportDestination` option. Per-transition
overrides need a schema version; see section 2.

## 2. Marking intermediate Komas and keeping them out of editing

### Recommendation: derive, do not store

Intermediate Komas should not exist in `presentation.komas`. A pure
motion-engine function derives them when they are needed:

```ts
// packages/motion-engine (proposal)
interface StopMotionFrame {
  readonly transitionId: string;
  readonly index: number; // 1..count
  readonly count: number;
  readonly progress: number; // index / (count + 1)
  readonly startMs: number; // offset within the transition
  readonly intervalMs: number; // time until the next frame
  readonly frame: Frame; // from computeFrame
}

function sampleTransition(input: {
  from: Koma;
  to: Koma;
  transition: KomaTransition;
  count: number;
}): readonly StopMotionFrame[];
```

The exporter turns each `StopMotionFrame` into a slide. The application can show
the same frames read-only, as a filmstrip under the transition with the existing
position control. They never enter document state, undo history, crash recovery
or the agent contract.

Reasons, based on the current code:

1. **They have no user data.** Intermediate Komas must be excluded from
   editing, so everything in them can be recomputed from the two major Komas and
   the transition. Stored copies only add a way to become wrong.
2. **Stored copies go stale on every edit.** Moving an object in a major Koma
   already makes stored motion out of date (see
   [Transitions that cannot play](MOTION_MODEL.md#transitions-that-cannot-play)).
   Stored frames would go stale in the same way, and would need their own
   detection, warning and regeneration UI.
3. **They break adjacency.** Transitions must connect adjacent Komas.
   Intermediate Komas in `komas[]` would sit between the endpoints of every
   transition. The rule, `syncTransitions`, the Koma strip, the presenter,
   generation, deck navigation and the exporter would all have to learn to
   skip them.
4. **They are expensive to store.** About 13 KB per frame in the measured example,
   plus snapshots in the 100-step undo history, plus the crash recovery record.
   That record is bounded by the same 64 MiB as the project
   ([CRASH_RECOVERY.md](CRASH_RECOVERY.md)).
5. **A cross-fade does not fit a Koma.** A Koma requires unique persistent ids
   ([`koma.ts`](../packages/core/src/schema/koma.ts), lines 82–103). A cross-fade
   frame contains one object twice.

### Proposed format representation (schema version 6)

This is the answer proposed for the open item in #8. **Komas get no marker.**
Only density is stored:

```jsonc
{
  "presentation": {
    // …
    "stopMotion": { "framesPerSecond": 12 },
    "transitions": [
      {
        "id": "transition_…",
        // …
        "stopMotionFrames": null, // null: derive from framesPerSecond; 0–300: explicit
      },
    ],
  },
}
```

- `presentation.stopMotion` is an object so that later settings, for example
  whether duplicate frames are merged, do not need another shape change.
  `framesPerSecond` is an integer from 1 to 30.
- `transition.stopMotionFrames` is `null` or an integer from 0 to 300.
  `syncTransitions` keeps it, as it keeps `duration`, `easing` and `rationale`.
- Migration from version 5 sets `stopMotion: { framesPerSecond: 12 }` and
  `stopMotionFrames: null`. Saving writes version 6. Older applications refuse
  version 6, as they refuse other newer versions.
- The agent contract does not change. Agents cannot set density.

If the presentation-level setting ships first as an export-dialog option, the
schema change waits until per-transition overrides are needed.

### "Convert frame to Koma"

A user who wants to edit one intermediate state can convert a derived frame
into a **normal major Koma**. The command inserts the frame as a Koma between
the two endpoints. It re-runs `syncTransitions`, which splits the transition
into two, and it is one undoable step. The new Koma is not marked. From then on
it is ordinary content. A cross-fade frame keeps only the layer with higher
opacity. At exactly 0.5 the incoming layer wins, so the Koma keeps unique
persistent ids. A notice says so.

### Rejected alternative: stored and marked intermediate Komas

If intermediate Komas ever had to be persisted, for example for hand-tuned
frames, the smallest representation would be:

```jsonc
{
  "id": "koma_…",
  "derivedFrom": {
    "transitionId": "transition_…",
    "index": 3,
    "count": 11,
    "progress": 0.25,
    "sourceFingerprint": "…", // fingerprint of both endpoints and the operations
  },
  // …normal Koma fields
}
```

It would require transitions to connect the nearest major Komas across
intermediate ones, a `persistentId` rule exception for cross-fades, a staleness
check against `sourceFingerprint` (as in
[`fingerprint.ts`](../packages/motion-engine/src/fingerprint.ts)), and filtering in
every consumer listed above. This is not recommended.

## 3. Warning before creating excessive slides

The count is exact and cheap: a sum of `n` over transitions, plus the major
Komas, before any frame is computed. The estimated size is
`base + Σ (per-slide cost + picture bytes placed on that slide)`, measured as
in the table above. Pictures dominate. As long as the exporter writes one media
part per placement, the estimate must count picture bytes per slide.

Recommendation for the export dialog:

- Always show "_N_ Komas become _M_ slides (_K_ stop-motion frames)". Show the
  estimated file size and the transitions with the most frames.
- **Confirm** when more than 150 slides would be added or the estimate exceeds
  50 MB. The dialog names the largest contributors and offers a lower rate or
  per-transition overrides. The ten-transition example of the motion model
  (12 frames each, 120 slides) stays below the confirmation threshold.
- **Refuse** above 2,000 slides in total. The message explains how to lower the
  rate. This also bounds export memory and time. The 2,000 is an application
  bound, not a documented PowerPoint limit.
- Thresholds are constants with tests, like the generation limits in
  [GENERATION_LIMITS.md](GENERATION_LIMITS.md). They are not user settings.

Before stop-motion export ships, the exporter should deduplicate identical
media parts. JSZip already rewrites the package in `addMotion`. It can point
every slide relationship that places the same picture at one media part. Measured
here, this would shrink the 30 fps picture case from 39 MB to about 2 MB.
PowerPoint itself shares media parts between slides when a slide is duplicated
(**not verified for files produced by Koma Motion**). Check this in PowerPoint
before relying on it.

## 4. Cross-fades in an intermediate frame

`computeFrame` already defines the frame. The stop-motion export writes it
without reinterpreting it:

- A `replace` becomes **two objects**. The outgoing object is the source element
  with the interpolated geometry and opacity × (1 − fade). The incoming object
  is the target element with the same geometry and opacity × fade. Both use the
  source `zIndex`, outgoing first (`frame.ts`, lines 351–377).
- Opacity becomes PowerPoint `transparency` as it does now. Text, shapes,
  lines, pictures and flattened group children all support it in the current
  exporter.
- Names: the outgoing object keeps the exporter's `!!<persistentId>` name. The
  incoming object gets `!!<persistentId>~in`, so a user who later applies Morph
  by hand does not get two objects with one Morph name. PowerPoint object names
  are not bound by the Koma id pattern. In the measurement, where frames were
  validated as Komas, the incoming layer used the persistent id
  `<persistentId>-in`, and the result passed `komaProjectSchema`.
- Two layers at partial opacity do not add up to full coverage. At the midpoint
  each is 50 % opaque, so the background shows through at 25 %. The in-app
  preview shows the same, so export and preview agree. Changing it would be a
  change to `computeFrame`, not to export.
- Entering and exiting objects are single objects with scaled opacity. Colour
  changes are interpolated colours. A change from a colour to "no colour"
  switches half-way, as in `mixOptionalColour`.

## 5. Timing of exported slides

### What the file format allows

| Attribute                | Source                                                                                                                                                                                                                                                                                                                                                              | Unit and granularity                                                |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `p:transition/@advTm`    | ECMA-376 PresentationML `transition`; Microsoft's [Open XML transition how-to](https://learn.microsoft.com/en-us/office/open-xml/presentation/how-to-add-transitions-between-slides-in-a-presentation): "the time, in milliseconds, after which the transition should start … If this attribute is not specified then it is assumed that no auto-advance occurs."   | `xsd:unsignedInt` milliseconds; 1 ms in the file                    |
| `p:transition/@advClick` | Same sources: whether a mouse click advances; default true                                                                                                                                                                                                                                                                                                          | boolean                                                             |
| `p:transition/@p14:dur`  | [MS-PPTX 2.3.2.3 `dur`](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/9032bdb2-b273-470b-8ac4-c98a8c944494), type [`ST_UniversalTimeOffset`](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-pptx/a3ead080-d9cb-4b4a-8014-6d815248c23b): a number with optional unit; "If no unit is specified, the default is millisecond." | milliseconds or a decimal with a unit; only for the effect duration |
| `p:transition/@spd`      | ECMA-376 `ST_TransitionSpeed`: `slow`, `med`, `fast`                                                                                                                                                                                                                                                                                                                | preset; older readers only                                          |

Microsoft's [timing help](https://support.microsoft.com/en-us/powerpoint/set-the-timing-and-speed-of-a-transition)
describes Advance Slide "After" as the interval before the next transition
starts. The [timing and duration article](https://support.microsoft.com/en-gb/office/timing-and-duration-for-transition-effects-9f054d38-01d2-4d05-a77a-42a2bdb02707)
adds that the timer starts after the last animation on the slide has finished.
Koma slides have no animations, so the timer starts when the slide appears.

### What has been observed

- The manual check on 2026-10-01 in Windows PowerPoint 16.0.20430.20092
  ([POWERPOINT_EXPORT_RESEARCH.md](POWERPOINT_EXPORT_RESEARCH.md#verified-in-windows-powerpoint))
  showed generated values as "0.90 s" and "1.20 s". PowerPoint's own fields
  therefore display hundredths of a second.

### Not verified

These are marked as open because no source or test established them:

- The **shortest interval PowerPoint actually honours in Slide Show**, and
  whether values below 10 ms survive a save in PowerPoint. The file can
  express 1 ms. A 60 Hz display shows at most one new image every 16.7 ms, and
  PowerPoint's per-slide rendering cost is unknown.
- Whether **macOS PowerPoint**, Keynote, Google Slides or LibreOffice Impress
  honour short `advTm` values at all.
- Whether `advClick="0"` also stops the keyboard and the presenter remote from
  advancing during the frame sequence.
- Whether "Use Timings" (`p:showPr/@useTimings` in `presProps.xml`) is on in
  every PowerPoint default. If it is off, every frame waits for a click.

### Recommendation

- **Cut between frames.** Intermediate slides and the arriving major slide get
  `<p:transition advClick="0" advTm="…"/>` with no effect element and no
  `p14:dur`. A fade or Morph between frames would blur them and add duration.
- **Intervals in whole milliseconds, rounding error spread.** For a transition of
  duration `D` with `n` intermediate slides, slide `k` advances after
  `round(D × (k + 1) / (n + 1)) − round(D × k / (n + 1))` ms. Each transition keeps
  its exact total. At 12 fps a 1,200 ms transition has 13 intermediate slides and
  14 intervals of 85–86 ms that add up to exactly 1,200 ms.
- **Start on a click.** The major Koma before a transition keeps today's behaviour:
  it waits for a click, or for its hold when automatic advance is on. The
  frame sequence then runs on its own and stops on the next major Koma. One click
  plays one transition, as in the application.
- **Write frame intervals separately from Koma holds.** Frame intervals do not use
  `holdDurationMs` (1,000 ms minimum). They are computed in the exporter and
  never stored.
- **Default 12 fps, maximum 30 fps** until a Slide Show measurement exists. The
  measurement records a 60 fps screen capture of a known deck and counts distinct
  frames per slide. Record the PowerPoint version, as the manual export check does.
- Stop motion is a fourth export motion mode next to static, fade and Morph:
  `ExportDestination.motion: 'stopMotion'` in
  [`types.ts`](../packages/exporters/src/types.ts). It does not change how the
  other modes behave.

## Proposed implementation order

1. `sampleTransition` and frame-interval rounding in `motion-engine`, with
   tests for determinism, merging of duplicate frames and cross-fade layers.
2. Media deduplication in the PowerPoint exporter, verified in PowerPoint.
3. Export mode `stopMotion` with a presentation rate from the dialog. The count
   and size estimate, confirmation and refusal are part of `validate`.
4. A manual Slide Show timing check on Windows and macOS. Record the results in
   [POWERPOINT_EXPORT_RESEARCH.md](POWERPOINT_EXPORT_RESEARCH.md).
5. Schema version 6 with `presentation.stopMotion` and
   `transition.stopMotionFrames`, if per-transition control is still wanted.
6. A read-only frame filmstrip in the Inspector and "Convert frame to Koma".

## Open questions

- Is 12 fps the right default once Slide Show timing has been measured? Is
  30 fps a useful maximum?
- Are 150 added slides and 50 MB the right confirmation thresholds for real
  decks?
- Should the presentation rate wait for schema version 6, or start as an
  export-only option?
- Does a stepped in-app preview at the chosen rate justify storing the rate in
  the model?
