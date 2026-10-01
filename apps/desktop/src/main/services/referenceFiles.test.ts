import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { BrowserWindow } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { referenceSelectionOutcomeSchema } from '../../shared/references';
import { MAX_REFERENCE_FILE_BYTES, prepareReference, selectReferenceFiles } from './referenceFiles';

const mocks = vi.hoisted(() => ({ dialog: vi.fn() }));
vi.mock('electron', () => ({ dialog: { showOpenDialog: mocks.dialog } }));

describe('reference file selection', () => {
  const parent = {} as BrowserWindow;
  let folder: string;
  beforeEach(async () => {
    mocks.dialog.mockReset();
    folder = await mkdtemp(join(tmpdir(), 'koma-references-'));
  });
  afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
  });

  it('cancels without reading and bounds the file count', async () => {
    mocks.dialog.mockResolvedValueOnce({ canceled: true, filePaths: [] });
    expect(await selectReferenceFiles(parent)).toEqual({ status: 'cancelled' });
    mocks.dialog.mockResolvedValueOnce({
      canceled: false,
      filePaths: Array(6).fill(join(folder, 'missing.txt')),
    });
    expect(await selectReferenceFiles(parent)).toMatchObject({ status: 'failed' });
  });

  it('returns only safe display metadata and extracted text', async () => {
    const path = join(folder, 'brief.md');
    await writeFile(path, '# Launch\nCustomers want a simpler setup.');
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: [path] });
    const outcome = await selectReferenceFiles(parent);
    expect(referenceSelectionOutcomeSchema.safeParse(outcome).success).toBe(true);
    expect(outcome).toMatchObject({
      status: 'selected',
      references: [{ name: 'brief.md', format: 'md', truncated: false }],
    });
    expect(JSON.stringify(outcome)).not.toContain(folder);
    expect(mocks.dialog).toHaveBeenCalledWith(
      parent,
      expect.objectContaining({
        properties: ['openFile', 'multiSelections'],
      }),
    );
  });

  it('rejects invalid UTF-8 and binary text', async () => {
    await expect(prepareReference('bad.txt', Uint8Array.of(0xc3, 0x28))).rejects.toThrow('UTF-8');
    await expect(prepareReference('bad.md', Buffer.from('abc\0def'))).rejects.toThrow('binary');
  });

  it('reports clipping explicitly', async () => {
    const reference = await prepareReference('long.txt', Buffer.from('x'.repeat(100_001)));
    expect(reference.text).toHaveLength(100_000);
    expect(reference.truncated).toBe(true);
  });

  it('rejects combined extracted text above the request limit', async () => {
    const paths = await Promise.all(
      [1, 2, 3].map(async (number) => {
        const path = join(folder, `large-${String(number)}.txt`);
        await writeFile(path, 'x'.repeat(100_000));
        return path;
      }),
    );
    mocks.dialog.mockResolvedValue({ canceled: false, filePaths: paths });
    const outcome = await selectReferenceFiles(parent);
    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') expect(outcome.message).toContain('200,000');
  });

  it('rejects per-file and aggregate raw size limits', async () => {
    const huge = join(folder, 'huge.txt');
    await writeFile(huge, Buffer.alloc(MAX_REFERENCE_FILE_BYTES + 1, 0x61));
    mocks.dialog.mockResolvedValueOnce({ canceled: false, filePaths: [huge] });
    const tooLarge = await selectReferenceFiles(parent);
    expect(tooLarge.status).toBe('failed');
    if (tooLarge.status === 'failed') expect(tooLarge.message).toContain('10 MiB');
    const paths = await Promise.all(
      [1, 2, 3].map(async (number) => {
        const path = join(folder, `part-${String(number)}.txt`);
        await writeFile(path, Buffer.alloc(8 * 1024 * 1024, 0x61));
        return path;
      }),
    );
    mocks.dialog.mockResolvedValueOnce({ canceled: false, filePaths: paths });
    const tooManyBytes = await selectReferenceFiles(parent);
    expect(tooManyBytes.status).toBe('failed');
    if (tooManyBytes.status === 'failed') expect(tooManyBytes.message).toContain('20 MiB');
  });

  it('extracts local PDF text and rejects corrupt PDFs', async () => {
    const bytes = await readFile(resolve('apps/desktop/e2e/fixtures/decks/northstar.pdf'));
    const reference = await prepareReference('source.pdf', bytes);
    expect(reference.format).toBe('pdf');
    expect(reference.text.length).toBeGreaterThan(20);
    await expect(prepareReference('broken.pdf', Buffer.from('%PDF-\nbroken'))).rejects.toThrow();
  });
});
