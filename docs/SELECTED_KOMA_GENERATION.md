# Selected Koma proposals

The chat scope menu offers **Entire presentation** and **Selected Koma**.
Selected Koma sends the current Koma's full content and identities as imported,
untrusted context and requests exactly one Koma. The count choice is disabled.
Mock generation supports this scope without contacting an external service.
Existing provider sign-in and reference disclosure still apply.

A successful selected request opens a preview with **Apply proposal** and
**Discard proposal**. Generation never applies it automatically. Discard and
cancellation leave the document, asset list, generation history and undo stack
unchanged. Apply replaces that Koma's visual content and records the generated
assets and history in one undo step. It retains the Koma id and saved hold time,
presentation metadata, other Komas and every existing asset. Persistent objects
with matching ids and types keep their element identities and locked/visible
flags. New identities are allocated without colliding with the current project.

Stored neighboring motion remains unchanged and may become stale. Review and
repair it explicitly through the existing motion controls.

Editing or deleting the target invalidates a proposal, including an edit later
undone. Switching projects or reopening the same file discards pending work.
Changes or removal of referenced existing images also invalidate it. Other Koma
edits and unrelated asset changes remain available and are preserved on Apply.
Apply checks current image availability, asset collisions and whole-project
schema limits again. Proposals remain session-only; reference file bytes and
source paths are never saved with them.

`selectedGeneration.spec.ts` exercises native mock preview, discard, apply,
undo, save/reopen, stale target, reopen, cancellation and narrow-window focus.
Native file dialogs are stubbed; live provider behavior is not covered by these
checks.
