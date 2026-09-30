import { MAX_PROJECT_FILE_BYTES, PROJECT_TOO_LARGE_MESSAGE } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { withProjectFileOperation } from '@koma-motion/project-format/node';
import type { BrowserWindow, IpcMainInvokeEvent, WebContents } from 'electron';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { APP_URL } from '../securityPolicy';
import { createProjectSession } from '../services/projectFiles';
import { registerHandlers } from './registerHandlers';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

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

function openHandlers(): {
  event: IpcMainInvokeEvent;
  invoke: (channel: string, event: IpcMainInvokeEvent, payload: unknown) => Promise<unknown>;
} {
  const frame = { url: APP_URL };
  const webContents = { mainFrame: frame } as WebContents;
  const window = { webContents, isDestroyed: () => false } as BrowserWindow;
  const registered = registerHandlers({
    window,
    session: createProjectSession(),
    updates: {
      getStatus: () => ({ state: 'idle', channel: 'stable', currentVersion: '0.1.0' }),
      check: () => Promise.resolve(),
      setChannel: () =>
        Promise.resolve({ state: 'idle', channel: 'stable', currentVersion: '0.1.0' }),
      download: () => Promise.resolve(),
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
