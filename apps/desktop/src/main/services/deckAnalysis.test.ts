import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MockAgentProvider, ProviderRegistry } from '@koma-motion/agent-runtime';
import { createDefaultBrandKit } from '@koma-motion/brand-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedDeck } from '../../shared/deckAnalysis';
import { DeckAnalysisService, prepareDeck } from './deckAnalysis';
import { createBrandKitLibrary } from './brandKitLibrary';

vi.mock('electron', () => ({ nativeImage: {}, BrowserWindow: {}, ipcMain: {}, app: {} }));
vi.mock('./deckPdf', () => ({
  renderDeckPdf: vi.fn(() =>
    Promise.resolve({
      slides: [{ number: 1, text: 'fixture', preview: 'aGVsbG8=' }],
      totalSlides: 1,
    }),
  ),
}));
const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'deck-unit-'));
  folders.push(directory);
  const library = createBrandKitLibrary(join(directory, 'library'));
  const provider = new MockAgentProvider({ delayMs: 0 });
  const prepared: Omit<PreparedDeck, 'sessionId'> = {
    fileName: 'brand.pdf',
    slides: [{ number: 1, text: 'fixture', preview: 'aGVsbG8=' }],
    totalSlides: 1,
    logos: [],
    warnings: [],
  };
  const prepare = vi.fn(() => Promise.resolve(prepared));
  const options = {
    select: () => Promise.resolve('/private/original/brand.pdf'),
    prepare,
    registry: new ProviderRegistry([provider]),
    library,
    progress: vi.fn(),
    allowMock: true,
  };
  const service = new DeckAnalysisService(options);
  return { directory, service, library, options, provider };
}

