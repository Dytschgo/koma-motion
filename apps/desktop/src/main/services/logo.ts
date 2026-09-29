import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { createRandomIdGenerator, MAX_EMBEDDED_ASSET_BYTES } from '@koma-motion/core';
import { dialog, type BrowserWindow } from 'electron';
import type { IpcResponse } from '../../shared/ipc';
import { createImageAsset, IMAGE_FILE_EXTENSIONS } from './imageAsset';

/**
 * Lets the user choose an image in a native dialog and returns it as an
 * asset. The renderer receives the image data, never the path of the file.
 */
export async function selectLogo(
  window: BrowserWindow,
): Promise<IpcResponse<'koma:brand-kit:select-logo'>> {
  const selection = await dialog.showOpenDialog(window, {
    title: 'Choose a logo',
    filters: [{ name: 'Images', extensions: [...IMAGE_FILE_EXTENSIONS] }],
    properties: ['openFile'],
  });
  const filePath = selection.filePaths[0];
  if (selection.canceled || filePath === undefined) {
    return { status: 'cancelled' };
  }

  try {
    const details = await stat(filePath);
    if (!details.isFile()) {
      return { status: 'failed', message: 'The selected item is not a file.' };
    }
    if (details.size > MAX_EMBEDDED_ASSET_BYTES) {
      const megabytes = MAX_EMBEDDED_ASSET_BYTES / (1024 * 1024);
      return {
        status: 'failed',
        message: `The image is larger than ${String(megabytes)} MB. Choose a smaller image.`,
      };
    }
    const asset = createImageAsset({
      bytes: await readFile(filePath),
      fileName: basename(filePath),
      idGenerator: createRandomIdGenerator(),
    });
    return asset.ok
      ? { status: 'selected', asset: asset.value }
      : { status: 'failed', message: asset.error };
  } catch {
    return { status: 'failed', message: 'The image could not be read.' };
  }
}
