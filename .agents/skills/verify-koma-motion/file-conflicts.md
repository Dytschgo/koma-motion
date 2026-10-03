# External file conflicts

Entry: Open the isolated `shared.koma` fixture through the application, edit
its project name, then change or remove that file through a separate writer.

```powershell
pnpm --filter @koma-motion/desktop exec playwright test fileConflicts.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'
```

Proof: Save reports that the file changed or was removed outside this window.
The local name and Unsaved changes indicator remain. Changed external bytes
remain unchanged; a removed original is not recreated. Save as to `my-copy.koma`
must persist the local name without altering the original; another normal Save
must work on that new copy.

The spec records `file-conflict.png` in its Playwright output directory.
Keep it in the fresh external output prepared as described in `SKILL.md`.
Native dialogs are stubbed; this does not test the OS dialog or simultaneous
writes during the final check-and-rename interval.
