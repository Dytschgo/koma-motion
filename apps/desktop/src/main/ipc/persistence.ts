import { PROJECT_TOO_LARGE_MESSAGE } from '@koma-motion/core';
import { withProjectFileOperation } from '@koma-motion/project-format/node';

/** Channels that read or write the project file. Dialogs stay outside the limit. */
export const PROJECT_PERSISTENCE_CHANNELS = [
  'koma:project:open',
  'koma:project:save',
  'koma:project:save-as',
] as const;

export function isProjectPersistenceChannel(channel: string): boolean {
  return (PROJECT_PERSISTENCE_CHANNELS as readonly string[]).includes(channel);
}

/**
 * Validates a persistence request under the same limit as reading and writing
 * the project file. The native dialog is shown by the handler afterwards, so
 * an open dialog does not hold the limit.
 */
export function limitProjectPersistence<T>(channel: string, work: () => Promise<T>): Promise<T> {
  return isProjectPersistenceChannel(channel) ? withProjectFileOperation(work) : work();
}

/** A fixed sentence. Request contents are not copied into the error. */
export function rejectedRequestMessage(
  channel: string,
  issues: readonly { readonly message: string }[],
): string {
  return issues.some((issue) => issue.message === PROJECT_TOO_LARGE_MESSAGE)
    ? PROJECT_TOO_LARGE_MESSAGE
    : `Invalid request for ${channel}`;
}
