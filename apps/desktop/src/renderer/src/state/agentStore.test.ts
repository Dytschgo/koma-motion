import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentStore } from './agentStore';

describe('agent store output', () => {
  beforeEach(() => {
    useAgentStore.setState({ execution: null, lastRun: null, conversation: [] });
  });

  it('keeps output of the running execution only', () => {
    const store = useAgentStore.getState();
    store.startExecution({
      executionId: 'execution-a',
      providerId: 'claude-code',
      providerName: 'Claude Code',
      streams: true,
      modelLabel: 'opus',
    });
    store.addOutput({ executionId: 'execution-a', attempt: 1, text: 'Three Komas.' });
    store.addOutput({ executionId: 'execution-b', attempt: 1, text: 'Another run.' });
    expect(useAgentStore.getState().execution?.output.text).toBe('Three Komas.');
  });

  it('ignores output that arrives after the run finished', () => {
    const store = useAgentStore.getState();
    store.startExecution({
      executionId: 'execution-a',
      providerId: 'claude-code',
      providerName: 'Claude Code',
      streams: true,
      modelLabel: 'opus',
    });
    store.addOutput({ executionId: 'execution-a', attempt: 1, text: 'On time.' });
    store.finishExecution('execution-a', 'completed');
    store.addOutput({ executionId: 'execution-a', attempt: 1, text: 'Late.' });
    const state = useAgentStore.getState();
    expect(state.execution).toBeNull();
    // The finished run stays for the monitor, without the late text.
    expect(state.lastRun?.executionId).toBe('execution-a');
    expect(state.lastRun?.output.text).toBe('On time.');
    expect(state.lastRun?.finishedAt).toBeGreaterThanOrEqual(state.lastRun?.startedAt ?? 0);
    useAgentStore.getState().clearConversation();
    expect(useAgentStore.getState().lastRun).toBeNull();
  });
});
