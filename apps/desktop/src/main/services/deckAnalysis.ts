import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, extname, join } from 'node:path';
import { validateBrandKitAnalysis, type ProviderRegistry } from '@koma-motion/agent-runtime';
import type { BrandKit } from '@koma-motion/core';
import type { BrandKitLibrary } from './brandKitLibrary';
import {
  MAX_DECK_BYTES,
  preparedDeckSchema,
  type DeckProgress,
  type DeckProposal,
  type PreparedDeck,
} from '../../shared/deckAnalysis';
import { toDisplayName } from './imageAsset';
import { convertPptx, extractLogoCandidates, inspectPptx } from './deckPptx';
import { renderDeckPdf } from './deckPdf';

export async function prepareDeck(
  path: string,
  signal: AbortSignal,
  report: (
    phase: DeckProgress['phase'],
    message: string,
    completed?: number,
    total?: number,
  ) => void,
): Promise<Omit<PreparedDeck, 'sessionId'>> {
  const directory = await mkdtemp(join(tmpdir(), 'koma-motion-deck-'));
  try {
    signal.throwIfAborted();
    const extension = extname(path).toLowerCase();
    if (extension !== '.pdf' && extension !== '.pptx')
      throw new Error('Choose a PPTX or PDF presentation.');
    const file = await open(path, 'r');
    let bytes: Buffer;
    try {
      const details = await file.stat();
      if (!details.isFile() || details.size < 8 || details.size > MAX_DECK_BYTES)
        throw new Error('Choose a nonempty deck smaller than 32 MiB.');
      // Bounded read even if another process grows the selected file.
      bytes = Buffer.alloc(details.size + 1);
      let offset = 0;
      while (offset < bytes.length) {
        signal.throwIfAborted();
        const read = await file.read(bytes, offset, bytes.length - offset, offset);
        if (read.bytesRead === 0) break;
        offset += read.bytesRead;
      }
      if (offset !== details.size)
        throw new Error('The deck changed while it was being read. Select it again.');
      bytes = bytes.subarray(0, offset);
    } finally {
      await file.close();
    }
    let logos: PreparedDeck['logos'] = [];
    const warnings: string[] = [];
    report('checking', 'Checking deck safety and size');
    if (extension === '.pptx') {
      const inspected = await inspectPptx(bytes, signal);
      logos = extractLogoCandidates(inspected.media, inspected.references);
      report('converting', 'Creating a local PDF with LibreOffice');
      bytes = await convertPptx(bytes, directory, signal);
      warnings.push(
        'LibreOffice may substitute unavailable fonts or render some PowerPoint effects differently. Inspect the prepared previews before analysis.',
      );
    }
    if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-')))
      throw new Error('This file is not a valid PDF. Export a new copy.');
    report('rendering', 'Rendering selected slides locally');
    const rendered = await renderDeckPdf(bytes, signal, (completed, total) =>
      report('rendering', `Rendered ${completed} of ${total} selected slides`, completed, total),
    );
    signal.throwIfAborted();
    const selectedSlides = new Set(rendered.slides.map((slide) => slide.number));
    logos = logos.filter((logo) => logo.slides.some((slide) => selectedSlides.has(slide)));
    if (rendered.totalSlides > rendered.slides.length)
      warnings.push(
        `A representative sample of ${rendered.slides.length} of ${rendered.totalSlides} slides was prepared. Only the listed slides will be analyzed.`,
      );
    if (logos.length === 0)
      warnings.push('No reliable reusable logo was extracted. The proposed kit will have no logo.');
    return { ...rendered, logos, warnings, fileName: toDisplayName(basename(path)) };
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5 });
  }
}

interface Session {
  id: string;
  controller: AbortController;
  prepared: PreparedDeck | null;
  proposal: DeckProposal | null;
  work: Promise<unknown> | null;
  saving: boolean;
}
const failure = (error: unknown) => ({
  status: 'failed' as const,
  message:
    error instanceof Error && !('code' in error) && error.name !== 'ZodError'
      ? error.message
      : 'The deck could not be processed or validated. Nothing was saved. Export a new copy and retry.',
});

/** Owns one isolated draft. It has no project or presentation dependency. */
export class DeckAnalysisService {
  #session: Session | null = null;
  constructor(
    private readonly options: {
      select(): Promise<string | null>;
      prepare?: typeof prepareDeck;
      registry: ProviderRegistry;
      library: BrandKitLibrary;
      progress(event: DeckProgress): void;
      allowMock: boolean;
    },
  ) {}

