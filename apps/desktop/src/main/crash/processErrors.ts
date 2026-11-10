/**
 * Errors of the main process that nothing handled.
 *
 * **An uncaught exception ends the application.** The main process owns every
 * file Koma Motion writes: projects, the Brand Kit library, templates and the
 * recovery record. After an exception that no code expected, it is not known
 * which of its state is still true, and continuing could write that state to
 * disk. So the error is logged, the user is told once, and the process exits
 * with code 1. It does not restart itself, which would turn an error at
 * startup into a loop. The recovery record is written atomically, so the next
 * start offers the last snapshot as usual.
 *
 * **An unhandled rejection is logged and the application continues.** It is a
 * background task that failed after its caller had moved on: the task did not
 * finish, but no statement was interrupted halfway. Ending the application
 * for it would discard unsaved work to protect state that is not in doubt.
 */
import { app, dialog } from 'electron';
import { diagnostics } from '../diagnostics';
import { describeError } from '../diagnostics/describe';

const UNCAUGHT_TITLE = 'Koma Motion has to close';
const UNCAUGHT_TEXT =
  'An unexpected error stopped Koma Motion. It closes now so that it cannot write damaged files.\n\n' +
  'When you start it again, unsaved changes are offered for recovery as an unsaved copy. Changes from the last moments may be missing. Your project file has not been changed.\n\n' +
  'Settings > About has a diagnostics log you can attach to a report.';

export interface ProcessErrorActions {
  /** Tells the user. May block until the message is dismissed. */
  notify(title: string, text: string): void;
  exit(code: number): void;
}

/** `KOMA_SMOKE=1` marks automated runs, where nobody can dismiss a message. */
const electronActions: ProcessErrorActions = {
  notify(title, text) {
    if (process.env['KOMA_SMOKE'] !== '1') {
      dialog.showErrorBox(title, text);
    }
  },
  exit(code) {
    app.exit(code);
  },
};

export function createProcessErrorHandlers(actions: ProcessErrorActions = electronActions): {
  readonly uncaughtException: (error: unknown) => void;
  readonly unhandledRejection: (reason: unknown) => void;
} {
  let ending = false;
  return {
    uncaughtException: (error) => {
      // An error while reporting an error must not start over.
      if (ending) {
        return;
      }
      ending = true;
      try {
        diagnostics.write('fatal', 'main.uncaught-exception', describeError(error));
        actions.notify(UNCAUGHT_TITLE, UNCAUGHT_TEXT);
      } catch {
        // Telling the user failed. The process still ends.
      } finally {
        actions.exit(1);
      }
    },
    unhandledRejection: (reason) => {
      diagnostics.write('error', 'main.unhandled-rejection', describeError(reason));
    },
  };
}

/** Must run before anything else can fail. */
export function handleProcessErrors(): void {
  const handlers = createProcessErrorHandlers();
  process.on('uncaughtException', handlers.uncaughtException);
  process.on('unhandledRejection', (reason) => {
    handlers.unhandledRejection(reason);
    // Handling the event silences the warning of Node.js. Development keeps it.
    if (!app.isPackaged) {
      console.error('Unhandled rejection in the main process:', reason);
    }
  });
  // Helper processes of Chromium, such as the GPU process, restart by themselves.
  app.on('child-process-gone', (_event, details) => {
    diagnostics.write('warn', 'app.child-process-gone', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
    });
  });
}
