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
  let question: {
    readonly about: 'gone' | 'unresponsive';
    readonly cancel: AbortController;
  } | null = null;

  /** Shows one native question at a time. `null` when it was withdrawn. */
  const ask = async (
    about: 'gone' | 'unresponsive',
    options: MessageBoxOptions,
  ): Promise<number | null> => {
    question?.cancel.abort();
    const cancel = new AbortController();
    question = { about, cancel };
    try {
      const { response } = await dialog.showMessageBox(window, {
        title: APPLICATION_NAME,
        noLink: true,
        ...options,
        signal: cancel.signal,
      });
      return cancel.signal.aborted || closed || window.isDestroyed() ? null : response;
    } catch {
      return null;
    } finally {
      if (question?.cancel === cancel) {
        question = null;
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

  // A question must not hold the application open while it quits.
  const withdraw = (): void => {
    question?.cancel.abort();
  };
  app.on('before-quit', withdraw);
  window.on('closed', () => {
    closed = true;
    withdraw();
    app.off('before-quit', withdraw);
  });
}
