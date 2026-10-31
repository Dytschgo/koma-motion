import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentStore } from '../state/agentStore';
import { useUiStore } from '../state/uiStore';
import { cancelGeneration } from './agentActions';
import { invoke } from './api';

vi.mock('./api', () => ({ invoke: vi.fn() }));

function start(executionId = 'execution-a'): void {
  useAgentStore.getState().startExecution({
    executionId,
    providerId: 'mock',
    providerName: 'Mock provider',
    streams: true,
    modelLabel: 'built-in',
  });
}

describe('stopping generation', () => {
  beforeEach(() => {
    vi.mocked(invoke).mockReset();
    useAgentStore.setState({ execution: null, lastRun: null });
    useUiStore.setState({ notices: [] });
  });

  it('allows another stop attempt after IPC fails, preserving the running output', async () => {
    start();
    useAgentStore.getState().addOutput({ executionId: 'execution-a', attempt: 1, text: 'Working' });
    vi.mocked(invoke).mockRejectedValueOnce(new Error('IPC failed'));
    await cancelGeneration();
    expect(useAgentStore.getState().execution).toMatchObject({
      executionId: 'execution-a',
      cancelRequested: false,
      output: { text: 'Working' },
    });
    expect(useUiStore.getState().notices.at(-1)?.message).toContain('Try again');

    vi.mocked(invoke).mockResolvedValueOnce({ cancelled: true });
    await cancelGeneration();
    expect(invoke).toHaveBeenCalledTimes(2);
    expect(invoke).toHaveBeenLastCalledWith('koma:providers:cancel', {
      executionId: 'execution-a',
    });
    expect(useAgentStore.getState().execution?.cancelRequested).toBe(true);
  });

  it('sends only one stop request while an acknowledgment is pending', async () => {
    start();
    let acknowledge = (): void => undefined;
    const reply = new Promise<{ cancelled: boolean }>((resolve) => {
      acknowledge = () => resolve({ cancelled: true });
    });
    vi.mocked(invoke).mockReturnValueOnce(reply);
    const stopping = cancelGeneration();
    await cancelGeneration();
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(useAgentStore.getState().execution?.cancelRequested).toBe(true);
    acknowledge();
    await stopping;
    expect(useAgentStore.getState().execution?.cancelRequested).toBe(true);
  });

  it.each(['finished', 'replaced'] as const)(
    'ignores a late stop failure when its run has been %s',
    async (outcome) => {
      start();
      let rejectStop = (): void => undefined;
      const reply = new Promise<never>((_resolve, reject) => {
        rejectStop = () => reject(new Error('Late failure'));
      });
      vi.mocked(invoke).mockReturnValueOnce(reply);
      const stopping = cancelGeneration();
      useAgentStore.getState().finishExecution('execution-a', 'completed');
      if (outcome === 'replaced') {
        start('execution-b');
        useAgentStore.getState().requestCancel();
      }
      const before = useAgentStore.getState();
      rejectStop();
      await stopping;
      expect(useAgentStore.getState().execution).toBe(before.execution);
      expect(useAgentStore.getState().lastRun).toBe(before.lastRun);
      expect(useUiStore.getState().notices).toEqual([]);
    },
  );

  it('does not send a stop request when no run is active', async () => {
    await cancelGeneration();
    expect(invoke).not.toHaveBeenCalled();
  });
});
