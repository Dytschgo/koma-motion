import {
  ClaudeCodeProvider,
  CodexCliProvider,
  GrokCliProvider,
} from '@koma-motion/agent-runtime/node';
import {
  GenerationRunner,
  MockAgentProvider,
  ProviderRegistry,
  type MockAgentProviderOptions,
} from '@koma-motion/agent-runtime';
import { createRandomIdGenerator } from '@koma-motion/core';
import { createExporters } from '@koma-motion/exporters';
import { app, dialog, ipcMain, nativeImage, type BrowserWindow } from 'electron';
import { setTimeout as delay } from 'node:timers/promises';
import { DeckAnalysisService } from '../services/deckAnalysis';
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
import { createOutputBatcher } from '../services/outputBatcher';
import { generatePresentation, regenerateTransition } from '../services/generation';
import { selectLogo } from '../services/logo';
import { exportPowerPoint, validatePowerPoint } from '../services/powerPointExport';
import { selectReferenceFiles } from '../services/referenceFiles';
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
 * before a handler runs.
 */
export function registerHandlers(context: WindowContext): { dispose(): void } {
  const { window, session } = context;
  const registry = new ProviderRegistry([
    new MockAgentProvider(app.isPackaged ? {} : readMockOptions(process.env)),
    new ClaudeCodeProvider(),
    new CodexCliProvider(),
    new GrokCliProvider(),
  ]);
  const runner = new GenerationRunner({ registry });
  const imageExecutions = new Map<string, AbortController>();
  const cancelAllGenerations = (): void => {
    runner.cancelAll();
    for (const controller of imageExecutions.values()) controller.abort();
  };
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

  const decks = new DeckAnalysisService({
    registry,
    library: context.brandKits,
    allowMock: !app.isPackaged,
    progress: (event) => send('koma:deck:progress', event),
    select: async () => {
      const result = await dialog.showOpenDialog(window, {
        title: 'Create Brand Kit from deck',
        filters: [{ name: 'Presentation decks', extensions: ['pptx', 'pdf'] }],
        properties: ['openFile'],
      });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });
  let shuttingDown = false;
  let shutdownComplete = false;
  const beforeQuit = (event: Electron.Event): void => {
    if (shutdownComplete) return;
    event.preventDefault();
    if (shuttingDown) return;
    shuttingDown = true;
    void decks.cancel().finally(() => {
      shutdownComplete = true;
      app.quit();
    });
  };
  app.on('before-quit', beforeQuit);
  handle('koma:deck:capabilities', async () => ({
    allowMock: !app.isPackaged,
    claude: await registry.get('claude-code')!.detect(),
  }));
  handle('koma:deck:prepare', ({ sessionId }) => decks.prepare(sessionId));
  handle('koma:deck:analyze', ({ sessionId, provider }) => decks.analyze(sessionId, provider));
  handle('koma:deck:cancel', async ({ sessionId }) => {
    await decks.cancel(sessionId);
    return {};
  });
  handle('koma:deck:save', ({ sessionId, name, brandKit, logoCandidateId }) =>
    decks.save(sessionId, name, brandKit, logoCandidateId),
  );

  handle('koma:project:create', ({ name }) => {
    void decks.cancel();
    cancelAllGenerations();
    const response = createNewProject(session, name, new Date());
    context.projectStateChanged();
    return response;
  });

  handle('koma:project:open', async () => {
    const response = await openProject(window, session);
    if (response.status === 'opened') {
      void decks.cancel();
      cancelAllGenerations();
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
  handle('koma:references:select', () => selectReferenceFiles(window));
  handle('koma:export:validate', ({ project }) => validatePowerPoint(project));
  handle('koma:export:powerpoint', ({ project, options }) =>
    exportPowerPoint(window, project, options, () => session.sessionId),
  );
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

  // Listing starts a short CLI run. It is stopped when the window goes away.
  const listing = new AbortController();
  handle('koma:providers:list-models', async ({ providerId }) => {
    const provider = registry.get(providerId);
    if (provider?.listModels === undefined) {
      return { status: 'unsupported' as const };
    }
    return provider.listModels(listing.signal);
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

  // Set while a presentation made the window full screen: true when it was
  // not full screen before, so ending the presentation gives it back.
  let windowedBeforePresentation: boolean | null = null;
  handle('koma:app:set-full-screen', ({ mode }) => {
    if (mode === 'enter') {
      windowedBeforePresentation ??= !window.isFullScreen();
      window.setFullScreen(true);
      return { fullScreen: true };
    }
    if (mode === 'leave') {
      window.setFullScreen(false);
      return { fullScreen: false };
    }
    const restore = windowedBeforePresentation === true;
    windowedBeforePresentation = null;
    if (restore) {
      window.setFullScreen(false);
    }
    return { fullScreen: restore ? false : window.isFullScreen() };
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
      void decks.cancel();
      cancelAllGenerations();
      listing.abort();
      for (const channel of Object.keys(ipcContract)) {
        ipcMain.removeHandler(channel);
      }
    },
  };
}
