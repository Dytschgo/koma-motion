import { beforeEach, describe, expect, it } from 'vitest';
import { useAgentStore } from './agentStore';

describe('agent store output', () => {
  beforeEach(() => {
    useAgentStore.setState({ execution: null, conversation: [] });
  });

  it('keeps output of the running execution only', () => {
    const store = useAgentStore.getState();
    store.startExecution({
      executionId: 'execution-a',
      providerId: 'claude-code',
      providerName: 'Claude Code',
      streams: true,
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
    });
    store.finishExecution('execution-a');
    store.addOutput({ executionId: 'execution-a', attempt: 1, text: 'Late.' });
    expect(useAgentStore.getState().execution).toBeNull();
  });
});
