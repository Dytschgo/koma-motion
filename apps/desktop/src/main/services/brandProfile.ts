/**
 * A brand profile from reference files: several images, PDFs and PPTX decks
 * are prepared locally, analyzed once by the selected agent, and proposed as
 * a Brand Kit with matching project instructions. The draft lives here until
 * the user saves it; the project is never touched from this service.
 */
import { createHash } from 'node:crypto';
import { open } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import {
  fontsNamedInMaterial,
  MAX_BRAND_PROFILE_TEXT_LENGTH,
  validateBrandProfileAnalysis,
  type BrandProfileAnalysisRequest,
  type ProviderRegistry,
} from '@koma-motion/agent-runtime';
import { MAX_EMBEDDED_ASSET_BYTES, type BrandKit } from '@koma-motion/core';
import { imageSize } from 'image-size';
import {
  BRAND_PROFILE_ANALYSIS_TIMEOUT_MS,
  BRAND_PROFILE_PREPARATION_TIMEOUT_MS,
  MAX_BRAND_PROFILE_EXHIBITS,
  MAX_BRAND_PROFILE_FILES,
  MAX_BRAND_PROFILE_IMAGE_BYTES,
  MAX_BRAND_PROFILE_IMAGE_PIXELS,
  MAX_BRAND_PROFILE_IMAGE_SIDE,
  MAX_BRAND_PROFILE_REQUEST_CHARACTERS,
  MAX_BRAND_PROFILE_TOTAL_BYTES,
  preparedMaterialSchema,
  type BrandProfileProgress,
  type BrandProfileProposal,
  type PreparedMaterial,
} from '../../shared/brandProfile';
import { MAX_DECK_BYTES } from '../../shared/deckAnalysis';
import type { BrandKitLibrary } from './brandKitLibrary';
import { prepareDeck } from './deckAnalysis';
import { renderReferenceImage } from './deckPdf';
import { detectImageType, IMAGE_FILE_EXTENSIONS, toDisplayName } from './imageAsset';

export const BRAND_PROFILE_FILE_EXTENSIONS = [...IMAGE_FILE_EXTENSIONS, 'pdf', 'pptx'] as const;

type Material = Omit<PreparedMaterial, 'sessionId'>;
type Report = (
  phase: BrandProfileProgress['phase'],
  message: string,
  completed?: number,
  total?: number,
) => void;

/** Only messages created here may cross IPC; OS and parser errors can contain paths. */
class MaterialError extends Error {}

function kindOf(path: string): 'image' | 'pdf' | 'pptx' {
  const extension = extname(path).slice(1).toLowerCase();
  if (extension === 'pdf' || extension === 'pptx') return extension;
  if ((IMAGE_FILE_EXTENSIONS as readonly string[]).includes(extension)) return 'image';
  throw new MaterialError(
    `"${toDisplayName(basename(path))}" is not supported. Choose PNG, JPEG, WebP, GIF, PDF or PPTX files.`,
  );
}

const mebibytes = (bytes: number): string => String(bytes / 1024 / 1024);

