# Mock project workflow

```powershell
pnpm --filter @koma-motion/desktop exec playwright test workflow.spec.ts
```

Entry: Create a project. Choose Mock provider before Generate Komas. Readiness is three Koma buttons and the completed generation message, not a fixed sleep.

Proof: the workflow changes Brand Kit fields, generates a presentation, previews a transition, edits an element, saves to the isolated fixture directory, and reopens that `.koma` file. Inspect the persisted fields and the restored stage. Other cases cover Koma editing/Undo, cancellation, close flows, logo import, and invalid files.

The suite does not directly click Save as. Do not claim that path, real native-dialog interaction, real provider execution, screen-reader behavior, or renderer network isolation beyond the tested transports from these results.
