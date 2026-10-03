# Persisted motion

Entry: Open a real `.koma` fixture through the application. The test supplies the file-dialog selection; it does not operate the native dialog itself.

```powershell
pnpm --filter @koma-motion/desktop exec playwright test motion.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'
```

Proof: a stored transition with a false element id warns and stays on the real source position at 50 percent, then reaches the real target at 100 percent. Reading the fixture again must show unchanged file bytes. A valid overlapping-object fixture must retain source stacking in the middle and use target stacking at the endpoint.

The existing stacking assertions inspect DOM order and computed z-index. They are not screenshot comparisons. Projects with missing Koma endpoints currently fail schema validation before semantic warnings; distinguish them from bad element references in an otherwise valid project.

For changes to playback validation, measure equivalent valid Komas before and after, with warmup. Include grouped elements, whose children add validation work even when the frame has few top-level layers. Report milliseconds per computeFrame call separately from DOM rendering or observed frame rate. Validate once per immutable transition/document revision rather than repeating a full diff on each animation tick.
