import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_EMBEDDED_ASSET_CHARACTERS,
  MAX_PROJECT_FILE_BYTES,
  PROJECT_TOO_LARGE_MESSAGE,
} from '@koma-motion/core';
import { buildBrandKit, buildProject } from '@koma-motion/core/testing';
import { withProjectFileOperation } from '@koma-motion/project-format/node';
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_URL } from '../securityPolicy';
import { createBrandKitLibrary } from '../services/brandKitLibrary';
import { createProjectSession } from '../services/projectFiles';
import { readMockOptions, registerHandlers } from './registerHandlers';

const ipcHandlers = vi.hoisted(
  () => new Map<string, (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>>(),
);
const templateLocation = vi.hoisted(() => ({ directory: '' }));
const dialogs = vi.hoisted(() => ({
  showOpenDialog: vi.fn(() => Promise.resolve({ canceled: true, filePaths: [] as string[] })),
  showSaveDialog: vi.fn(() => Promise.resolve({ canceled: true, filePath: '' })),
}));

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    getVersion: () => '0.0.0-test',
    getPath: () => templateLocation.directory,
    isPackaged: true,
  },
  ipcMain: {
    handle: (
      channel: string,
      listener: (event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>,
    ) => {
      ipcHandlers.set(channel, listener);
    },
    removeHandler: (channel: string) => {
      ipcHandlers.delete(channel);
    },
  },
  dialog: dialogs,
  protocol: {
    registerSchemesAsPrivileged: () => undefined,
    handle: () => undefined,
  },
  shell: {
    openExternal: () => Promise.resolve(),
  },
}));

const registrations: Array<{ dispose(): void }> = [];

describe('project persistence IPC', () => {
  afterEach(() => {
    dialogs.showOpenDialog.mockClear();
    dialogs.showSaveDialog.mockClear();
    for (const registration of registrations.splice(0)) {
      registration.dispose();
    }
  });

  it('rejects renderer-supplied reference and export paths before opening a dialog', async () => {
    const { event, invoke } = openHandlers();
    const exportRequest = {
      project: buildProject(),
      options: { motion: 'static', autoAdvance: false },
    };
    await expect(
      invoke('koma:references:select', event, { filePaths: ['C:/private/source.txt'] }),
    ).rejects.toThrow('Invalid request');
    await expect(
      invoke('koma:export:powerpoint', event, {
        ...exportRequest,
        filePath: 'C:/private/overwrite.pptx',
      }),
    ).rejects.toThrow('Invalid request');
    await expect(
      invoke('koma:export:powerpoint', { ...event, senderFrame: null }, exportRequest),
    ).rejects.toThrow('Request rejected');
    expect(dialogs.showOpenDialog).not.toHaveBeenCalled();
    expect(dialogs.showSaveDialog).not.toHaveBeenCalled();
  });

  it('validates template IPC and refuses untrusted senders before touching app data', async () => {
    templateLocation.directory = await mkdtemp(join(tmpdir(), 'koma-instruction-ipc-'));
    try {
      const { event, invoke } = openHandlers();
      await expect(invoke('koma:instruction-templates:list', event, {})).resolves.toEqual({
        status: 'loaded',
        templates: [],
      });
      await expect(
        invoke('koma:instruction-templates:change', event, {
          action: 'create',
          name: 'X',
          instructions: '',
          path: '../forbidden',
        }),
      ).rejects.toThrow('Invalid request');
      await expect(
        invoke(
          'koma:instruction-templates:change',
          { ...event, senderFrame: null },
          { action: 'create', name: 'X', instructions: '' },
        ),
      ).rejects.toThrow('Request rejected');
      await expect(
        invoke('koma:instruction-templates:change', event, {
          action: 'create',
          name: 'Valid',
          instructions: 'Plain language',
        }),
      ).resolves.toMatchObject({
        status: 'saved',
        templates: [{ name: 'Valid', instructions: 'Plain language' }],
      });
      await expect(invoke('koma:instruction-templates:list', event, {})).resolves.toMatchObject({
        status: 'loaded',
        templates: [{ name: 'Valid' }],
      });
    } finally {
      await rm(templateLocation.directory, { recursive: true, force: true });
    }
  });

  it('rejects an oversized save before asking where to write it', async () => {
    const { event, invoke } = openHandlers();
    const project = { ...buildProject(), note: 'x'.repeat(MAX_PROJECT_FILE_BYTES + 1) };
    await expect(invoke('koma:project:save', event, { project })).rejects.toThrow(
      PROJECT_TOO_LARGE_MESSAGE,
    );
    await expect(invoke('koma:project:save-as', event, { project })).rejects.toThrow(
      PROJECT_TOO_LARGE_MESSAGE,
    );
    expect(dialogs.showSaveDialog).not.toHaveBeenCalled();
  }, 30_000);

  it('checks an open request under the file limit without blocking other channels', async () => {
    const { event, invoke } = openHandlers();
    let releaseHold: () => void = () => undefined;
    const hold = new Promise<void>((resolve) => {
      releaseHold = resolve;
    });
    const holder = withProjectFileOperation(() => hold);
    let opened = false;
    const opening = invoke('koma:project:open', event, {}).then((result) => {
      opened = true;
      return result;
    });

    try {
      await expect(invoke('koma:app:get-info', event, {})).resolves.toMatchObject({
        version: '0.0.0-test',
      });
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(opened).toBe(false);
      expect(dialogs.showOpenDialog).not.toHaveBeenCalled();
    } finally {
      releaseHold();
      await holder;
    }

    await expect(opening).resolves.toEqual({ status: 'cancelled' });
    expect(dialogs.showOpenDialog).toHaveBeenCalledOnce();
  });
});

