import {
  ClaudeCodeProvider,
  CodexCliProvider,
  GrokCliProvider,
} from '@koma-motion/agent-runtime/node';
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
import type { BrandKitLibrary } from '../services/brandKitLibrary';
import { generatePresentation } from '../services/generation';
import { selectLogo } from '../services/logo';
import { InstructionTemplateLibrary } from '../services/instructionTemplates';
import {
  canCompleteSaveAndClose,
  createNewProject,
  openProject,
  saveProject,
  saveProjectAs,
  type ProjectSession,
} from '../services/projectFiles';
import type { UpdateService } from '../updates/service';
import { limitProjectPersistence, rejectedRequestMessage } from './persistence';

export interface WindowContext {
  readonly window: BrowserWindow;
  readonly session: ProjectSession;
  readonly updates: UpdateService;
  /** Saved Brand Kits of this computer, shared by every project. */
  readonly brandKits: BrandKitLibrary;
  /** Closes the window without asking about unsaved changes again. */
  closeConfirmed(): void;
  /** Called when the unsaved state or the file of the project changes. */
  projectStateChanged(): void;
}

type Handler<C extends IpcChannel> = (
  request: ReturnType<(typeof ipcContract)[C]['request']['parse']>,
) => Promise<IpcResponse<C>> | IpcResponse<C>;

// App scope, including across project/window replacement. Paths never come from the renderer.
const instructionTemplates = new InstructionTemplateLibrary(() => app.getPath('userData'));

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
    new GrokCliProvider(),
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
      const request = await limitProjectPersistence(channel, () =>
        Promise.resolve(ipcContract[channel].request.safeParse(payload)),
      );
      if (!request.success) {
        throw new Error(rejectedRequestMessage(channel, request.error.issues));
      }
      const response = await handler(request.data as Parameters<Handler<C>>[0]);
      return ipcContract[channel].response.parse(response);
    });
  };

  handle('koma:project:create', ({ name }) => {
    runner.cancelAll();
    const response = createNewProject(session, name, new Date());
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:open', async () => {
    const response = await openProject(window, session);
    if (response.status === 'opened') {
      runner.cancelAll();
    }
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:save', async ({ project }) => {
    const response = await saveProject(window, session, project, new Date());
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:save-as', async ({ project, preserveOriginal }) => {
    const response = await saveProjectAs(
      window,
      session,
      project,
      new Date(),
      session.sessionId,
      preserveOriginal,
    );
    context.projectStateChanged();
    return response;
  });

  handle('koma:brand-kit:select-logo', () => selectLogo(window));
  handle('koma:project:select-image', () => selectLogo(window, 'Choose an image'));

  handle('koma:instruction-templates:list', async () => {
    try {
      return { status: 'loaded', templates: await instructionTemplates.list() };
    } catch {
      return {
        status: 'failed',
        message:
          'The template library could not be loaded. Your saved templates have not been changed. Retry after checking the app data folder.',
      };
    }
  });

  handle('koma:instruction-templates:change', async (action) => {
    try {
      return { status: 'saved', templates: await instructionTemplates.change(action) };
    } catch {
      return {
        status: 'failed',
        message:
          'The template could not be saved. Your input has been kept. Reload the library and try again; check its limit of 100 templates and access to the app data folder.',
      };
    }
  });

  const { brandKits } = context;
  handle('koma:brand-kits:list', () => brandKits.list());
  handle('koma:brand-kits:create', (request) => brandKits.create(request));
  handle('koma:brand-kits:update', ({ id, brandKit, logo }) =>
    brandKits.update(id, { brandKit, logo }),
  );
  handle('koma:brand-kits:rename', ({ id, name }) => brandKits.rename(id, name));
  handle('koma:brand-kits:duplicate', ({ id }) => brandKits.duplicate(id));
  handle('koma:brand-kits:delete', ({ id }) => brandKits.remove(id));
  handle('koma:brand-kits:load', ({ id }) => brandKits.load(id));
  handle('koma:brand-kits:start-new', () => brandKits.startNew());

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
    // Refuse when the project was replaced or still has edits the save did not include.
    if (!canCompleteSaveAndClose(session)) {
      return {};
    }
    session.saveAndCloseSessionId = null;
    context.closeConfirmed();
    return {};
  });

  /** Runs an update action and turns a failure into a message for the user. */
  const act = async (
    action: () => Promise<unknown>,
  ): Promise<IpcResponse<'koma:updates:check'>> => {
    try {
      await action();
      return { status: 'done' };
    } catch (error) {
      return {
        status: 'failed',
        message: error instanceof Error ? error.message : 'The update action failed.',
      };
    }
  };

  handle('koma:updates:get-status', () => context.updates.getStatus());

  handle('koma:updates:check', () => act(() => context.updates.check()));

  handle('koma:updates:set-channel', ({ channel }) =>
    act(() => context.updates.setChannel(channel)),
  );

  handle('koma:updates:download', () => act(() => context.updates.download()));

  handle('koma:updates:install', () =>
    act(() => {
      // Installing restarts the application. Unsaved work must not be lost to it.
      if (session.hasUnsavedChanges) {
        return Promise.reject(new Error('Save your project before you restart to install.'));
      }
      return context.updates.install();
    }),
  );

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
