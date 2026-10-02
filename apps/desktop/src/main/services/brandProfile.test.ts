import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, truncate, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MockAgentProvider,
  ProviderRegistry,
  type AgentProvider,
} from '@koma-motion/agent-runtime';
import { createDefaultBrandKit } from '@koma-motion/brand-kit';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PreparedMaterial } from '../../shared/brandProfile';
import { BrandProfileService, prepareMaterial } from './brandProfile';
import { createBrandKitLibrary } from './brandKitLibrary';
import type { prepareDeck } from './deckAnalysis';

vi.mock('electron', () => ({ nativeImage: {}, BrowserWindow: {}, ipcMain: {}, app: {} }));

const ONE_PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);
/** A PNG header that declares the given size. Its pixels are never decoded here. */
function pngHeader(width: number, height: number): Buffer {
  const bytes = Buffer.from(ONE_PIXEL);
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

const folders: string[] = [];
afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});
async function folder(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'brand-profile-unit-'));
  folders.push(directory);
  return directory;
}
async function file(directory: string, name: string, bytes: Buffer | string): Promise<string> {
  const path = join(directory, name);
  await writeFile(path, bytes);
  return path;
}

const renderImage = vi.fn(() =>
  Promise.resolve({ image: { mediaType: 'image/png' as const, preview: 'aGVsbG8=' } }),
);
const deck = (slides: number, total = slides): typeof prepareDeck =>
  vi.fn((path: string) =>
    Promise.resolve({
      fileName: path.endsWith('.pptx') ? 'deck.pptx' : 'deck.pdf',
      slides: Array.from({ length: slides }, (_, index) => ({
        number: index + 1,
        text: `Slide ${String(index + 1)}`,
        preview: 'aGVsbG8=',
      })),
      totalSlides: total,
      logos: [
        {
          id: 'logo-' + (path.endsWith('.pptx') ? 'b' : 'c').repeat(32),
          slides: [1, slides],
          image: {
            name: 'Extracted logo candidate.png',
            mediaType: 'image/png' as const,
            data: ONE_PIXEL.toString('base64'),
          },
        },
      ],
      warnings: [],
    }),
  );
const idle = new AbortController().signal;
const prepare = (paths: string[], prepareDeckWith = deck(3)) =>
  prepareMaterial(paths, idle, () => undefined, { renderImage, prepareDeck: prepareDeckWith });

