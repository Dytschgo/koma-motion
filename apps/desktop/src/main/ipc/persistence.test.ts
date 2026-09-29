import { PROJECT_TOO_LARGE_MESSAGE } from '@koma-motion/core';
import { describe, expect, it } from 'vitest';
import { limitProjectPersistence, rejectedRequestMessage } from './persistence';

describe('limitProjectPersistence', () => {
  it('runs project file channels one at a time and does not limit other channels', async () => {
    let current = 0;
    let peak = 0;
    const release: Array<() => void> = [];
    const hold = (): Promise<void> => {
      current += 1;
      peak = Math.max(peak, current);
      return new Promise((resolve) => {
        release.push(() => {
          current -= 1;
          resolve();
        });
      });
    };

    const save = limitProjectPersistence('koma:project:save', hold);
    const open = limitProjectPersistence('koma:project:open', hold);
    const info = limitProjectPersistence('koma:app:get-info', hold);
    await flush();

    expect(peak).toBe(2);
    expect(current).toBe(2);
    expect(release).toHaveLength(2);

    while (release.length > 0) {
      release.shift()?.();
      await flush();
    }
    await Promise.all([save, open, info]);
    expect(peak).toBe(2);
    expect(current).toBe(0);
  });
});

describe('rejectedRequestMessage', () => {
  it('names the size limit without copying the request', () => {
    expect(
      rejectedRequestMessage('koma:project:save', [{ message: PROJECT_TOO_LARGE_MESSAGE }]),
    ).toBe(PROJECT_TOO_LARGE_MESSAGE);
    expect(rejectedRequestMessage('koma:project:save', [{ message: 'Bad name' }])).toBe(
      'Invalid request for koma:project:save',
    );
  });
});

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