describe('Brand Kit library IPC', () => {
  let directory: string;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'koma-ipc-brand-kits-'));
  });

  afterEach(async () => {
    for (const registration of registrations.splice(0)) {
      registration.dispose();
    }
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  });

  it('creates and lists kits through the contract', async () => {
    const { event, invoke } = openHandlers(directory);
    const created = await invoke('koma:brand-kits:create', event, {
      name: 'Acme',
      brandKit: buildBrandKit({ name: 'Acme' }),
      logo: null,
    });
    expect(created).toMatchObject({ status: 'ready', kits: [{ name: 'Acme' }] });
    await expect(invoke('koma:brand-kits:list', event, {})).resolves.toMatchObject({
      status: 'ready',
      kits: [{ name: 'Acme' }],
    });
  });

  it('rejects malformed requests before touching the library', async () => {
    const { event, invoke } = openHandlers(directory);
    const brandKit = buildBrandKit();
    const rejected = [
      ['koma:brand-kits:delete', { id: '../library' }],
      ['koma:brand-kits:load', { id: 'C:/Users/someone' }],
      ['koma:brand-kits:rename', { id: 'kit_a', name: '   ' }],
      ['koma:brand-kits:rename', { id: 'kit_a', name: 'x'.repeat(121) }],
      ['koma:brand-kits:duplicate', { id: 'kit_a', path: '/tmp/elsewhere' }],
      [
        'koma:brand-kits:create',
        { name: 'Acme', brandKit: { ...brandKit, colours: 'red' }, logo: null },
      ],
      [
        'koma:brand-kits:create',
        {
          name: 'Acme',
          brandKit,
          logo: { name: 'a.svg', mediaType: 'image/svg+xml', data: 'AAAA' },
        },
      ],
      [
        'koma:brand-kits:create',
        {
          name: 'Acme',
          brandKit,
          logo: {
            name: 'a.png',
            mediaType: 'image/png',
            data: 'A'.repeat(MAX_EMBEDDED_ASSET_CHARACTERS + 4),
          },
        },
      ],
      ['koma:brand-kits:start-new', { force: true }],
    ] as const;
    for (const [channel, payload] of rejected) {
      await expect(invoke(channel, event, payload), channel).rejects.toThrow(
        `Invalid request for ${channel}`,
      );
    }
    await expect(readdir(directory)).resolves.toEqual([]);
  });

  it('rejects a request from an unexpected sender', async () => {
    const { invoke } = openHandlers(directory);
    const frame = { url: 'https://example.com' };
    const stranger = { sender: { mainFrame: frame }, senderFrame: frame } as IpcMainInvokeEvent;
    await expect(invoke('koma:brand-kits:list', stranger, {})).rejects.toThrow('Request rejected');
  });
});

