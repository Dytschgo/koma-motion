# External file conflicts

Entry: Open the isolated `shared.koma` fixture through the application, edit
its project name, then change that file through a separate writer.

```powershell
pnpm --filter @koma-motion/desktop exec playwright test fileConflicts.spec.ts
```

Proof: Save reports that the file changed outside this window. The local name
and Unsaved changes indicator remain, and the external file bytes are
unchanged. Save as to `my-copy.koma` must persist the local name without
altering the original; another normal Save must work on that new copy.

The spec records `file-conflict.png` in its Playwright output directory.
Preserve it outside the checkout before another test run replaces the output.
Native dialogs are stubbed; this does not test the OS dialog or simultaneous
writes during the final check-and-rename interval.