describe('isolated deck analysis draft', () => {
  it('refuses a provider response after the analysis deadline', async () => {
    const { service, provider, library } = await fixture();
    const id = randomUUID();
    await service.prepare(id);
    const original = provider.analyzeBrandKit.bind(provider);
    const timeout = new AbortController();
    const timeoutError = new Error('Analysis deadline');
    timeoutError.name = 'TimeoutError';
    timeout.abort(timeoutError);
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(timeout.signal);
    vi.spyOn(provider, 'analyzeBrandKit').mockImplementation((request, context) =>
      original(request, { ...context, signal: new AbortController().signal }),
    );
    const result = await service.analyze(id, 'mock');
    expect(result.status).toBe('failed');
    if (result.status === 'failed') expect(result.message).toContain('three minutes');
    expect(await library.list()).toMatchObject({ kits: [] });
  });
  it('never saves before confirmation, stores only filename provenance, and creates a new item', async () => {
    const { service, library } = await fixture();
    const id = randomUUID();
    await service.prepare(id);
    expect(await service.save(id, 'Premature', createDefaultBrandKit(), null)).toMatchObject({
      status: 'failed',
    });
    await expect(service.analyze(id, 'mock')).resolves.toMatchObject({ status: 'proposed' });
    expect(await library.list()).toMatchObject({ kits: [] });
    const kit = { ...createDefaultBrandKit(), name: 'Reviewed brand', tone: 'User edits' };
    expect(await service.save(id, 'Saved name', kit, null)).toMatchObject({
      status: 'ready',
      kits: [
        {
          name: 'Saved name',
          brandKit: { name: 'Reviewed brand', tone: 'User edits' },
          provenance: { fileName: 'brand.pdf', analyzedSlides: [1] },
        },
      ],
    });
    expect(JSON.stringify(await library.list())).not.toContain('/private');
    expect(await service.save(id, 'Duplicate response', kit, null)).toMatchObject({
      status: 'failed',
    });
  });
  it('keeps the reviewed draft on library failure and allows retry', async () => {
    const { service, library } = await fixture();
    const id = randomUUID();
    await service.prepare(id);
    await service.analyze(id, 'mock');
    vi.spyOn(library, 'create').mockResolvedValueOnce({ status: 'failed', message: 'Disk full' });
    expect(await service.save(id, 'Retry', createDefaultBrandKit(), null)).toMatchObject({
      status: 'failed',
      message: 'Disk full',
    });
    expect(await service.save(id, 'Retry', createDefaultBrandKit(), null)).toMatchObject({
      status: 'ready',
      kits: [{ name: 'Retry' }],
    });
  });
  it('cancels pending analysis and rejects late results, old session saves and unknown logos', async () => {
    const { service, provider, library } = await fixture();
    const id = randomUUID();
    await service.prepare(id);
    const original = provider.analyzeBrandKit.bind(provider);
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(provider, 'analyzeBrandKit').mockImplementation(async (request, context) => {
      await gate;
      return original(request, { ...context, signal: new AbortController().signal });
    });
    const analysis = service.analyze(id, 'mock');
    const cancellation = service.cancel(id);
    finish?.();
    await cancellation;
    expect(await analysis).toMatchObject({ status: 'cancelled' });
    expect(await service.save(id, 'Late', createDefaultBrandKit(), null)).toMatchObject({
      status: 'failed',
    });
    expect(await library.list()).toMatchObject({ kits: [] });
    const second = randomUUID();
    await service.prepare(second);
    await service.analyze(second, 'mock');
    expect(
      await service.save(second, 'Unknown logo', createDefaultBrandKit(), 'logo-' + 'a'.repeat(32)),
    ).toMatchObject({ status: 'failed' });
  });
  it('rejects malformed agent output and reports provider failure without saving', async () => {
    const { service, provider, library } = await fixture();
    const id = randomUUID();
    await service.prepare(id);
    vi.spyOn(provider, 'analyzeBrandKit').mockRejectedValueOnce(new Error('Provider unavailable'));
    expect(await service.analyze(id, 'mock')).toMatchObject({ status: 'failed' });
    expect(await library.list()).toMatchObject({ kits: [] });
  });
  it('drops preparation results arriving after cancellation', async () => {
    const { options } = await fixture();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = options.prepare;
    options.prepare = vi.fn(async () => {
      await gate;
      return original();
    });
    const service = new DeckAnalysisService(options);
    const id = randomUUID();
    const pending = service.prepare(id);
    await Promise.resolve();
    const cancelled = service.cancel(id);
    release?.();
    await cancelled;
    expect(await pending).toMatchObject({ status: 'cancelled' });
  });
});

describe('local preparation boundaries', () => {
  it('preserves original bytes and removes isolated data on success and failure', async () => {
    const { directory } = await fixture();
    const before = new Set(
      (await readdir(tmpdir())).filter((name) => name.startsWith('koma-motion-deck-')),
    );
    const path = join(directory, 'fixture.pdf');
    const bytes = Buffer.from('%PDF-1.7 synthetic unit fixture');
    await writeFile(path, bytes);
    expect(await prepareDeck(path, new AbortController().signal, () => undefined)).toMatchObject({
      fileName: 'fixture.pdf',
    });
    expect(await readFile(path)).toEqual(bytes);
    await writeFile(path, 'not a PDF');
    await expect(prepareDeck(path, new AbortController().signal, () => undefined)).rejects.toThrow(
      'valid PDF',
    );
    expect(
      (await readdir(tmpdir())).filter(
        (name) => name.startsWith('koma-motion-deck-') && !before.has(name),
      ),
    ).toEqual([]);
  });
  it('rejects oversized files before rendering and cleans cancelled work', async () => {
    const { directory } = await fixture();
    const path = join(directory, 'large.pdf');
    await writeFile(path, Buffer.alloc(32 * 1024 * 1024 + 1));
    await expect(prepareDeck(path, new AbortController().signal, () => undefined)).rejects.toThrow(
      '32 MiB',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(prepareDeck(path, controller.signal, () => undefined)).rejects.toThrow();
  });
});
