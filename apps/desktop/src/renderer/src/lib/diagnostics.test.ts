import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProject } from '@koma-motion/core/testing';
import { useProjectStore } from '../state/projectStore';
import { invoke } from './api';
import { preserveWork } from './diagnostics';
import { flushRecovery, followRecovery } from './recovery';

vi.mock('./api', () => ({ invoke: vi.fn() }));
let stop = () => {};
const project = buildProject();

function channels(): unknown[] {
  return vi.mocked(invoke).mock.calls.map(([channel]) => channel);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue({ status: 'stored' });
  useProjectStore.getState().load(project, null, [], null, [], crypto.randomUUID(), true);
  stop = followRecovery();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('preserving work after the interface failed', () => {
  it('does not capture the document that the interface could not show', async () => {
    useProjectStore.getState().apply((current) => ({ ...current, name: 'Edit before the error' }));
    await preserveWork();
    // The edit was still waiting for its debounce. It is not written now, and not later.
    stop();
    await vi.advanceTimersByTimeAsync(5000);
    expect(channels()).toEqual(['koma:app:set-unsaved-changes']);
    expect(invoke).toHaveBeenCalledWith('koma:app:set-unsaved-changes', {
      hasUnsavedChanges: false,
    });
  });

  it('waits for a capture that was already sent before the window stops asking to save', async () => {
    let answer = (): void => undefined;
    vi.mocked(invoke).mockImplementation((channel) =>
      channel === 'koma:recovery:capture'
        ? new Promise((resolve) => {
            answer = () => resolve({ status: 'stored' });
          })
        : Promise.resolve({}),
    );
    useProjectStore.getState().apply((current) => ({ ...current, name: 'Captured edit' }));
    void flushRecovery();
    const preserved = preserveWork();
    await vi.advanceTimersByTimeAsync(0);
    expect(channels()).toEqual(['koma:recovery:capture']);
    answer();
    await preserved;
    expect(channels()).toEqual(['koma:recovery:capture', 'koma:app:set-unsaved-changes']);
  });

  it('does not fail when the main process cannot be told', async () => {
    vi.mocked(invoke).mockRejectedValue(new Error('The window is closing.'));
    await expect(preserveWork()).resolves.toBeUndefined();
  });
});
