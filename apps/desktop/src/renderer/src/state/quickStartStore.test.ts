import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe('quick-start app preference', () => {
  it('restores only a valid completion value and never opens on launch', async () => {
    for (const value of [null, 'broken', 'false', 'true']) {
      vi.resetModules();
      vi.stubGlobal('window', { localStorage: { getItem: () => value } });
      const { useQuickStartStore } = await import('./quickStartStore');
      expect(useQuickStartStore.getState().completed).toBe(value === 'true');
      expect(useQuickStartStore.getState().open).toBe(false);
    }
  });

  it('keeps dismissal separate from completion and writes only the app preference', async () => {
    const setItem = vi.fn();
    vi.stubGlobal('window', { localStorage: { getItem: () => null, setItem } });
    const { useQuickStartStore, QUICK_START_PREFERENCE_KEY } = await import('./quickStartStore');
    const guide = useQuickStartStore.getState();
    guide.setOpen(true);
    guide.setOpen(false);
    expect(setItem).not.toHaveBeenCalled();
    guide.setCompleted(true);
    expect(setItem).toHaveBeenLastCalledWith(QUICK_START_PREFERENCE_KEY, 'true');
    guide.setOpen(true);
    expect(useQuickStartStore.getState().completed).toBe(true);
    guide.setCompleted(false);
    expect(setItem).toHaveBeenLastCalledWith(QUICK_START_PREFERENCE_KEY, 'false');
  });

  it('remains usable when storage is unavailable', async () => {
    vi.stubGlobal('window', {
      get localStorage() {
        throw new Error('Storage unavailable');
      },
    });
    const { useQuickStartStore } = await import('./quickStartStore');
    expect(useQuickStartStore.getState().completed).toBe(false);
    useQuickStartStore.getState().setCompleted(true);
    useQuickStartStore.getState().setOpen(true);
    expect(useQuickStartStore.getState()).toMatchObject({ completed: true, open: true });
  });
});