/** Reads an image without exceeding its limit, including if the file grows after selection. */
async function readImage(path: string, name: string, signal: AbortSignal): Promise<Buffer> {
  const handle = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(MAX_BRAND_PROFILE_IMAGE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      signal.throwIfAborted();
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length === 0 || length > MAX_BRAND_PROFILE_IMAGE_BYTES)
      throw new MaterialError(
        `"${name}" must be a nonempty image of at most ${mebibytes(MAX_BRAND_PROFILE_IMAGE_BYTES)} MiB.`,
      );
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

/** Up to `count` entries, evenly spaced, always including the first and the last. */
function sample<T>(items: readonly T[], count: number): T[] {
  if (items.length <= count) return [...items];
  if (count === 1) return items.slice(0, 1);
  return Array.from(
    { length: count },
    (_, index) => items[Math.round((index * (items.length - 1)) / (count - 1))],
  ).filter((item): item is T => item !== undefined);
}

/**
 * Prepares the selected files. Every limit is checked here, in the main
 * process: file count, type by content, size per file and in total, image
 * dimensions, exhibits and extracted text.
 */
export async function prepareMaterial(
  paths: readonly string[],
  signal: AbortSignal,
  report: Report,
  dependencies: {
    readonly prepareDeck?: typeof prepareDeck;
    readonly renderImage?: typeof renderReferenceImage;
  } = {},
): Promise<Material> {
  if (paths.length === 0) throw new MaterialError('Choose at least one file.');
  if (paths.length > MAX_BRAND_PROFILE_FILES)
    throw new MaterialError(
      `Choose at most ${String(MAX_BRAND_PROFILE_FILES)} files. ${String(paths.length)} were selected; nothing was attached.`,
    );
  const selected = paths.map((path, index) => ({
    path,
    file: index + 1,
    kind: kindOf(path),
    name: toDisplayName(basename(path)),
  }));

  // Sizes are checked for every file before any file is processed.
  let totalBytes = 0;
  for (const { path, kind, name } of selected) {
    signal.throwIfAborted();
    const handle = await open(path, 'r');
    try {
      const details = await handle.stat();
      const limit = kind === 'image' ? MAX_BRAND_PROFILE_IMAGE_BYTES : MAX_DECK_BYTES;
      if (!details.isFile() || details.size === 0 || details.size > limit)
        throw new MaterialError(
          `"${name}" must be a nonempty ${kind === 'image' ? 'image' : 'deck'} of at most ${mebibytes(limit)} MiB. Nothing was attached.`,
        );
      totalBytes += details.size;
    } finally {
      await handle.close();
    }
  }
  if (totalBytes > MAX_BRAND_PROFILE_TOTAL_BYTES)
    throw new MaterialError(
      `The selected files may total at most ${mebibytes(MAX_BRAND_PROFILE_TOTAL_BYTES)} MiB. Nothing was attached.`,
    );

  const images = selected.filter((item) => item.kind === 'image').length;
  const decks = selected.length - images;
  const slidesPerDeck = decks === 0 ? 0 : Math.floor((MAX_BRAND_PROFILE_EXHIBITS - images) / decks);

  const files: Material['files'] = [];
  const exhibits: Material['exhibits'] = [];
  const logos: Material['logos'] = [];
  const warnings: string[] = [];
  for (const { path, file, kind, name } of selected) {
    signal.throwIfAborted();
    report('preparing', `Preparing ${name} locally`, file - 1, selected.length);
    if (kind === 'image') {
      const bytes = await readImage(path, name, signal);
      const mediaType = detectImageType(bytes);
      if (mediaType === null)
        throw new MaterialError(`"${name}" is not a PNG, JPEG, WebP or GIF image.`);
      let size: { width: number; height: number };
      try {
        size = imageSize(bytes);
      } catch {
        throw new MaterialError(`"${name}" could not be read as an image.`);
      }
      if (
        size.width < 1 ||
        size.height < 1 ||
        size.width > MAX_BRAND_PROFILE_IMAGE_SIDE ||
        size.height > MAX_BRAND_PROFILE_IMAGE_SIDE ||
        size.width * size.height > MAX_BRAND_PROFILE_IMAGE_PIXELS
      )
        throw new MaterialError(
          `"${name}" is larger than ${String(MAX_BRAND_PROFILE_IMAGE_SIDE)} pixels on a side or 40 megapixels. Attach a smaller copy.`,
        );
      const { image } = await (dependencies.renderImage ?? renderReferenceImage)(bytes, signal);
      const number = exhibits.length + 1;
      exhibits.push({ number, file, kind: 'image', page: null, text: '', ...image });
      files.push({ file, name, kind, total: 1 });
      // The uploaded bytes themselves can become the logo, if the user confirms one.
      if (bytes.byteLength <= MAX_EMBEDDED_ASSET_BYTES && logos.length < 8)
        logos.push({
          id: `logo-${createHash('sha256').update(bytes).update(String(file)).digest('hex').slice(0, 32)}`,
          file,
          exhibits: [number],
          image: { name, mediaType, data: bytes.toString('base64') },
        });
      continue;
    }
    const deck = await (dependencies.prepareDeck ?? prepareDeck)(path, signal, (_phase, message) =>
      report('preparing', `${name}: ${message}`, file - 1, selected.length),
    );
    const slides = sample(deck.slides, slidesPerDeck);
    const numbers = new Map<number, number>();
    for (const slide of slides) {
      const number = exhibits.length + 1;
      numbers.set(slide.number, number);
      exhibits.push({
        number,
        file,
        kind: 'slide',
        page: slide.number,
        text: slide.text,
        mediaType: 'image/png',
        preview: slide.preview,
      });
    }
    files.push({ file, name, kind, total: deck.totalSlides });
    if (slides.length < deck.totalSlides)
      warnings.push(
        `${name}: ${String(slides.length)} of ${String(deck.totalSlides)} slides were prepared. Only the listed slides will be analyzed.`,
      );
    if (kind === 'pptx')
      warnings.push(
        `${name}: LibreOffice may substitute unavailable fonts or render some PowerPoint effects differently. Inspect the prepared previews before analysis.`,
      );
    for (const logo of deck.logos) {
      const shown = logo.slides.flatMap((slide) => numbers.get(slide) ?? []);
      if (shown.length > 0 && logos.length < 8 && !logos.some((item) => item.id === logo.id))
        logos.push({ id: logo.id, file, exhibits: shown, image: logo.image });
    }
  }
  signal.throwIfAborted();
  if (
    exhibits.reduce((total, exhibit) => total + exhibit.text.length, 0) >
    MAX_BRAND_PROFILE_TEXT_LENGTH
  )
    throw new MaterialError(
      'The selected decks contain more than 200,000 characters of text. Attach fewer or shorter decks.',
    );
  // The provider request is refused above 24 MiB. Say so now, not after the review.
  if (
    exhibits.reduce((total, exhibit) => total + exhibit.preview.length + exhibit.text.length, 0) >
    MAX_BRAND_PROFILE_REQUEST_CHARACTERS
  )
    throw new MaterialError(
      'The prepared previews are larger than one analysis can take. Attach fewer files or smaller images.',
    );
  return { files, exhibits, logos, warnings };
}

interface Session {
  id: string;
  controller: AbortController;
  material: PreparedMaterial | null;
  proposal: BrandProfileProposal | null;
  work: Promise<unknown> | null;
  /** Stops the running analysis only. The attached material stays. */
  analysis: AbortController | null;
  saving: boolean;
}

const failure = (error: unknown, fallback: string) => ({
  status: 'failed' as const,
  message:
    error instanceof Error && !('code' in error) && error.name !== 'ZodError'
      ? error.message
      : fallback,
});

/** Owns one isolated draft. It has no project or presentation dependency. */
export class BrandProfileService {
  #session: Session | null = null;
  constructor(
    private readonly options: {
      /** Paths from a native dialog only. Null when the dialog was dismissed. */
      select(): Promise<readonly string[] | null>;
      prepare?: typeof prepareMaterial;
      registry: ProviderRegistry;
      library: BrandKitLibrary;
      progress(event: BrandProfileProgress): void;
      allowMock: boolean;
    },
  ) {}

  /** Stops pending work and discards the draft. A save in progress is allowed to finish. */
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
    session.material = null;
    session.proposal = null;
  }

  /** Stops a running analysis and keeps the attached material. No proposal is kept. */
  async stopAnalysis(id: string): Promise<void> {
    const session = this.#session;
    if (!session || session.id !== id || !session.analysis) return;
    session.analysis.abort();
    await session.work?.catch(() => undefined);
  }

  /**
   * Lets the user choose files and prepares them. Choosing again replaces the
   * attached material; a dismissed dialog or a failure keeps what was attached.
   */
  async attach(id: string) {
    // A draft with another id was abandoned by the window, for example when the
    // project was replaced. It is discarded so that it cannot block this one.
    if (this.#session !== null && this.#session.id !== id && !this.#session.saving)
      await this.cancel();
    const existing = this.#session;
    if (existing !== null && (existing.id !== id || existing.work || existing.saving))
      return failure(
        new Error('Finish or discard the current brand material before attaching other files.'),
        '',
      );
    const session: Session = existing ?? {
      id,
      controller: new AbortController(),
      material: null,
      proposal: null,
      work: null,
      analysis: null,
      saving: false,
    };
    this.#session = session;
    const report: Report = (phase, message, completed = 0, total = 0) => {
      if (this.#session === session && !session.controller.signal.aborted)
        this.options.progress({ sessionId: id, phase, message, completed, total });
    };
    let deadline: AbortSignal | null = null;
    const work = async () => {
      try {
        report('opening', 'Choose reference files');
        const paths = await this.options.select();
        session.controller.signal.throwIfAborted();
        if (paths === null) {
          if (session.material === null) this.#session = null;
          return { status: 'cancelled' as const };
        }
        // The time limit covers preparation, not the time spent in the dialog.
        deadline = AbortSignal.timeout(BRAND_PROFILE_PREPARATION_TIMEOUT_MS);
        const material = await (this.options.prepare ?? prepareMaterial)(
          paths,
          AbortSignal.any([session.controller.signal, deadline]),
          report,
        );
        session.controller.signal.throwIfAborted();
        session.material = preparedMaterialSchema.parse({ ...material, sessionId: id });
        session.proposal = null;
        report('ready', 'Review exactly what will be sent');
        return { status: 'prepared' as const, material: session.material };
      } catch (error) {
        if (session.controller.signal.aborted) return { status: 'cancelled' as const };
        if (session.material === null && this.#session === session) this.#session = null;
        return failure(
          deadline?.aborted === true
            ? new Error(
                'Preparing the files took longer than three minutes. Nothing was attached. Attach fewer or smaller files.',
              )
            : error,
          'The selected files could not be prepared. Nothing was attached. Check that they still exist and are supported.',
        );
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
    if (!session || session.id !== id || !session.material || session.work || session.saving)
      return failure(new Error('Attach the reference files again before analyzing them.'), '');
    const provider = this.options.registry.get(providerId);
    if (!provider?.analyzeBrandProfile || (providerId === 'mock' && !this.options.allowMock))
      return failure(new Error('This provider cannot analyze reference files.'), '');
    const material = session.material;
    const request: BrandProfileAnalysisRequest = {
      exhibits: material.exhibits,
      logoCandidates: material.logos.map((logo) => ({
        id: logo.id,
        exhibits: logo.exhibits,
        // An uploaded image is already an exhibit; only extracted logos add an image.
        preview:
          material.files.find((file) => file.file === logo.file)?.kind === 'image'
            ? null
            : logo.image.data,
      })),
    };
    const deadline = AbortSignal.timeout(BRAND_PROFILE_ANALYSIS_TIMEOUT_MS);
    const stop = new AbortController();
    session.analysis = stop;
    session.proposal = null;
    const stopped = () => session.controller.signal.aborted || stop.signal.aborted;
    const pending = (async () => {
      try {
        // The selected provider is used or the analysis fails. There is no fallback.
        const detection = await provider.detect();
        if (stopped()) return { status: 'cancelled' as const };
        if (detection.availability !== 'available')
          return failure(
            new Error(
              `${provider.displayName} is not available, so nothing was sent or analyzed. ${detection.message} No other provider was used.`,
            ),
            '',
          );
        this.options.progress({
          sessionId: id,
          phase: 'analyzing',
          message:
            providerId === 'mock'
              ? 'Creating a mock proposal locally'
              : 'Claude Code · Opus is analyzing the prepared material',
          completed: 0,
          total: material.exhibits.length,
        });
        const signal = AbortSignal.any([session.controller.signal, stop.signal, deadline]);
        const output = await provider.analyzeBrandProfile!(request, { model: 'opus', signal });
        signal.throwIfAborted();
        if (this.#session !== session) return { status: 'cancelled' as const };
        this.options.progress({
          sessionId: id,
          phase: 'validating',
          message: 'Validating the proposal',
          completed: material.exhibits.length,
          total: material.exhibits.length,
        });
        const proposal = validateBrandProfileAnalysis(output, request);
        session.proposal = {
          proposal,
          fontsNamedInMaterial: fontsNamedInMaterial(proposal, request),
          provider: providerId,
          model: providerId === 'mock' ? 'mock' : 'opus',
          analyzedAt: new Date().toISOString(),
        };
        return { status: 'proposed' as const, ...session.proposal };
      } catch (error) {
        session.proposal = null;
        if (stopped()) return { status: 'cancelled' as const };
        return failure(
          deadline.aborted
            ? new Error(
                'Analysis exceeded three minutes. Nothing was saved or applied. Retry or attach fewer files.',
              )
            : error,
          'The agent returned a proposal that did not pass validation. Nothing was saved or applied. Retry the analysis.',
        );
      }
    })();
    session.work = pending;
    try {
      return await pending;
    } finally {
      session.work = null;
      session.analysis = null;
    }
  }

  /**
   * Saves the reviewed Brand Kit and instructions as one library entry, in a
   * single write. After a failure the draft stays open, so saving can be retried.
   */
  async save(
    id: string,
    reviewed: {
      readonly name: string;
      readonly brandKit: BrandKit;
      readonly instructions: string;
      readonly logoCandidateId: string | null;
    },
  ) {
    const session = this.#session;
    if (
      !session ||
      session.id !== id ||
      !session.material ||
      !session.proposal ||
      session.work ||
      session.saving
    )
      return failure(
        new Error('This draft is no longer available. Attach the reference files again.'),
        '',
      );
    const { material, proposal } = session;
    const logo =
      reviewed.logoCandidateId === null
        ? null
        : material.logos.find((candidate) => candidate.id === reviewed.logoCandidateId);
    if (logo === undefined)
      return failure(new Error('This logo does not belong to the attached files.'), '');
    session.saving = true;
    try {
      const pending = this.options.library.create({
        name: reviewed.name,
        brandKit: { ...reviewed.brandKit, logoAssetId: null },
        logo: logo?.image ?? null,
        instructions: reviewed.instructions,
        referenceProvenance: {
          analyzedAt: proposal.analyzedAt,
          provider: proposal.provider,
          model: proposal.model,
          files: material.files.map((file) => ({
            fileName: file.name,
            kind: file.kind,
            analyzed: material.exhibits.filter((exhibit) => exhibit.file === file.file).length,
            total: file.total,
          })),
        },
      });
      session.work = pending;
      const result = await pending;
      if (result.status === 'ready') {
        this.#session = null;
        session.material = null;
        session.proposal = null;
      }
      return result;
    } catch {
      return failure(
        new Error(
          'The Brand Kit library could not be saved. Your reviewed draft is still open; retry after checking disk space and permissions.',
        ),
        '',
      );
    } finally {
      session.saving = false;
      session.work = null;
    }
  }
}
