import {
  ClaudeCodeProvider,
  CodexCliProvider,
  GrokCliProvider,
} from '@koma-motion/agent-runtime/node';
import {
  MockAgentProvider,
  ProviderRegistry,
  type MockAgentProviderOptions,
} from '@koma-motion/agent-runtime';
import { app, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { ipcContract, ipcEvents } from '../../shared/ipc';
import { observeIpc, registerDiagnosticsHandlers } from '../diagnostics';
import { isTrustedSender } from '../security';
import type { HandleChannel, Handler } from './handle';
import { registerApplicationHandlers } from './handlers/application';
import { registerBrandHandlers } from './handlers/brand';
import { registerProjectHandlers } from './handlers/project';
import { registerProviderHandlers } from './handlers/providers';
import type { SendEvent, WindowContext } from './handlers/scope';
import { limitProjectPersistence, rejectedRequestMessage } from './persistence';

export type { WindowContext } from './handlers/scope';

/**
 * Test settings of the mock provider for builds that are not packaged:
 * `KOMA_MOCK_DELAY_MS` (0 to 60000) and `KOMA_MOCK_OUTCOME=invalid`. A
 * packaged application ignores them.
 */
export function readMockOptions(environment: NodeJS.ProcessEnv): MockAgentProviderOptions {
  const delay = Number(environment['KOMA_MOCK_DELAY_MS']);
  return {
    ...(environment['KOMA_MOCK_IMAGES'] ? { imageRequests: true } : {}),
    ...(Number.isSafeInteger(delay) && delay >= 0 && delay <= 60_000 ? { delayMs: delay } : {}),
    ...(environment['KOMA_MOCK_OUTCOME'] === 'invalid' ? { outcome: 'invalid' as const } : {}),
  };
}

/**
 * Registers the handlers of every channel in the contract. Requests from
 * unexpected senders and requests that do not match their schema are rejected
 * before a handler runs. The handlers themselves are in `handlers/`, one
 * module per feature.
 */
export function registerHandlers(context: WindowContext): {
  /** Stops generations and analyses, for a window that lost its page. */
  cancelWork(): void;
  dispose(): void;
} {
  const { window } = context;
  const registry = new ProviderRegistry([
    new MockAgentProvider(app.isPackaged ? {} : readMockOptions(process.env)),
    new ClaudeCodeProvider(),
    new CodexCliProvider(),
    new GrokCliProvider(),
  ]);

  const send: SendEvent = (channel, payload) => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, ipcEvents[channel].parse(payload));
    }
  };

  const handle: HandleChannel = (channel, handler) => {
    const listener = async (event: IpcMainInvokeEvent, payload: unknown): Promise<unknown> => {
      if (!isTrustedSender(event, window.webContents)) {
        throw new Error('Request rejected');
      }
      const request = await limitProjectPersistence(channel, () =>
        Promise.resolve(ipcContract[channel].request.safeParse(payload)),
      );
      if (!request.success) {
        throw new Error(rejectedRequestMessage(channel, request.error.issues));
      }
      const response = await handler(request.data as Parameters<Handler<typeof channel>>[0]);
      return ipcContract[channel].response.parse(response);
    };
    ipcMain.handle(channel, observeIpc(channel, listener));
  };

  registerDiagnosticsHandlers(handle);
  const brand = registerBrandHandlers({ context, handle, send, registry });
  const providers = registerProviderHandlers({ handle, send, registry });
  const cancelWork = (): void => {
    void brand.cancel();
    providers.cancelAll();
  };
  registerProjectHandlers({ context, handle, cancelWork });
  registerApplicationHandlers({ context, handle });

  // Analyses end their helper processes before the application quits.
  let shuttingDown = false;
  let shutdownComplete = false;
  const beforeQuit = (event: Electron.Event): void => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    void brand.cancel().finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  };
  app.on('before-quit', beforeQuit);

  return {
    cancelWork,
    dispose() {
      void brand.cancel();
      providers.dispose();
      for (const channel of Object.keys(ipcContract)) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
