import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildProject } from '@koma-motion/core/testing';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from '../state/projectStore';
import { invoke } from './api';
import { flushRecovery, followRecovery, useRecoveryStatus } from './recovery';

vi.mock('./api', () => ({ invoke: vi.fn() }));
let stop = () => {};
const project = buildProject();
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockResolvedValue({ status: 'stored' });
  useProjectStore.getState().load(project, null);
  stop = followRecovery();
});
afterEach(() => {
  stop();
  vi.useRealTimers();
});

describe('committed-document recovery subscription', () => {
  it('debounces edits, flushes the newest document, and does not persist UI state', async () => {
    const epoch = crypto.randomUUID();
    useProjectStore.getState().load(project, null, [], null, [], epoch, true);
    useProjectStore.getState().apply((project) => ({ ...project, name: 'First' }));
    await vi.advanceTimersByTimeAsync(400);
    useProjectStore.getState().apply((project) => ({ ...project, name: 'Newest' }));
    expect(invoke).not.toHaveBeenCalled();
    await flushRecovery();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(vi.mocked(invoke).mock.calls[0]?.[1]).toHaveProperty('project.name', 'Newest');
    expect(invoke).toHaveBeenLastCalledWith(
      'koma:recovery:capture',
      expect.objectContaining({
        sessionId: epoch,
        dirty: true,
      }),
    );
    expect(useRecoveryStatus.getState().message).toBe('Recovery snapshot saved');
    await vi.advanceTimersByTimeAsync(1000);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it('drops a pending old-session snapshot on project replacement', async () => {
    const old = crypto.randomUUID();
    useProjectStore.getState().load(project, null, [], null, [], old, true);
    const current = crypto.randomUUID();
    useProjectStore.getState().load(project, null, [], null, [], current, true);
    await vi.advanceTimersByTimeAsync(600);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(
      'koma:recovery:capture',
      expect.objectContaining({ sessionId: current }),
    );
  });

  it('a recovered document stays dirty until its exact current document saves', async () => {
    useProjectStore.getState().load(project, null, [], null, [], crypto.randomUUID(), true);
    expect(useProjectStore.getState().file).toBeNull();
    expect(useProjectStore.getState().savedProject).toBeNull();
    const claim = useProjectStore.getState().claimSave();
    if (!claim) throw new Error('Expected save claim');
    useProjectStore.getState().apply((project) => ({ ...project, name: 'Edited during save' }));
    useProjectStore
      .getState()
      .markSaved(project, project, { fileName: 'copy.koma', displayPath: 'copy.koma' }, claim);
    await flushRecovery();
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(true);
    expect(selectProject(useProjectStore.getState())?.name).toBe('Edited during save');
    expect(invoke).toHaveBeenLastCalledWith(
      'koma:recovery:capture',
      expect.objectContaining({ dirty: true }),
    );
  });

  it('shows a failed snapshot honestly and allows an awaitable retry', async () => {
    useProjectStore.getState().load(project, null, [], null, [], crypto.randomUUID(), true);
    vi.mocked(invoke).mockResolvedValueOnce({ status: 'failed', message: 'Disk full' });
    await flushRecovery();
    expect(useRecoveryStatus.getState()).toEqual({ failed: true, message: 'Disk full' });
    await flushRecovery();
    expect(useRecoveryStatus.getState()).toEqual({
      failed: false,
      message: 'Recovery snapshot saved',
    });
  });
});
