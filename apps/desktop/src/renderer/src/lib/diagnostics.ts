/**
 * The window's side of the diagnostics log. The window can report that one of
 * its own errors happened, and ask the main process to show or copy the log.
 * It never reads the log.
 */
import { errorName, stackFrames, type RendererReport } from '../../../shared/diagnostics';
import { invoke } from './api';
import { flushRecovery } from './recovery';

/** One fault often repeats on every frame. The first reports say all there is to say. */
const MAX_REPORTS = 5;
let reports = 0;

/**
 * Reports the class of an error and where it happened. The message is left
 * out on purpose: it can quote a value of the project.
 */
export function reportError(
  kind: RendererReport['kind'],
  error: unknown,
  componentStack = '',
): void {
  if (reports >= MAX_REPORTS) {
    return;
  }
  reports += 1;
  const known = error instanceof Error ? error : null;
  void invoke('koma:diagnostics:report', {
    kind,
    name: errorName(known?.name),
    stack: stackFrames(known?.stack),
    componentStack: stackFrames(componentStack),
  }).catch(() => undefined);
}

/** Reports errors that no code of the window handled. */
export function followWindowErrors(): void {
  window.addEventListener('error', (event) => {
    reportError('error', event.error);
  });
  window.addEventListener('unhandledrejection', (event) => {
    reportError('unhandled-rejection', event.reason);
  });
}

let preserved: Promise<void> = Promise.resolve();

/**
 * After the interface failed: writes the committed document to the recovery
 * snapshot, then tells the main process that this window can no longer save.
 * Closing the window then keeps the snapshot for the next start instead of
 * asking a question whose "Save" nothing could answer.
 */
export function preserveWork(): Promise<void> {
  preserved = flushRecovery(true)
    .catch(() => undefined)
    .then(() => invoke('koma:app:set-unsaved-changes', { hasUnsavedChanges: false }))
    .then(
      () => undefined,
      () => undefined,
    );
  return preserved;
}

/**
 * Loads the window again. The main process notices and forgets the lost
 * page, so the new page starts with the recovery offer.
 */
export async function reloadWindow(): Promise<void> {
  // A snapshot that cannot be written must not keep the window on this screen.
  await Promise.race([preserved, new Promise((resolve) => setTimeout(resolve, 3000))]);
  window.location.reload();
}
