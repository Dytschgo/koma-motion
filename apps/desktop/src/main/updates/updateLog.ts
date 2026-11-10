/**
 * Updating in the diagnostics log: what the native updater reports, and each
 * change of the update state. A failed update is the kind of problem a user
 * can only describe with these lines.
 */
import type { Logger } from 'electron-updater';
import type { UpdateStatus } from '../../shared/updates';
import type { DiagnosticLevel, Diagnostics } from '../diagnostics/log';

function toText(message: unknown): string {
  if (message instanceof Error) {
    return `${message.name}: ${message.message}\n${message.stack ?? ''}`;
  }
  return typeof message === 'string' ? message : `[${typeof message}]`;
}

/**
 * The logger of electron-updater. Its messages name versions, release files
 * and local cache paths; the log scrubs the paths. Debug output is left out.
 */
export function createUpdaterLogger(log: Diagnostics): Logger {
  const write =
    (level: DiagnosticLevel) =>
    (message?: unknown): void => {
      log.write(level, 'updater.message', { message: toText(message) });
    };
  return { info: write('info'), warn: write('warn'), error: write('error') };
}

/**
 * Records a status when the state, the version or the channel changed.
 * Download progress alone is not recorded.
 */
export function createUpdateStatusRecorder(log: Diagnostics): (status: UpdateStatus) => void {
  let last = '';
  return (status) => {
    const facts = {
      state: status.state,
      channel: status.channel,
      version: status.version,
      sourceChannel: status.sourceChannel,
      manual: status.manualDownload,
      installing: status.installing,
    };
    const key = JSON.stringify(facts);
    if (key === last) {
      return;
    }
    last = key;
    if (status.state === 'error') {
      log.write('error', 'updater.status', { ...facts, message: status.message });
    } else {
      log.write('info', 'updater.status', facts);
    }
  };
}
