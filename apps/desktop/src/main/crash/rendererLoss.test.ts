import { describe, expect, it } from 'vitest';
import {
  decideRendererLoss,
  LOSS_WINDOW_MS,
  rememberLoss,
  UNRESPONSIVE_DETAIL,
} from './rendererLoss';

describe('decideRendererLoss', () => {
  it('offers a reload for every reason a reload can help with', () => {
    for (const reason of [
      'crashed',
      'abnormal-exit',
      'killed',
      'clean-exit',
      'oom',
      'memory-eviction',
      'launch-failed',
      'a-reason-of-a-later-electron',
    ]) {
      const decision = decideRendererLoss(reason, [], 1000);
      expect(decision.canReload, reason).toBe(true);
      expect(decision.detail, reason).toContain('offered for recovery as an unsaved copy');
      expect(decision.detail, reason).toContain('Your project file has not been changed');
    }
  });

  it('names what happened when the reason says more than "stopped"', () => {
    expect(decideRendererLoss('crashed', [], 0).message).toBe(
      'The Koma Motion window stopped working.',
    );
    expect(decideRendererLoss('oom', [], 0).message).toBe(
      'The Koma Motion window ran out of memory.',
    );
    expect(decideRendererLoss('memory-eviction', [], 0).message).toContain('memory');
    expect(decideRendererLoss('launch-failed', [], 0).message).toBe(
      'The Koma Motion window could not start.',
    );
  });

  it('only quits when the code of the window failed its integrity check', () => {
    const decision = decideRendererLoss('integrity-failure', [], 0);
    expect(decision.canReload).toBe(false);
    expect(decision.detail).toContain('Install Koma Motion again');
    expect(decision.detail).toContain('offered for recovery');
  });

  it('stops offering a reload at the third loss within a minute', () => {
    expect(decideRendererLoss('crashed', [1000], 2000).canReload).toBe(true);
    const third = decideRendererLoss('crashed', [1000, 2000], 3000);
    expect(third.canReload).toBe(false);
    expect(third.message).toBe('The Koma Motion window keeps stopping.');
    // Losses that are a minute old no longer count.
    expect(decideRendererLoss('crashed', [1000, 2000], 1000 + LOSS_WINDOW_MS).canReload).toBe(true);
    expect(decideRendererLoss('crashed', [1000, 2000], 2000 + LOSS_WINDOW_MS).canReload).toBe(true);
  });

  it('remembers only the losses that still count', () => {
    expect(rememberLoss([], 5)).toEqual([5]);
    expect(rememberLoss([0, 30_000], 60_000)).toEqual([30_000, 60_000]);
    let losses: number[] = [];
    for (let time = 0; time < 100; time += 1) losses = rememberLoss(losses, time * 30_000);
    expect(losses).toHaveLength(2);
  });

  it('explains recovery in the question about a window that does not respond', () => {
    expect(UNRESPONSIVE_DETAIL).toContain('keep waiting');
    expect(UNRESPONSIVE_DETAIL).toContain('offered for recovery as an unsaved copy');
  });
});
