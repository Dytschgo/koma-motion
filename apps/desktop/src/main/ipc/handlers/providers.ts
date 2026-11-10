import { GenerationRunner, type ProviderModelListing } from '@koma-motion/agent-runtime';
import { createRandomIdGenerator } from '@koma-motion/core';
import { app, nativeImage } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { generatePresentation, regenerateTransition } from '../../services/generation';
import { createOutputBatcher } from '../../services/outputBatcher';
import type { HandlerScope } from './scope';

/** Coding agents: detecting them, listing their models and running generations. */
export function registerProviderHandlers({
  handle,
  send,
  registry,
}: Omit<HandlerScope, 'context' | 'cancelWork'>): {
  /** Stops every generation that is running. */
  cancelAll(): void;
  /** Also stops model listings, for a window that goes away. */
  dispose(): void;
} {
  const runner = new GenerationRunner({ registry });
  const imageExecutions = new Map<string, AbortController>();
  const cancelAll = (): void => {
    runner.cancelAll();
    for (const controller of imageExecutions.values()) controller.abort();
  };
  const idGenerator = createRandomIdGenerator();

  handle('koma:providers:detect', async () => ({ providers: await registry.detectAll() }));

  // Listing starts a short CLI run. It is stopped when the window goes away.
  const listing = new AbortController();
  const pendingListings = new Map<string, Promise<ProviderModelListing>>();
  handle('koma:providers:list-models', async ({ providerId }) => {
    const provider = registry.get(providerId);
    if (provider?.listModels === undefined) {
      return { status: 'unsupported' as const };
    }
    const pending = pendingListings.get(providerId);
    if (pending) return pending;
    const request = provider
      .listModels(listing.signal)
      .finally(() => pendingListings.delete(providerId));
    pendingListings.set(providerId, request);
    return request;
  });

  handle('koma:providers:execute', async ({ executionId, providerId, project, input }) => {
    if (imageExecutions.has(executionId)) throw new Error('This execution is already running.');
    const controller = new AbortController();
    imageExecutions.set(executionId, controller);
    const signal =
      project.agentConfiguration.timeoutSeconds === null
        ? controller.signal
        : AbortSignal.any([
            controller.signal,
            AbortSignal.timeout(project.agentConfiguration.timeoutSeconds * 1000),
          ]);
    const output = createOutputBatcher((event) => {
      send('koma:providers:output', event);
    });
    try {
      return await generatePresentation({
        runner,
        executionId,
        providerId,
        project,
        input,
        signal,
        ...(!app.isPackaged && providerId === 'mock' && process.env['KOMA_MOCK_IMAGES']
          ? {
              generateImage: async (_prompt: string, imageSignal: AbortSignal) => {
                await delay(1000, undefined, { signal: imageSignal });
                if (process.env['KOMA_MOCK_IMAGES'] === 'failure')
                  throw new Error('Mock image generation failed.');
                return nativeImage
                  .createFromBitmap(Buffer.alloc(32 * 32 * 4, 180), { width: 32, height: 32 })
                  .toPNG();
              },
            }
          : {}),
        idGenerator,
        now: () => new Date(),
        onStatus: (status) => {
          // Output written before a phase change is shown before that phase.
          output.flush();
          send('koma:providers:status', status);
        },
        onOutput: output.push,
      });
    } finally {
      imageExecutions.delete(executionId);
      // Nothing is sent after the outcome: the window ignores late output anyway.
      output.close();
    }
  });

  handle(
    'koma:providers:regenerate-transition',
    ({ executionId, providerId, project, transitionId }) =>
      regenerateTransition({
        runner,
        executionId,
        providerId,
        project,
        transitionId,
        now: () => new Date(),
        onStatus: (status) => {
          send('koma:providers:status', status);
        },
      }),
  );

  handle('koma:providers:cancel', ({ executionId }) => {
    const images = imageExecutions.get(executionId);
    images?.abort();
    return { cancelled: runner.cancel(executionId) || images !== undefined };
  });

  return {
    cancelAll,
    dispose() {
      cancelAll();
      listing.abort();
    },
  };
}
