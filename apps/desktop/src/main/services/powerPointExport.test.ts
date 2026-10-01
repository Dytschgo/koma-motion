import { buildProject } from '@koma-motion/core/testing';
import type { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { exportPowerPoint } from './powerPointExport';

const mocks = vi.hoisted(() => ({
  validate: vi.fn(),
  export: vi.fn(),
  save: vi.fn(),
}));
vi.mock('@koma-motion/exporters', () => ({
  PowerPointExporter: class {
    validate = mocks.validate;
    export = mocks.export;
  },
}));
vi.mock('electron', () => ({ dialog: { showSaveDialog: mocks.save } }));
const window = {} as BrowserWindow;
const options = { motion: 'static', autoAdvance: false } as const;

describe('PowerPoint destination selection', () => {
  beforeEach(() => {
    mocks.validate.mockReset().mockResolvedValue({ exportable: true, issues: [] });
    mocks.export
      .mockReset()
      .mockResolvedValue({ status: 'exported', filePath: 'C:/exports/deck.pptx', warnings: [] });
    mocks.save.mockReset().mockResolvedValue({ canceled: false, filePath: 'C:/exports/deck.pptx' });
  });
  it('passes only the native destination and returns a display name', async () => {
    const project = buildProject();
    await expect(exportPowerPoint(window, project, options, () => 1)).resolves.toEqual({
      status: 'exported',
      fileName: 'deck.pptx',
      warnings: [],
    });
    expect(mocks.export).toHaveBeenCalledWith(project, {
      ...options,
      filePath: 'C:/exports/deck.pptx',
    });
  });
  it('does not write after cancel or invalid extension', async () => {
    mocks.save.mockResolvedValueOnce({ canceled: true });
    await expect(exportPowerPoint(window, buildProject(), options, () => 1)).resolves.toEqual({
      status: 'cancelled',
    });
    mocks.save.mockResolvedValueOnce({ canceled: false, filePath: 'C:/exports/original.koma' });
    await expect(exportPowerPoint(window, buildProject(), options, () => 1)).resolves.toMatchObject(
      { status: 'failed' },
    );
    expect(mocks.export).not.toHaveBeenCalled();
  });
  it('does not export a project replaced while the dialog was open', async () => {
    let session = 1;
    mocks.save.mockImplementationOnce(() => {
      session = 2;
      return Promise.resolve({ canceled: false, filePath: 'C:/exports/deck.pptx' });
    });
    const result = await exportPowerPoint(window, buildProject(), options, () => session);
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.message).toContain('project changed');
    expect(mocks.export).not.toHaveBeenCalled();
  });
  it('reports validation failure without opening a destination dialog', async () => {
    mocks.validate.mockResolvedValue({
      exportable: false,
      issues: [{ severity: 'error', code: 'missingImage', message: 'An image is missing.' }],
    });
    await expect(exportPowerPoint(window, buildProject(), options, () => 1)).resolves.toEqual({
      status: 'failed',
      message: 'An image is missing.',
    });
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
