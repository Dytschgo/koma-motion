# Mock project workflow

```powershell
pnpm --filter @koma-motion/desktop exec playwright test workflow.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'
```

Entry: Create a project. Choose Mock provider before Generate Komas. Readiness is three Koma buttons and the completed generation message, not a fixed sleep.

Proof: the workflow changes Brand Kit fields, generates a presentation, previews a transition, edits an element, saves to the isolated fixture directory, and reopens that `.koma` file. Inspect the persisted fields and the restored stage. Other cases cover Koma editing/Undo, cancellation, close flows, logo import, and invalid files.

The suite does not directly click Save as. Do not claim that path, real native-dialog interaction, real provider execution, screen-reader behavior, or renderer network isolation beyond the tested transports from these results.

For edits made while generation is running, run `pnpm --filter @koma-motion/desktop exec playwright test generationConflict.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'`. The tests use the built Electron app and mock provider. They edit a Koma before the result arrives, then verify the replacement decision, both choices, and Undo after replacement. Set `KOMA_EVIDENCE_DIR` to an existing folder outside the checkout to save a screenshot of the decision dialog.

Generated images are checked against the current assets immediately before the result is applied, including after a replacement decision. The held-response cases in `pnpm exec vitest run apps/desktop/src/renderer/src/lib/ownership.test.ts` verify missing images, unavailable image data, and a logo selection completing while the decision is open. These are store/bridge tests; the Electron workflow does not exercise that asset race or a real provider.
