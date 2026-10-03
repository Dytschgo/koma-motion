# Generation activity

Entry: create a project, show the chat, click **Use the example request**, then
**Generate Komas** with the mock provider.

```powershell
pnpm --filter @koma-motion/desktop exec playwright test streaming.spec.ts runMonitor.spec.ts --output "$komaVerifyOutput/native-results" --reporter 'list,json'
```

Proof: an active run shows its phase, elapsed time, and **Open run monitor**.
The monitor shows that run's timeline and output; opening it starts no second
request. Mock narration appears in **Output from Mock provider**, separate
from status text. After completion, **What Mock provider wrote** retains the
text and **Run details** reopens the monitor. An invalid mock answer shows a
correction attempt and then failure. **Cancel run** stops a delayed mock run.
With reduced motion, the sprite stays still. Hiding and reopening chat preserves
the run and elapsed time. When reading earlier entries, new streamed text does
not force the conversation to the bottom.

Renderer-side rejection after generation is covered by the ownership unit tests:

```powershell
pnpm exec vitest run apps/desktop/src/renderer/src/lib/ownership.test.ts
```

These check that a proposal referencing an asset replaced during confirmation
leaves the edited project intact and ends the monitor timeline with failure.
They also check failure reporting if applying a successful response throws.
These are store-level checks, not native reproductions of those two failures.

The monitor is an in-app view. Mock tests do not exercise a real CLI, its
authentication, or terminal attachment. Keep screenshots, traces and the JSON report in the fresh external output
directory prepared as described in `SKILL.md`.
