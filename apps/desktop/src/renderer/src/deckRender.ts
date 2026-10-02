import { z } from 'zod';
import { getDocument } from 'pdfjs-dist';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import { MAX_ANALYZED_SLIDES, MAX_DECK_BYTES, MAX_DECK_PAGES } from '../../shared/deckAnalysis';
import { MAX_BRAND_PROFILE_IMAGE_BYTES } from '../../shared/brandProfile';

// Bundled worker runs inside this disposable sandboxed renderer, without a
// worker URL, fetch, eval, a filesystem API or any network permission.
Object.assign(globalThis, { pdfjsWorker: { WorkerMessageHandler } });
declare global {
  interface Window {
    deckRenderer?: {
      input(): Promise<Uint8Array>;
      progress(completed: number, total: number): void;
      finish(result: unknown): void;
    };
  }
}

class DeckRenderError extends Error {}

async function run(): Promise<void> {
  const bridge = window.deckRenderer;
  if (!bridge) return;
  const bytes = await bridge.input();
  // An image is recognised by its signature first: its metadata may contain any text.
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 1024));
  const image =
    (bytes[0] === 0x89 && head.slice(1, 4) === 'PNG') ||
    (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) ||
    head.startsWith('GIF8') ||
    (head.startsWith('RIFF') && head.slice(8, 12) === 'WEBP');
  if (image || !head.includes('%PDF-')) {
    bridge.finish({ image: await renderImage(bytes) });
    return;
  }
  if (bytes.byteLength > MAX_DECK_BYTES) throw new DeckRenderError('The PDF exceeds 32 MiB.');
  const loading = getDocument({
    data: bytes,
    useWasm: false,
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    maxImageSize: 16_000_000,
    canvasMaxAreaInBytes: 16_000_000,
    stopAtErrors: true,
  });
  loading.onPassword = () => {
    bridge.finish({
      error: 'This deck is password protected. Export an unprotected copy and try again.',
    });
    void loading.destroy();
  };
  const document = await loading.promise;
  try {
    if (document.numPages < 1 || document.numPages > MAX_DECK_PAGES)
      throw new DeckRenderError('Choose a deck with 1–200 slides.');
    const count = Math.min(document.numPages, MAX_ANALYZED_SLIDES);
    const numbers = Array.from({ length: count }, (_, index) =>
      count === 1 ? 1 : 1 + Math.round((index * (document.numPages - 1)) / (count - 1)),
    );
    const slides = [];
    for (const number of numbers) {
      const page = await document.getPage(number);
      const original = page.getViewport({ scale: 1 });
      if (
        !Number.isFinite(original.width) ||
        !Number.isFinite(original.height) ||
        original.width <= 0 ||
        original.height <= 0 ||
        original.width > 20000 ||
        original.height > 20000
      )
        throw new DeckRenderError('A slide has unsupported dimensions.');
      const viewport = page.getViewport({
        scale: Math.min(1280 / original.width, 720 / original.height),
      });
      const canvas = documentCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height));
      const context = canvas.getContext('2d');
      if (!context) throw new DeckRenderError('A local slide preview could not be created.');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const stream = page.streamTextContent();
      const reader = stream.getReader();
      let text = '';
      try {
        for (;;) {
          const part = await reader.read();
          if (part.done) break;
          const items = z
            .object({ items: z.array(z.object({ str: z.string().optional() })) })
            .parse(part.value).items;
          for (const item of items) {
            if (item.str !== undefined) text += item.str + '\n';
          }
          if (text.length > 20000)
            throw new DeckRenderError(
              `Slide ${number} contains more than 20,000 characters. Export a shorter deck.`,
            );
        }
      } finally {
        await reader.cancel();
      }
      const preview = canvas.toDataURL('image/png').split(',')[1] ?? '';
      if (preview.length > 1500000)
        throw new DeckRenderError(
          `Slide ${number} exceeds the preview size limit. Export a lower-resolution PDF.`,
        );
      slides.push({ number, text, preview });
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
      bridge.progress(slides.length, count);
    }
    bridge.finish({ slides, totalSlides: document.numPages });
  } finally {
    await loading.destroy();
  }
}
/** A bounded preview of an uploaded image: PNG, or JPEG on white when the PNG is too large. */
async function renderImage(
  bytes: Uint8Array,
): Promise<{ mediaType: 'image/png' | 'image/jpeg'; preview: string }> {
  if (bytes.byteLength > MAX_BRAND_PROFILE_IMAGE_BYTES)
    throw new DeckRenderError('The image exceeds 10 MiB.');
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
  } catch {
    throw new DeckRenderError(
      'An image could not be decoded. Export it again as PNG, JPEG, WebP or GIF.',
    );
  }
  try {
    const scale = Math.min(1, 1280 / Math.max(bitmap.width, bitmap.height));
    const canvas = documentCanvas(
      Math.max(1, Math.round(bitmap.width * scale)),
      Math.max(1, Math.round(bitmap.height * scale)),
    );
    const context = canvas.getContext('2d');
    if (!context) throw new DeckRenderError('A local image preview could not be created.');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const png = canvas.toDataURL('image/png').split(',')[1] ?? '';
    if (png !== '' && png.length <= 1500000) return { mediaType: 'image/png', preview: png };
    context.globalCompositeOperation = 'destination-over';
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    const jpeg = canvas.toDataURL('image/jpeg', 0.85).split(',')[1] ?? '';
    if (jpeg === '' || jpeg.length > 1500000)
      throw new DeckRenderError('An image is too detailed to prepare. Attach a smaller copy.');
    return { mediaType: 'image/jpeg', preview: jpeg };
  } finally {
    bitmap.close();
  }
}
function documentCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}
void run().catch((error: unknown) =>
  window.deckRenderer?.finish({
    error:
      error instanceof DeckRenderError
        ? error.message
        : 'This PDF could not be processed safely. It may be damaged, unsupported or too complex. Export a new PDF and try again.',
  }),
);