describe('file limits of brand material', () => {
  it('prepares images and decks in order, without paths, and offers uploaded images as logos', async () => {
    const directory = await folder();
    const material = await prepare([
      await file(directory, 'logo.png', ONE_PIXEL),
      await file(directory, 'guide.pdf', '%PDF-1.7'),
    ]);
    expect(material.files).toEqual([
      { file: 1, name: 'logo.png', kind: 'image', total: 1 },
      { file: 2, name: 'guide.pdf', kind: 'pdf', total: 3 },
    ]);
    expect(
      material.exhibits.map((exhibit) => [exhibit.number, exhibit.file, exhibit.page]),
    ).toEqual([
      [1, 1, null],
      [2, 2, 1],
      [3, 2, 2],
      [4, 2, 3],
    ]);
    expect(material.logos.map((logo) => [logo.file, logo.exhibits])).toEqual([
      [1, [1]],
      [2, [2, 4]],
    ]);
    expect(JSON.stringify(material)).not.toContain(directory);
  });

  it('refuses more than eight files before reading any of them', async () => {
    renderImage.mockClear();
    await expect(
      prepare(Array.from({ length: 9 }, (_, index) => `/missing/${String(index)}.png`)),
    ).rejects.toThrow('at most 8 files');
    expect(renderImage).not.toHaveBeenCalled();
  });

  it('refuses unsupported types, empty files, oversized images and oversized totals', async () => {
    const directory = await folder();
    await expect(prepare([await file(directory, 'notes.docx', 'x')])).rejects.toThrow(
      'not supported',
    );
    await expect(prepare([await file(directory, 'empty.png', '')])).rejects.toThrow('nonempty');
    const large = await file(directory, 'large.png', ONE_PIXEL);
    await truncate(large, 10 * 1024 * 1024 + 1);
    await expect(prepare([large])).rejects.toThrow('at most 10 MiB');
    const decks = [];
    for (const name of ['a.pdf', 'b.pdf', 'c.pdf']) {
      const path = await file(directory, name, '%PDF-1.7');
      await truncate(path, 22 * 1024 * 1024);
      decks.push(path);
    }
    await expect(prepare(decks)).rejects.toThrow('total at most 64 MiB');
    const oversizedDeck = await file(directory, 'huge.pptx', 'PK');
    await truncate(oversizedDeck, 32 * 1024 * 1024 + 1);
    await expect(prepare([oversizedDeck])).rejects.toThrow('at most 32 MiB');
  });

  it('trusts content over the extension and bounds image dimensions before decoding', async () => {
    const directory = await folder();
    renderImage.mockClear();
    await expect(prepare([await file(directory, 'fake.png', 'not an image')])).rejects.toThrow(
      'not a PNG, JPEG, WebP or GIF',
    );
    await expect(
      prepare([await file(directory, 'bomb.png', pngHeader(20000, 20000))]),
    ).rejects.toThrow('12000 pixels');
    expect(renderImage).not.toHaveBeenCalled();
  });

  it('shares the exhibit budget between files and discloses sampled slides', async () => {
    const directory = await folder();
    const paths = [
      await file(directory, 'one.png', ONE_PIXEL),
      await file(directory, 'two.png', pngHeader(2, 2)),
      await file(directory, 'a.pdf', '%PDF-1.7'),
      await file(directory, 'b.pptx', 'PK'),
    ];
    const material = await prepare(paths, deck(20, 60));
    // 24 exhibits: 2 images, then 11 slides for each of the 2 decks.
    expect(material.exhibits).toHaveLength(24);
    expect(material.exhibits.filter((exhibit) => exhibit.file === 3)).toHaveLength(11);
    expect(material.exhibits.at(-1)?.page).toBe(20);
    expect(material.warnings).toEqual(
      expect.arrayContaining([
        expect.stringContaining('11 of 60 slides were prepared'),
        expect.stringContaining('LibreOffice may substitute'),
      ]),
    );
  });

  it('refuses previews that one analysis request cannot carry', async () => {
    const directory = await folder();
    const heavy: typeof prepareDeck = () =>
      Promise.resolve({
        fileName: 'heavy.pdf',
        slides: Array.from({ length: 20 }, (_, index) => ({
          number: index + 1,
          text: '',
          preview: 'A'.repeat(1_400_000),
        })),
        totalSlides: 20,
        logos: [],
        warnings: [],
      });
    await expect(prepare([await file(directory, 'heavy.pdf', '%PDF-1.7')], heavy)).rejects.toThrow(
      'larger than one analysis can take',
    );
  });

  it('refuses too much extracted text and stops when cancelled', async () => {
    const directory = await folder();
    const path = await file(directory, 'long.pdf', '%PDF-1.7');
    const wordy: typeof prepareDeck = () =>
      Promise.resolve({
        fileName: 'long.pdf',
        slides: Array.from({ length: 11 }, (_, index) => ({
          number: index + 1,
          text: 'x'.repeat(20000),
          preview: 'aGVsbG8=',
        })),
        totalSlides: 11,
        logos: [],
        warnings: [],
      });
    await expect(prepare([path], wordy)).rejects.toThrow('200,000 characters');
    const controller = new AbortController();
    controller.abort();
    await expect(
      prepareMaterial([path], controller.signal, () => undefined, { renderImage }),
    ).rejects.toThrow();
  });
});

const material: Omit<PreparedMaterial, 'sessionId'> = {
  files: [{ file: 1, name: 'brand.png', kind: 'image', total: 1 }],
  exhibits: [
    {
      number: 1,
      file: 1,
      kind: 'image',
      page: null,
      text: '',
      mediaType: 'image/png',
      preview: 'aGVsbG8=',
    },
  ],
  logos: [
    {
      id: 'logo-' + 'd'.repeat(32),
      file: 1,
      exhibits: [1],
      image: { name: 'brand.png', mediaType: 'image/png', data: ONE_PIXEL.toString('base64') },
    },
  ],
  warnings: [],
};
async function fixture(providers?: AgentProvider[], allowMock = true) {
  const directory = await folder();
  const library = createBrandKitLibrary(join(directory, 'library'));
  const provider = new MockAgentProvider({ delayMs: 0 });
  const options = {
    select: vi.fn<() => Promise<readonly string[] | null>>(() =>
      Promise.resolve(['/private/original/brand.png']),
    ),
    prepare: vi.fn((_paths: readonly string[], _signal: AbortSignal) => Promise.resolve(material)),
    registry: new ProviderRegistry(providers ?? [provider]),
    library,
    progress: vi.fn(),
    allowMock,
  };
  return { service: new BrandProfileService(options), library, options, provider };
}
const reviewed = {
  name: 'Reviewed profile',
  brandKit: { ...createDefaultBrandKit(), name: 'Reviewed brand' },
  instructions: 'Reviewed instructions',
  logoCandidateId: null,
};

