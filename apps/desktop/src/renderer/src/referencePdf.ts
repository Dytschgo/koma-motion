import { getDocument } from 'pdfjs-dist';
import { WorkerMessageHandler } from 'pdfjs-dist/build/pdf.worker.mjs';
import { MAX_REFERENCE_TEXT_LENGTH } from '@koma-motion/agent-runtime';
import { z } from 'zod';

Object.assign(globalThis, { pdfjsWorker: { WorkerMessageHandler } });

declare global {
  interface Window {
    referencePdf?: {
      input(): Promise<Uint8Array>;
      finish(result: unknown): void;
    };
  }
}

type FailureReason = 'invalid' | 'password' | 'pages' | 'processing';

async function run(): Promise<void> {
  const bridge = window.referencePdf;
  if (!bridge) return;
  let finished = false;
  const fail = (reason: FailureReason): void => {
    if (finished) return;
    finished = true;
    bridge.finish({ status: 'failed', reason });
  };
  try {
    const bytes = await bridge.input();
    if (bytes.byteLength > 10 * 1024 * 1024) {
      fail('invalid');
      return;
    }
    const loading = getDocument({
      data: bytes,
      enableXfa: false,
      useWasm: false,
      useSystemFonts: false,
      disableFontFace: true,
      useWorkerFetch: false,
      stopAtErrors: true,
    });
    loading.onPassword = () => {
      fail('password');
      void loading.destroy();
    };
    try {
      const pdf = await loading.promise;
      if (pdf.numPages < 1 || pdf.numPages > 40) {
        fail('pages');
        return;
      }
      let text = '';
      let truncated = false;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const reader = page.streamTextContent().getReader();
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            const items = z
              .object({ items: z.array(z.object({ str: z.string().optional() })) })
              .parse(part.value).items;
            for (const item of items) {
              if (item.str === undefined) continue;
              const next = `${item.str} `;
              const remaining = MAX_REFERENCE_TEXT_LENGTH + 1 - text.length;
              text += next.slice(0, remaining);
              if (next.length > remaining || text.length > MAX_REFERENCE_TEXT_LENGTH) {
                truncated = true;
                break;
              }
            }
            if (truncated) break;
          }
        } finally {
          await reader.cancel();
          page.cleanup();
        }
        if (truncated) break;
        text += '\n';
        if (text.length > MAX_REFERENCE_TEXT_LENGTH) {
          truncated = true;
          break;
        }
      }
      const normalized = text.replace(/\r\n?/g, '\n').trim();
      if (!finished) {
        finished = true;
        bridge.finish({
          status: 'extracted',
          text: normalized.slice(0, MAX_REFERENCE_TEXT_LENGTH).trim(),
          truncated,
        });
      }
    } finally {
      await loading.destroy();
    }
  } catch {
    fail('processing');
  }
}

void run();
