import type { ProjectSession } from './projectFiles';

/** A clean window remains editable while queued recovery writes finish. */
export async function finishCleanClose(
  session: ProjectSession,
  flush: () => Promise<void>,
  actions: { isOpen(): boolean; confirm(): void; askAgain(): void },
): Promise<void> {
  const sessionId = session.sessionId;
  await flush();
  // A different project did not ask to close. Leave it open.
  if (!actions.isOpen() || session.sessionId !== sessionId) return;
  if (session.hasUnsavedChanges) actions.askAgain();
  else actions.confirm();
}
