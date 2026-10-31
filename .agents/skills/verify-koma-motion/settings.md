# Settings and instructions

Entry: choose **Settings** in the project menu at the start of the top bar. The **Settings categories** navigation
contains Instructions, Generation, Templates, Providers, Updates, and About.
The project pages explain when no project is open.

```powershell
pnpm --filter @koma-motion/desktop exec playwright test settings.spec.ts instructions.spec.ts composer.spec.ts updates.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'
```

Proof: Arrow keys, Home, and End move between categories. Escape closes Settings
and returns focus to its opener; reopening shows the last category. At 1120 by
700, the dialog and Done button fit the window. Generation time limits use named
choices and save in the `.koma` file. An existing exact limit survives navigation;
changing it takes one undo step. Its composer summary opens the same setting.
Settings opens the model chooser in chat rather than duplicating its fields.
Default delegates model choice to the provider;
an explicit selection stores the identifier in the project. The mock provider
has no model choice.

Templates are kept by the app outside the project. Managing a saved template
must not dirty an otherwise saved project; applying its text is a project edit.
Invalid instruction and template drafts survive closing Settings, and a failed
template save retains its draft.

Native file dialogs are stubbed. These tests do not prove which model an external
CLI resolves or that a real provider can run. Use fresh external output as described in `SKILL.md` and retain its report,
screenshots and traces after teardown.