describe('brand profile draft', () => {
  it('proposes only after analysis and saves kit, logo and instructions as one entry', async () => {
    const { service, library } = await fixture();
    const id = randomUUID();
    await expect(service.attach(id)).resolves.toMatchObject({ status: 'prepared' });
    expect(await service.save(id, reviewed)).toMatchObject({ status: 'failed' });
    const proposed = await service.analyze(id, 'mock');
    expect(proposed).toMatchObject({ status: 'proposed', fontsNamedInMaterial: false });
    if (proposed.status === 'proposed')
      expect(proposed.proposal.instructions).toContain('Demonstration');
    expect(await library.list()).toMatchObject({ kits: [] });
    const saved = await service.save(id, {
      ...reviewed,
      logoCandidateId: 'logo-' + 'd'.repeat(32),
    });
    expect(saved).toMatchObject({
      status: 'ready',
      kits: [
        {
          name: 'Reviewed profile',
          brandKit: { name: 'Reviewed brand' },
          instructions: 'Reviewed instructions',
          logo: { name: 'brand.png' },
          referenceProvenance: {
            provider: 'mock',
            files: [{ fileName: 'brand.png', kind: 'image', analyzed: 1, total: 1 }],
          },
        },
      ],
    });
    expect(JSON.stringify(saved)).not.toContain('/private');
    // The draft is consumed: a repeated response cannot create a second entry.
    expect(await service.save(id, reviewed)).toMatchObject({ status: 'failed' });
  });

  it('keeps the reviewed draft when the library write fails and saves on retry', async () => {
    const { service, library } = await fixture();
    const id = randomUUID();
    await service.attach(id);
    await service.analyze(id, 'mock');
    vi.spyOn(library, 'create').mockResolvedValueOnce({ status: 'failed', message: 'Disk full' });
    expect(await service.save(id, reviewed)).toEqual({ status: 'failed', message: 'Disk full' });
    expect(await library.list()).toMatchObject({ kits: [] });
    expect(await service.save(id, reviewed)).toMatchObject({
      status: 'ready',
      kits: [{ name: 'Reviewed profile', instructions: 'Reviewed instructions' }],
    });
  });

  it('refuses invalid agent output and a logo that is not part of the material', async () => {
    const invalid = new MockAgentProvider({ delayMs: 0, outcome: 'invalid' });
    const { service, library } = await fixture([invalid]);
    const id = randomUUID();
    await service.attach(id);
    const failed = await service.analyze(id, 'mock');
    expect(failed).toMatchObject({ status: 'failed' });
    if (failed.status === 'failed') expect(failed.message).toContain('Nothing was saved');
    // No proposal exists, so nothing can be saved from the refused output.
    expect(await service.save(id, reviewed)).toMatchObject({ status: 'failed' });
    vi.spyOn(invalid, 'analyzeBrandProfile').mockResolvedValueOnce({ unexpected: true } as never);
    const malformed = await service.analyze(id, 'mock');
    expect(malformed).toMatchObject({ status: 'failed' });
    if (malformed.status === 'failed')
      expect(malformed.message).toContain('did not pass validation');
    expect(await library.list()).toMatchObject({ kits: [] });

    const second = await fixture();
    await second.service.attach(id);
    await second.service.analyze(id, 'mock');
    expect(
      await second.service.save(id, { ...reviewed, logoCandidateId: 'logo-' + 'e'.repeat(32) }),
    ).toMatchObject({ status: 'failed' });
  });

  it('reports an unavailable provider and never switches to another one', async () => {
    const mock = new MockAgentProvider({ delayMs: 0 });
    const analyzeWithMock = vi.spyOn(mock, 'analyzeBrandProfile');
    const analyzeWithClaude = vi.fn();
    const claude = {
      id: 'claude-code',
      displayName: 'Claude Code',
      metadata: { ...mock.metadata, id: 'claude-code', displayName: 'Claude Code' },
      detect: () =>
        Promise.resolve({
          providerId: 'claude-code',
          availability: 'unavailable' as const,
          version: null,
          message: 'Claude Code was not found.',
          checkedAt: new Date().toISOString(),
        }),
      analyzeBrandProfile: analyzeWithClaude,
    } as unknown as AgentProvider;
    const { service } = await fixture([mock, claude], false);
    const id = randomUUID();
    await service.attach(id);
    const result = await service.analyze(id, 'claude-code');
    expect(result).toMatchObject({ status: 'failed' });
    if (result.status === 'failed') {
      expect(result.message).toContain('Claude Code is not available');
      expect(result.message).toContain('No other provider was used');
    }
    expect(analyzeWithClaude).not.toHaveBeenCalled();
    expect(analyzeWithMock).not.toHaveBeenCalled();
    // A packaged build has no mock analysis at all.
    expect(await service.analyze(id, 'mock')).toMatchObject({ status: 'failed' });
    expect(analyzeWithMock).not.toHaveBeenCalled();
  });

  it('stops an analysis without keeping a proposal, and keeps the files for another run', async () => {
    const { service, provider, library } = await fixture();
    const id = randomUUID();
    await service.attach(id);
    const original = provider.analyzeBrandProfile.bind(provider);
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    vi.spyOn(provider, 'analyzeBrandProfile').mockImplementationOnce(async (request, context) => {
      await gate;
      // A provider that answers although it was told to stop.
      return original(request, { ...context, signal: new AbortController().signal });
    });
    const analysis = service.analyze(id, 'mock');
    await Promise.resolve();
    await Promise.resolve();
    const stopping = service.stopAnalysis(id);
    finish?.();
    await stopping;
    expect(await analysis).toEqual({ status: 'cancelled' });
    expect(await service.save(id, reviewed)).toMatchObject({ status: 'failed' });
    expect(await library.list()).toMatchObject({ kits: [] });
    await expect(service.analyze(id, 'mock')).resolves.toMatchObject({ status: 'proposed' });
  });

  it('discards the draft on cancel, including results that arrive late', async () => {
    const { service, options, library } = await fixture();
    const id = randomUUID();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    options.prepare.mockImplementationOnce(async () => {
      await gate;
      return material;
    });
    const attaching = service.attach(id);
    await Promise.resolve();
    const cancelling = service.cancel(id);
    release?.();
    await cancelling;
    expect(await attaching).toEqual({ status: 'cancelled' });
    expect(await service.analyze(id, 'mock')).toMatchObject({ status: 'failed' });

    await service.attach(id);
    await service.analyze(id, 'mock');
    await service.cancel(id);
    expect(await service.save(id, reviewed)).toMatchObject({ status: 'failed' });
    expect(await library.list()).toMatchObject({ kits: [] });
  });

  it('enforces the processing limits of preparation and analysis', async () => {
    const expired = () => {
      const controller = new AbortController();
      const error = new Error('deadline');
      error.name = 'TimeoutError';
      controller.abort(error);
      return controller.signal;
    };
    const { service, options, provider, library } = await fixture();
    const id = randomUUID();
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(expired());
    options.prepare.mockImplementationOnce((_paths, signal) => {
      signal.throwIfAborted();
      return Promise.resolve(material);
    });
    const slow = await service.attach(id);
    expect(slow).toMatchObject({ status: 'failed' });
    if (slow.status === 'failed') expect(slow.message).toContain('longer than three minutes');

    await service.attach(id);
    const original = provider.analyzeBrandProfile.bind(provider);
    vi.spyOn(AbortSignal, 'timeout').mockReturnValueOnce(expired());
    // A provider that answers after the deadline: the answer is not used.
    vi.spyOn(provider, 'analyzeBrandProfile').mockImplementationOnce((request, context) =>
      original(request, { ...context, signal: new AbortController().signal }),
    );
    const late = await service.analyze(id, 'mock');
    expect(late).toMatchObject({ status: 'failed' });
    if (late.status === 'failed') expect(late.message).toContain('three minutes');
    expect(await service.save(id, reviewed)).toMatchObject({ status: 'failed' });
    expect(await library.list()).toMatchObject({ kits: [] });
  });

  it('discards a draft the window abandoned instead of blocking the next one', async () => {
    const { service, library } = await fixture();
    const abandoned = randomUUID();
    await service.attach(abandoned);
    await service.analyze(abandoned, 'mock');
    const next = randomUUID();
    await expect(service.attach(next)).resolves.toMatchObject({ status: 'prepared' });
    // The abandoned proposal is gone: it can no longer be saved.
    expect(await service.save(abandoned, reviewed)).toMatchObject({ status: 'failed' });
    expect(await library.list()).toMatchObject({ kits: [] });
    await expect(service.analyze(next, 'mock')).resolves.toMatchObject({ status: 'proposed' });
  });

  it('keeps attached files when a later selection is dismissed or fails', async () => {
    const { service, options } = await fixture();
    const id = randomUUID();
    await service.attach(id);
    options.select.mockResolvedValueOnce(null);
    expect(await service.attach(id)).toEqual({ status: 'cancelled' });
    options.prepare.mockRejectedValueOnce(
      Object.assign(new Error('ENOENT: /private/original/gone.png'), { code: 'ENOENT' }),
    );
    const failed = await service.attach(id);
    expect(failed).toMatchObject({ status: 'failed' });
    expect(JSON.stringify(failed)).not.toContain('/private');
    await expect(service.analyze(id, 'mock')).resolves.toMatchObject({ status: 'proposed' });
    // A dismissed first selection leaves no draft behind.
    const empty = await fixture();
    empty.options.select.mockResolvedValueOnce(null);
    expect(await empty.service.attach(id)).toEqual({ status: 'cancelled' });
    expect(await empty.service.analyze(id, 'mock')).toMatchObject({ status: 'failed' });
  });
});
