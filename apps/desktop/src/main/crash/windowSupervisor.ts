/**
 * Keeps the application window usable when its page fails: the renderer
 * process is gone, the page stops responding, or the page is loaded again.
 *
 * In each case the page has lost the project it held, while the main process
 * still remembers a file path, unsaved changes and a recovery session. That
 * memory is dropped (`pageLost`) and the recovery record is read from disk
 * again, so the reloaded page gets the same explicit offer as after a restart.
 * There is no second way to recover: see docs/CRASH_RECOVERY.md.
 */
import { app, dialog, type BrowserWindow, type MessageBoxOptions } from 'electron';
import { diagnostics } from '../diagnostics';
import {
  decideRendererLoss,
  rememberLoss,
  UNRESPONSIVE_DETAIL,
  UNRESPONSIVE_MESSAGE,
} from './rendererLoss';

const APPLICATION_NAME = 'Koma Motion';
const RELOAD = 'Reload window';
const QUIT = 'Quit Koma Motion';
/** How long a quit waits for a withdrawn question to leave the screen. */
const QUESTION_LEAVES_MS = 2000;
/** How long the application may keep running after its window was ended for a quit. */
const QUIT_GRACE_MS = 3000;

export interface WindowSupervision {
  readonly window: BrowserWindow;
  /**
   * The page no longer holds a project. Stops work that was running for it
   * and forgets its file, its unsaved state and its recovery session.
   */
  pageLost(): void;
  /** Resolves when recovery writes that were already admitted are on disk. */
  flush(): Promise<void>;
  /** Milliseconds that never go backwards. */
  readonly elapsed?: () => number;
}

