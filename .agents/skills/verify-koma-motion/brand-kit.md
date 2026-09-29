# Brand Kit drafts

Entry: Create a project, then Brand Kit.

```powershell
pnpm --filter @koma-motion/desktop exec playwright test brandKitDraft.spec.ts
```

The spec must type with `pressSequentially`, including spaces, into Brand name and Heading font. Select existing text with `ControlOrMeta+A`, which uses the platform's editing shortcut. Replacing text with `fill` alone cannot catch the original space-loss bug.

Proof: `Acme Corp` and `Times New Roman` remain intact; invalid Primary colour text stays visible while valid name/font/topics edits survive Back to the canvas and return. Blur before testing project Undo/Redo. Opening the separate Harbour fixture must show its own Brand Kit and leave that file unchanged.

Keep the invalid-field assertions. Do not clear or refill the fields after navigation before observing their values. Run on Windows and macOS before claiming both are verified.
