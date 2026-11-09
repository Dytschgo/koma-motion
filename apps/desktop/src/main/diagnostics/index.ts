/**
 * The diagnostics log of the running application, and the three channels the
 * window has for it: report an error of its own, open the log folder and copy
 * the newest entries. None of them carries a path, and the window never
 * receives the text of the log.
 */
import { homedir, release } from 'node:os';
import { join } from 'node:path';
import { app, clipboard, shell } from 'electron';
import { acceptedFrames, errorName } from '../../shared/diagnostics';
import type { HandleChannel } from '../ipc/handle';
import { describeError, describeFailedResponse } from './describe';
import { DiagnosticsLog, NO_DIAGNOSTICS, type Diagnostics } from './log';
import { TokenBucket } from './rateLimit';
import { createScrubber } from './scrub';

/** What "Copy diagnostics" puts on the clipboard at most. */
const MAX_COPIED_BYTES = 64 * 1024;
/** Reports of the window: five at once, then one every thirty seconds. */
const REPORT_BURST = 5;
const REPORT_REFILL_MS = 30_000;
/** Failed requests: thirty at once, then one every ten seconds. */
const FAILURE_BURST = 30;
const FAILURE_REFILL_MS = 10_000;
const failures = new TokenBucket(FAILURE_BURST, FAILURE_REFILL_MS);

let log: DiagnosticsLog | null = null;

/** Records nothing until `startDiagnostics` has run, so modules can use it at any time. */
export const diagnostics: Diagnostics = {
  write(level, event, data) {
    (log ?? NO_DIAGNOSTICS).write(level, event, data);
  },
};

function describeApplication(): Record<string, string | boolean> {
  return {
    version: app.getVersion(),
    packaged: app.isPackaged,
    platform: process.platform,
    arch: process.arch,
    osRelease: release(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
  };
}

/** Opens the log in the data folder of the application and records the start. */
export function startDiagnostics(): void {
  if (log !== null) {
    return;
  }
  try {
    const userData = app.getPath('userData');
    log = new DiagnosticsLog({
      directory: join(userData, 'logs'),
      scrub: createScrubber({
        app: app.getAppPath(),
        userData,
        temp: app.getPath('temp'),
        home: homedir(),
      }),
    });
    log.write('info', 'app.start', describeApplication());
  } catch {
    // The application works without its log.
    log = null;
  }
}

/**
 * Wraps the listener of a channel: a request that throws, and a response that
 * reports a failure, leave an entry. Requests and responses themselves are
 * never recorded.
 */
export function observeIpc<A extends readonly unknown[], R>(
  channel: string,
  listener: (...parameters: A) => Promise<R>,
): (...parameters: A) => Promise<R> {
  return async (...parameters) => {
    let response: R;
    try {
      response = await listener(...parameters);
    } catch (error) {
      // A window that keeps sending bad requests must not push out older entries.
      if (failures.take(performance.now())) {
        diagnostics.write('error', 'ipc.failed', { channel, ...describeError(error) });
      }
      throw error;
    }
    const failure = describeFailedResponse(channel, response);
    if (failure !== null && failures.take(performance.now())) {
      diagnostics.write('warn', failure.event, failure.data);
    }
    return response;
  };
}

function copiedText(): string {
  const facts = Object.entries(describeApplication())
    .map(([name, value]) => `${name}: ${String(value)}`)
    .join('\n');
  const entries = log?.tail(MAX_COPIED_BYTES) ?? '';
  return `Koma Motion diagnostics\n${facts}\n\n${entries === '' ? 'The log has no entries.\n' : entries}`;
}

export function registerDiagnosticsHandlers(handle: HandleChannel): void {
  // The window is untrusted: it may not fill the log or keep the disk busy.
  const reports = new TokenBucket(REPORT_BURST, REPORT_REFILL_MS);

  handle('koma:diagnostics:report', ({ kind, name, stack, componentStack }) => {
    if (reports.take(performance.now())) {
      diagnostics.write('error', 'renderer.error', {
        kind,
        error: errorName(name),
        stack: acceptedFrames(stack),
        componentStack: acceptedFrames(componentStack),
      });
    }
    return {};
  });

  handle('koma:diagnostics:open-folder', async () => {
    const problem = log === null ? 'unavailable' : await shell.openPath(log.directory);
    if (problem === '') {
      return { status: 'done' };
    }
    return {
      status: 'failed',
      message: 'The log folder could not be opened. Copy the diagnostics instead.',
    };
  });

  handle('koma:diagnostics:copy', async () => {
    try {
      await clipboard.writeText(copiedText());
      return { status: 'done' };
    } catch {
      return { status: 'failed', message: 'The diagnostics could not be copied. Try again.' };
    }
  });
}
