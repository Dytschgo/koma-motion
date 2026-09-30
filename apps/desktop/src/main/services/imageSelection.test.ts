import { MAX_EMBEDDED_ASSET_BYTES } from '@koma-motion/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BrowserWindow } from 'electron';
import { ipcContract } from '../../shared/ipc';
import { selectLogo } from './logo';

const mocks = vi.hoisted(() => ({ dialog: vi.fn(), stat: vi.fn(), read: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showOpenDialog: mocks.dialog } }));
vi.mock('node:fs/promises', () => ({ stat: mocks.stat, readFile: mocks.read }));

describe('trusted image selection', () => {
  // The dialog is mocked; this service only forwards the parent window.
  const parent = {} as BrowserWindow;
  beforeEach(() => {
    vi.resetAllMocks();
  });

  it('accepts no renderer-supplied path or URL', () => {
    const request = ipcContract['koma:project:select-image'].request;
    expect(request.safeParse({}).success).toBe(true);
    expect(request.safeParse({ path: 'C:/private.png' }).success).toBe(false);
    expect(request.safeParse({ url: 'https://example.com/image.png' }).success).toBe(false);
  });

  it('cancels without reading a file', async () => {
    mocks.dialog.mockResolvedValue({ canceled: true, filePaths: [] });
    expect(await selectLogo(parent, 'Choose an image')).toEqual({ status: 'cancelled' });
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('rejects oversized files before reading bytes', async () => {
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: ['C:/image.png'] });
    mocks.stat.mockResolvedValue({ isFile: () => true, size: MAX_EMBEDDED_ASSET_BYTES + 1 });
    const result = await selectLogo(parent, 'Choose an image');
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.message).toContain('2 MB');
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it('validates bytes again after the stat check and rejects disguised files', async () => {
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: ['C:/image.png'] });
    mocks.stat.mockResolvedValue({ isFile: () => true, size: 10 });
    mocks.read.mockResolvedValue(Buffer.from('<svg onload="alert(1)"/>'));
    expect(await selectLogo(parent, 'Choose an image')).toMatchObject({ status: 'failed' });
    mocks.read.mockResolvedValue(Buffer.alloc(MAX_EMBEDDED_ASSET_BYTES + 1));
    const result = await selectLogo(parent, 'Choose an image');
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.message).toContain('2 MB');
  });
});