  async cancel(id?: string): Promise<void> {
    const session = this.#session;
    if (!session || (id !== undefined && session.id !== id)) return;
    if (session.saving) {
      await session.work?.catch(() => undefined);
      return;
    }
    session.controller.abort();
    await session.work?.catch(() => undefined);
    if (this.#session === session) this.#session = null;
    session.prepared = null;
    session.proposal = null;
  }

  async prepare(id: string) {
    if (this.#session !== null)
      return failure(new Error('Close the current deck analysis before selecting another deck.'));
    const session: Session = {
      id,
      controller: new AbortController(),
      prepared: null,
      proposal: null,
      work: null,
      saving: false,
    };
    this.#session = session;
    const report = (phase: DeckProgress['phase'], message: string, completed = 0, total = 0) => {
      if (this.#session === session && !session.controller.signal.aborted)
        this.options.progress({ sessionId: id, phase, message, completed, total });
    };
    const work = async () => {
      try {
        report('opening', 'Choose a presentation deck');
        const path = await this.options.select();
        session.controller.signal.throwIfAborted();
        if (path === null) {
          this.#session = null;
          return { status: 'cancelled' as const };
        }
        const prepared = await (this.options.prepare ?? prepareDeck)(
          path,
          session.controller.signal,
          report,
        );
        session.controller.signal.throwIfAborted();
        session.prepared = preparedDeckSchema.parse({ ...prepared, sessionId: id });
        report('ready', 'Review exactly what will be sent');
        return { status: 'prepared' as const, deck: session.prepared };
      } catch (error) {
        if (session.controller.signal.aborted) return { status: 'cancelled' as const };
        this.#session = null;
        return failure(error);
      }
    };
    const pending = work();
    session.work = pending;
    try {
      return await pending;
    } finally {
      session.work = null;
    }
  }

  async analyze(id: string, providerId: 'claude-code' | 'mock') {
    const session = this.#session;
    if (!session || session.id !== id || !session.prepared || session.work || session.saving)
      return failure(new Error('Select a deck again before analyzing it.'));
    const provider = this.options.registry.get(providerId);
    if (!provider?.analyzeBrandKit || (providerId === 'mock' && !this.options.allowMock))
      return failure(new Error('This provider does not support visual Brand Kit analysis.'));
    const deck = session.prepared;
    // Candidates outside the analyzed sample are not sent or offered to the agent.
    const selected = new Set(deck.slides.map((slide) => slide.number));
    const request = {
      slides: deck.slides,
      totalSlides: deck.totalSlides,
      logoCandidates: deck.logos
        .filter((logo) => logo.slides.some((slide) => selected.has(slide)))
        .map((logo) => ({
          id: logo.id,
          slides: logo.slides.filter((slide) => selected.has(slide)),
          preview: logo.image.data,
        })),
    };
    const pending = (async () => {
      try {
        this.options.progress({
          sessionId: id,
          phase: 'analyzing',
          message:
            providerId === 'mock'
              ? 'Creating a mock proposal locally'
              : 'Claude Code · Opus is analyzing the prepared slides',
          completed: 0,
          total: deck.slides.length,
        });
        const signal = AbortSignal.any([session.controller.signal, AbortSignal.timeout(180000)]);
        const output = await provider.analyzeBrandKit!(request, { model: 'opus', signal });
        signal.throwIfAborted();
        if (this.#session !== session) return { status: 'cancelled' as const };
        this.options.progress({
          sessionId: id,
          phase: 'validating',
          message: 'Validating the Brand Kit proposal',
          completed: deck.slides.length,
          total: deck.slides.length,
        });
        const proposal = validateBrandKitAnalysis(output, request);
        session.proposal = {
          proposal,
          provider: providerId,
          model: providerId === 'mock' ? 'mock' : 'opus',
          analyzedAt: new Date().toISOString(),
        };
        return { status: 'proposed' as const, ...session.proposal };
      } catch (error) {
        session.proposal = null;
        if (session.controller.signal.aborted) return { status: 'cancelled' as const };
        return failure(
          error instanceof Error && error.name === 'TimeoutError'
            ? new Error(
                'Analysis exceeded three minutes. No Brand Kit was saved. Retry or choose a smaller deck.',
              )
            : error,
        );
      }
    })();
    session.work = pending;
    try {
      return await pending;
    } finally {
      session.work = null;
    }
  }

  async save(id: string, name: string, brandKit: BrandKit, logoCandidateId: string | null) {
    const session = this.#session;
    if (
      !session ||
      session.id !== id ||
      !session.prepared ||
      !session.proposal ||
      session.work ||
      session.saving
    )
      return failure(
        new Error('This analysis draft is no longer available. Select the deck again.'),
      );
    const logo =
      logoCandidateId === null
        ? null
        : session.prepared.logos.find((candidate) => candidate.id === logoCandidateId);
    if (logo === undefined)
      return failure(new Error('This logo does not belong to the current deck.'));
    session.saving = true;
    try {
      const pending = this.options.library.create({
        name,
        brandKit: { ...brandKit, logoAssetId: null },
        logo: logo?.image ?? null,
        provenance: {
          fileName: session.prepared.fileName,
          analyzedAt: session.proposal.analyzedAt,
          provider: session.proposal.provider,
          model: session.proposal.model,
          analyzedSlides: session.prepared.slides.map((slide) => slide.number),
          totalSlides: session.prepared.totalSlides,
        },
      });
      session.work = pending;
      const result = await pending;
      if (result.status === 'ready') {
        this.#session = null;
        session.prepared = null;
        session.proposal = null;
      }
      return result;
    } catch {
      return failure(
        new Error(
          'The Brand Kit library could not be saved. Your reviewed draft is still open; retry after checking disk space and permissions.',
        ),
      );
    } finally {
      session.saving = false;
      session.work = null;
    }
  }
}
