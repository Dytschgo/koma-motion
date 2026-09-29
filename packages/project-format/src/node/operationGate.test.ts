import { describe, expect, it } from 'vitest';
import {
  MAX_CONCURRENT_PROJECT_FILE_OPERATIONS,
  createOperationGate,
  withProjectFileOperation,
} from './operationGate';

describe('createOperationGate', () => {
  it('runs no more operations than the limit', async () => {
    const gate = createOperationGate(2);
    let current = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const tasks = Array.from({ length: 5 }, () =>
      gate(async () => {
        current += 1;
        peak = Math.max(peak, current);
        await new Promise<void>((resolve) => {
          release.push(() => {
            current -= 1;
            resolve();
          });
        });
      }),
    );

    await flush();
    expect(current).toBe(2);
    expect(peak).toBe(2);

    while (release.length > 0) {
      const next = release.shift();
      next?.();
      await flush();
    }
    await Promise.all(tasks);
    expect(peak).toBe(2);
    expect(current).toBe(0);
  });

  it('frees a place when an operation fails', async () => {
    const gate = createOperationGate(1);
    await expect(gate(() => Promise.reject(new Error('disk full')))).rejects.toThrow('disk full');
    await expect(gate(() => Promise.resolve('done'))).resolves.toBe('done');
  });
});

describe('withProjectFileOperation', () => {
  it('uses the project file limit', async () => {
    let current = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const tasks = Array.from({ length: MAX_CONCURRENT_PROJECT_FILE_OPERATIONS + 2 }, () =>
      withProjectFileOperation(async () => {
        current += 1;
        peak = Math.max(peak, current);
        await new Promise<void>((resolve) => {
          release.push(() => {
            current -= 1;
            resolve();
          });
        });
      }),
    );
    await flush();
    expect(peak).toBe(MAX_CONCURRENT_PROJECT_FILE_OPERATIONS);
    expect(current).toBe(MAX_CONCURRENT_PROJECT_FILE_OPERATIONS);
    while (release.length > 0) {
      release.shift()?.();
      await flush();
    }
    await Promise.all(tasks);
  });
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
