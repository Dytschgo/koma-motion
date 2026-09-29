import { ClaudeCodeProvider, CodexCliProvider } from '@koma-motion/agent-runtime/node';
import { GenerationRunner, MockAgentProvider, ProviderRegistry } from '@koma-motion/agent-runtime';
import { createRandomIdGenerator } from '@koma-motion/core';
import { createExporters } from '@koma-motion/exporters';
import { app, ipcMain, type BrowserWindow } from 'electron';
import {
  ipcContract,
  ipcEvents,
  type IpcChannel,
  type IpcEventChannel,
  type IpcEventPayload,
  type IpcResponse,
} from '../../shared/ipc';
import { isTrustedSender } from '../security';
import { generatePresentation } from '../services/generation';
import { selectLogo } from '../services/logo';
import {
  createNewProject,
  openProject,
  saveProject,
  saveProjectAs,
  type ProjectSession,
} from '../services/projectFiles';

export interface WindowContext {
  readonly window: BrowserWindow;
  readonly session: ProjectSession;
  /** Closes the window without asking about unsaved changes again. */
  closeConfirmed(): void;
  /** Called when the unsaved state or the file of the project changes. */
  projectStateChanged(): void;
}

type Handler<C extends IpcChannel> = (
  request: ReturnType<(typeof ipcContract)[C]['request']['parse']>,
) => Promise<IpcResponse<C>> | IpcResponse<C>;

function getPlatform(): IpcResponse<'koma:app:get-info'>['platform'] {
  switch (process.platform) {
    case 'win32':
      return 'windows';
    case 'darwin':
      return 'macos';
    default:
      return 'other';
  }
}

/**
 * Registers the handlers of every channel in the contract. Requests from
 * unexpected senders and requests that do not match their schema are rejected
 * before a handler runs.
 */
export function registerHandlers(context: WindowContext): { dispose(): void } {
  const { window, session } = context;
  const registry = new ProviderRegistry([
    new MockAgentProvider(),
    new ClaudeCodeProvider(),
    new CodexCliProvider(),
  ]);
  const runner = new GenerationRunner({ registry });
  const idGenerator = createRandomIdGenerator();

  const send = <C extends IpcEventChannel>(channel: C, payload: IpcEventPayload<C>): void => {
    if (!window.isDestroyed()) {
      window.webContents.send(channel, ipcEvents[channel].parse(payload));
    }
  };

  const handle = <C extends IpcChannel>(channel: C, handler: Handler<C>): void => {
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!isTrustedSender(event, window.webContents)) {
        throw new Error('Request rejected');
      }
      const request = ipcContract[channel].request.safeParse(payload);
      if (!request.success) {
        throw new Error(`Invalid request for ${channel}`);
      }
      const response = await handler(request.data as Parameters<Handler<C>>[0]);
      return ipcContract[channel].response.parse(response);
    });
  };

  handle('koma:project:create', ({ name }) => {
    const response = createNewProject(session, name, new Date());
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:open', async () => {
    const response = await openProject(window, session);
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:save', async ({ project }) => {
    const response = await saveProject(window, session, project, new Date());
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:save-as', async ({ project }) => {
    const response = await saveProjectAs(window, session, project, new Date());
    context.projectStateChanged();
    return response;
  });

  handle('koma:brand-kit:select-logo', () => selectLogo(window));

  handle('koma:providers:detect', async () => ({ providers: await registry.detectAll() }));

  handle('koma:providers:execute', ({ executionId, providerId, project, input }) =>
    generatePresentation({
      runner,
      executionId,
      providerId,
      project,
      input,
      idGenerator,
      now: () => new Date(),
      onStatus: (status) => {
        send('koma:providers:status', status);
      },
    }),
  );

  handle('koma:providers:cancel', ({ executionId }) => ({
    cancelled: runner.cancel(executionId),
  }));

  handle('koma:app:set-unsaved-changes', ({ hasUnsavedChanges }) => {
    session.hasUnsavedChanges = hasUnsavedChanges;
    context.projectStateChanged();
    return {};
  });

  handle('koma:app:confirm-close', () => {
    context.closeConfirmed();
    return {};
  });

  handle('koma:app:get-info', () => ({
    version: app.getVersion(),
    platform: getPlatform(),
    exporters: createExporters().map((exporter) => ({
      id: exporter.id,
      displayName: exporter.displayName,
      available: exporter.availability.status === 'available',
      note: exporter.availability.status === 'available' ? '' : exporter.availability.reason,
    })),
  }));

  return {
    dispose() {
      runner.cancelAll();
      for (const channel of Object.keys(ipcContract)) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
