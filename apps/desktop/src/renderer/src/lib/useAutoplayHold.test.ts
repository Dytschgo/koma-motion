// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAutoplayHold } from './useAutoplayHold';

beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] }));
afterEach(() => vi.useRealTimers());

it('keeps pause time out of two different Koma holds and resets after motion or navigation', () => {
  const onAdvance = vi.fn();
  const root = createRoot(document.createElement('div'));
  function Clock(props: Parameters<typeof useAutoplayHold>[0]) {
    useAutoplayHold(props);
    return null;
  }
  const render = (komaId: string, durationMs: number, enabled = true, paused = false) => {
    act(() => {
      root.render(createElement(Clock, { komaId, durationMs, enabled, paused, onAdvance }));
    });
  };
  const advance = (ms: number) => {
    act(() => {
      vi.advanceTimersByTime(ms);
    });
  };
  try {
    render('first', 1250);
    advance(750);
    expect(onAdvance).not.toHaveBeenCalled();
    render('first', 1250, true, true);
    advance(10000);
    expect(onAdvance).not.toHaveBeenCalled();
    render('first', 1250);
    advance(499);
    expect(onAdvance).not.toHaveBeenCalled();
    advance(1);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    render('first', 1250, false); // Transition animation: no hold countdown.
    advance(1500);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    render('second', 2500);
    advance(2499);
    expect(onAdvance).toHaveBeenCalledTimes(1);
    advance(1);
    expect(onAdvance).toHaveBeenCalledTimes(2);
    render('last', 5000, false); // Final Koma remains at End.
    advance(60000);
    expect(onAdvance).toHaveBeenCalledTimes(2);
    render('first', 1250);
    advance(1249);
    expect(onAdvance).toHaveBeenCalledTimes(2);
    advance(1);
    expect(onAdvance).toHaveBeenCalledTimes(3);
  } finally {
    act(() => {
      root.unmount();
    });
  }
});