function openHandlers(
  brandKitDirectory = join(tmpdir(), 'koma-unused-brand-kits'),
  windowParts: Partial<BrowserWindow> = {},
): {
  event: IpcMainInvokeEvent;
  invoke: (channel: string, event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
} {
  const frame = { url: APP_URL };
  const webContents = { mainFrame: frame } as WebContents;
  const window = { webContents, isDestroyed: () => false, ...windowParts } as BrowserWindow;
  const registered = registerHandlers({
    window,
    session: createProjectSession(),
    brandKits: createBrandKitLibrary(brandKitDirectory),
    updates: {
      getStatus: () => ({ state: 'idle', channel: 'stable', currentVersion: '0.1.0' }),
      check: () => Promise.resolve(),
      setChannel: () =>
        Promise.resolve({ state: 'idle', channel: 'stable', currentVersion: '0.1.0' }),
      download: () => Promise.resolve(),
      copyCommand: () => Promise.resolve(),
      install: () => Promise.resolve(),
      dispose: () => undefined,
    },
    closeConfirmed() {
      return undefined;
    },
    projectStateChanged() {
      return undefined;
    },
  });
  registrations.push(registered);
  return {
    event: { sender: webContents, senderFrame: frame } as IpcMainInvokeEvent,
    invoke: (channel, event, payload) => {
      const handler = ipcHandlers.get(channel);
      if (handler === undefined) {
        throw new Error(`No handler for ${channel}`);
      }
      return handler(event, payload);
    },
  };
}

describe('presentation full screen', () => {
  afterEach(() => {
    for (const registration of registrations.splice(0)) {
      registration.dispose();
    }
  });

  function fullScreenWindow(initially: boolean) {
    const state = { fullScreen: initially, calls: [] as boolean[] };
    const parts: Partial<BrowserWindow> = {
      isFullScreen: () => state.fullScreen,
      setFullScreen: (value: boolean) => {
        state.calls.push(value);
        state.fullScreen = value;
      },
    };
    return { state, parts };
  }

  it('gives a window back the state it had before the presentation', async () => {
    const { state, parts } = fullScreenWindow(false);
    const { event, invoke } = openHandlers(undefined, parts);
    await expect(invoke('koma:app:set-full-screen', event, { mode: 'enter' })).resolves.toEqual({
      fullScreen: true,
    });
    // A second request does not forget that the window was not full screen.
    await invoke('koma:app:set-full-screen', event, { mode: 'enter' });
    await expect(invoke('koma:app:set-full-screen', event, { mode: 'restore' })).resolves.toEqual({
      fullScreen: false,
    });
    expect(state.fullScreen).toBe(false);
  });

  it('leaves a window full screen that already was', async () => {
    const { state, parts } = fullScreenWindow(true);
    const { event, invoke } = openHandlers(undefined, parts);
    await invoke('koma:app:set-full-screen', event, { mode: 'enter' });
    await expect(invoke('koma:app:set-full-screen', event, { mode: 'restore' })).resolves.toEqual({
      fullScreen: true,
    });
    expect(state.fullScreen).toBe(true);
    // Restoring without a presentation changes nothing.
    await invoke('koma:app:set-full-screen', event, { mode: 'restore' });
    expect(state.calls).toEqual([true]);
  });

  it('accepts only the three modes', async () => {
    const { parts } = fullScreenWindow(false);
    const { event, invoke } = openHandlers(undefined, parts);
    for (const payload of [{}, { mode: 'kiosk' }, { mode: 'enter', fullScreen: true }]) {
      await expect(invoke('koma:app:set-full-screen', event, payload)).rejects.toThrow(
        'Invalid request',
      );
    }
  });
});

describe('mock provider test settings', () => {
  it('reads a bounded delay and the invalid outcome, and ignores anything else', () => {
    expect(readMockOptions({})).toEqual({});
    expect(readMockOptions({ KOMA_MOCK_DELAY_MS: '2500', KOMA_MOCK_OUTCOME: 'invalid' })).toEqual({
      delayMs: 2500,
      outcome: 'invalid',
    });
    for (const delay of ['-1', '60001', '1.5', 'soon']) {
      expect(readMockOptions({ KOMA_MOCK_DELAY_MS: delay })).toEqual({});
    }
    expect(readMockOptions({ KOMA_MOCK_OUTCOME: 'crash' })).toEqual({});
  });
});
