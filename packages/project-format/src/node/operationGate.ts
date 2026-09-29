/**
 * At most this many project-file reads or writes run at once.
 * Each one may hold a document up to the project size limit, so the process
 * does not read or replace several of those files together.
 */
export const MAX_CONCURRENT_PROJECT_FILE_OPERATIONS = 1;

/**
 * Runs `work` while no more than `limit` operations started through the same
 * gate are in progress. A later operation waits for a free place.
 */
export function createOperationGate(limit: number): <T>(work: () => Promise<T>) => Promise<T> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('The operation limit must be a positive whole number.');
  }
  let active = 0;
  const waiters: Array<() => void> = [];

  return async function run<T>(work: () => Promise<T>): Promise<T> {
    if (active >= limit) {
      await new Promise<void>((resolve) => {
        waiters.push(resolve);
      });
    } else {
      active += 1;
    }

    try {
      return await work();
    } finally {
      const next = waiters.shift();
      if (next !== undefined) {
        next();
      } else {
        active -= 1;
      }
    }
  };
}

export const withProjectFileOperation = createOperationGate(MAX_CONCURRENT_PROJECT_FILE_OPERATIONS);