export function superviseWindow(supervision: WindowSupervision): void {
  const { window } = supervision;
  const contents = window.webContents;
  const elapsed = supervision.elapsed ?? (() => performance.now());
  let losses: number[] = [];
  /** The first load of the window is not a lost page. */
  let loaded = false;
  /** Set while this code ends an unresponsive renderer itself. */
  let endingRenderer = false;
  let closed = false;
  /** The application was asked to quit while a question was showing. */
  let quitRequested = false;
  /** Set once a quit during the question about a lost page is being completed. */
  let endingForQuit = false;
  let question: {
    readonly about: 'gone' | 'unresponsive';
    readonly cancel: AbortController;
    /** Resolves when the question has left the screen, however it ended. */
    readonly left: Promise<void>;
  } | null = null;

  /** Shows one native question at a time. `null` when it was withdrawn. */
  const ask = async (
    about: 'gone' | 'unresponsive',
    options: MessageBoxOptions,
  ): Promise<number | null> => {
    question?.cancel.abort();
    const cancel = new AbortController();
    let shown: Promise<{ response: number }>;
    try {
      shown = dialog.showMessageBox(window, {
        title: APPLICATION_NAME,
        noLink: true,
        ...options,
        signal: cancel.signal,
      });
    } catch {
      return null;
    }
    question = {
      about,
      cancel,
      left: shown.then(
        () => undefined,
        () => undefined,
      ),
    };
    try {
      const { response } = await shown;
      return cancel.signal.aborted || closed || window.isDestroyed() ? null : response;
    } catch {
      return null;
    } finally {
      if (question?.cancel === cancel) {
        question = null;
      }
      if (quitRequested && cancel.signal.aborted) {
        quitRequested = false;
        if (!closed && !window.isDestroyed()) {
          // The question about a page that does not respond. On macOS it is a
          // sheet of the window, and a window that still shows a sheet ignores
          // a request to close: a quit that arrives during the question can
          // stop at this window. The question is gone now, so the quit is
          // asked for again and the window closes the ordinary way.
          setImmediate(() => {
            app.quit();
          });
        }
      }
    }
  };

  /**
   * Ends the window without asking the page anything: it cannot save. Its
   * unsaved changes stay in the recovery record for the next start.
   */
  const quit = async (): Promise<void> => {
    closed = true;
    supervision.pageLost();
    await supervision.flush().catch(() => undefined);
    if (!window.isDestroyed()) {
      window.destroy();
    }
  };

  contents.on('did-navigate', () => {
    endingRenderer = false;
    if (!loaded) {
      loaded = true;
      return;
    }
    // Also reached by a reload the page started itself.
    diagnostics.write('info', 'window.page-reloaded');
    supervision.pageLost();
  });

  contents.on('render-process-gone', (_event, details) => {
    const expected = endingRenderer || closed || window.isDestroyed();
    endingRenderer = false;
    const now = elapsed();
    const decision = decideRendererLoss(details.reason, losses, now);
    diagnostics.write(expected ? 'info' : 'error', 'window.renderer-gone', {
      reason: details.reason,
      exitCode: details.exitCode,
      expected,
      canReload: decision.canReload,
    });
    if (expected) {
      return;
    }
    losses = rememberLoss(losses, now);
    supervision.pageLost();
    void (async () => {
      const response = await ask('gone', {
        type: 'error',
        message: decision.message,
        detail: decision.detail,
        buttons: decision.canReload ? [RELOAD, QUIT] : [QUIT],
        defaultId: 0,
        // Dismissing the question must not leave an empty window behind.
        cancelId: 0,
      });
      if (response === null) {
        return;
      }
      const reload = decision.canReload && response === 0;
      diagnostics.write('info', 'window.renderer-gone-choice', {
        choice: reload ? 'reload' : 'quit',
      });
      if (reload) {
        contents.reload();
      } else {
        await quit();
      }
    })();
  });

  window.on('unresponsive', () => {
    if (closed || question !== null) {
      return;
    }
    diagnostics.write('warn', 'window.unresponsive');
    void (async () => {
      const response = await ask('unresponsive', {
        type: 'warning',
        message: UNRESPONSIVE_MESSAGE,
        detail: UNRESPONSIVE_DETAIL,
        buttons: ['Keep waiting', RELOAD, QUIT],
        defaultId: 0,
        cancelId: 0,
      });
      if (response === null || response === 0) {
        return;
      }
      diagnostics.write('info', 'window.unresponsive-choice', {
        choice: response === 1 ? 'reload' : 'quit',
      });
      if (response === 1) {
        // A page that does not respond cannot be reloaded; its process is ended first.
        endingRenderer = true;
        supervision.pageLost();
        contents.forcefullyCrashRenderer();
        contents.reload();
      } else {
        await quit();
      }
    })();
  });

  window.on('responsive', () => {
    diagnostics.write('info', 'window.responsive');
    if (question?.about === 'unresponsive') {
      question.cancel.abort();
    }
  });

  /**
   * Completes a quit that arrived during the question about a lost page. The
   * page is gone, so there is nothing to ask before closing.
   *
   * The order matters on macOS, where the question is a sheet of the window:
   * a window that shows a sheet ignores a request to close, and ending the
   * window under an open sheet left the application running. So the quit
   * waits until the question has left the screen, then the window is ended,
   * then the quit is asked for again. If the application is still running
   * after that, it is ended without further events: recovery writes are on
   * disk by then, and a question nobody answers must not keep it open.
   */
  const endForQuit = async (left: Promise<void>): Promise<void> => {
    let waiting: ReturnType<typeof setTimeout> | undefined;
    const gone = await Promise.race([
      left.then(() => true),
      new Promise<boolean>((resolve) => {
        waiting = setTimeout(() => resolve(false), QUESTION_LEAVES_MS);
      }),
    ]);
    clearTimeout(waiting);
    if (!gone) {
      diagnostics.write('warn', 'window.question-stuck');
    }
    await quit();
    setTimeout(() => {
      diagnostics.write('warn', 'app.quit-forced');
      app.exit(0);
    }, QUIT_GRACE_MS).unref();
    app.quit();
  };

  // A question must not hold the application open while it quits.
  const beforeQuit = (event?: { preventDefault(): void }): void => {
    if (question === null || closed || endingForQuit) {
      return;
    }
    const { about, cancel, left } = question;
    diagnostics.write('info', 'window.quit-during-question', { about });
    if (about === 'gone') {
      // This request to quit stops here and is repeated by `endForQuit`.
      event?.preventDefault();
      endingForQuit = true;
      cancel.abort();
      void endForQuit(left);
    } else {
      quitRequested = true;
      cancel.abort();
    }
  };
  app.on('before-quit', beforeQuit);
  window.on('closed', () => {
    closed = true;
    question?.cancel.abort();
    app.off('before-quit', beforeQuit);
  });
}
