import { beforeEach, expect, it, vi } from 'vitest';
import { useAgentStore } from '../state/agentStore';
import { detectProviders } from './agentActions';
import { invoke } from './api';

vi.mock('./api', () => ({ invoke: vi.fn() }));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  useAgentStore.setState({ detection: 'idle', providers: [] });
});

it('shares an in-flight provider check so an older response cannot overwrite a newer check', async () => {
  let finish = () => undefined as void;
  vi.mocked(invoke).mockReturnValueOnce(
    new Promise<{ providers: [] }>((resolve) => {
      finish = () => resolve({ providers: [] });
    }),
  );
  const pending = detectProviders();
  await detectProviders();
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(useAgentStore.getState().detection).toBe('running');
  finish();
  await pending;
  expect(useAgentStore.getState().detection).toBe('done');
});

it('allows another check after a failure', async () => {
  vi.mocked(invoke).mockRejectedValueOnce(new Error('Connection failed'));
  await detectProviders();
  expect(useAgentStore.getState().detection).toBe('failed');
  vi.mocked(invoke).mockResolvedValueOnce({ providers: [] });
  await detectProviders();
  expect(useAgentStore.getState().detection).toBe('done');
  expect(invoke).toHaveBeenCalledTimes(2);
});
