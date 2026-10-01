import { open } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { basename, extname } from 'node:path';
import {
  MAX_REFERENCE_FILES,
  MAX_REFERENCE_TEXT_LENGTH,
  MAX_TOTAL_REFERENCE_TEXT_LENGTH,
  referenceTextSchema,
  type ReferenceText,
} from '@koma-motion/agent-runtime';
import { dialog, type BrowserWindow } from 'electron';
import type { ReferenceSelectionOutcome } from '../../shared/references';

export const MAX_REFERENCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_REFERENCE_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_REFERENCE_PDF_PAGES = 40;
const PDF_TIMEOUT_MS = 15_000;

type ReferenceFormat = ReferenceText['format'];

function formatOf(fileName: string): ReferenceFormat {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.txt') return 'txt';
  if (extension === '.md') return 'md';
  if (extension === '.pdf') return 'pdf';
  throw new Error('Choose a TXT, Markdown or PDF file.');
}

function safeName(filePath: string): string {
  // A file name is display metadata, never a path or a provider instruction.
  const name = basename(filePath)
    .replace(/[\p{Cc}\p{Cf}]/gu, ' ')
    .trim()
    .slice(0, 180);
  return name || 'Reference';
}

function clipText(text: string): { text: string; truncated: boolean } {
  const normalized = text.replace(/\r\n?/g, '\n').trim();
  const truncated = normalized.length > MAX_REFERENCE_TEXT_LENGTH;
  return { text: normalized.slice(0, MAX_REFERENCE_TEXT_LENGTH).trim(), truncated };
}

async function pdfText(bytes: Uint8Array): Promise<{ text: string; truncated: boolean }> {
  if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) {
    throw new Error('The selected PDF is invalid. Export a new copy.');
  }
  const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const loadingTask = getDocument({
    data: new Uint8Array(bytes),
    useSystemFonts: false,
    stopAtErrors: true,
  });
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const extraction = (async () => {
      const pdf = await loadingTask.promise;
      if (pdf.numPages > MAX_REFERENCE_PDF_PAGES) {
        throw new Error(
          `A PDF reference may have at most ${String(MAX_REFERENCE_PDF_PAGES)} pages.`,
        );
      }
      let text = '';
      let truncated = false;
      for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
        const page = await pdf.getPage(pageNumber);
        const content = await page.getTextContent();
        const pageText = content.items
          .filter((item): item is typeof item & { str: string } => 'str' in item)
          .map((item) => item.str)
          .join(' ');
        text += `${pageText}\n`;
        if (text.length > MAX_REFERENCE_TEXT_LENGTH) {
          truncated = true;
          break;
        }
      }
      const clipped = clipText(text);
      return { text: clipped.text, truncated: truncated || clipped.truncated };
    })();
    return await Promise.race([
      extraction,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error('PDF text extraction took too long. Choose a smaller PDF.')),
          PDF_TIMEOUT_MS,
        );
      }),
    ]);
  } finally {
    if (timeout !== undefined) clearTimeout(timeout);
    await loadingTask.destroy();
  }
}

/** Only decoded text enters IPC and the provider request. No PDF scripts or links are run. */
export async function prepareReference(
  fileName: string,
  bytes: Uint8Array,
  id = randomUUID(),
): Promise<ReferenceText> {
  if (bytes.byteLength > MAX_REFERENCE_FILE_BYTES) {
    throw new Error('A reference file may be at most 10 MiB.');
  }
  const format = formatOf(fileName);
  let extracted: { text: string; truncated: boolean };
  if (format === 'pdf') {
    extracted = await pdfText(bytes);
  } else {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new Error('The text file must use UTF-8 encoding.');
    }
    if (text.includes('\0')) {
      throw new Error('The selected file contains binary data. Choose a UTF-8 text file.');
    }
    extracted = clipText(text);
  }
  if (extracted.text.length === 0) {
    throw new Error('The selected file has no extractable text.');
  }
  return referenceTextSchema.parse({
    id,
    name: safeName(fileName),
    format,
    ...extracted,
  });
}

/** Reads no more than the configured per-file bound, including if a file changes after selection. */
async function readBounded(filePath: string): Promise<Uint8Array> {
  const handle = await open(filePath, 'r');
  try {
    const details = await handle.stat();
    if (!details.isFile()) throw new Error('The selected item is not a file.');
    if (details.size > MAX_REFERENCE_FILE_BYTES) {
      throw new Error('A reference file may be at most 10 MiB.');
    }
    const buffer = Buffer.alloc(MAX_REFERENCE_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_REFERENCE_FILE_BYTES) {
      throw new Error('A reference file may be at most 10 MiB.');
    }
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

/** Native selection is the sole source of file paths. References live only in the chat session. */
export async function selectReferenceFiles(
  window: BrowserWindow,
): Promise<ReferenceSelectionOutcome> {
  const selection = await dialog.showOpenDialog(window, {
    title: 'Choose reference files',
    filters: [{ name: 'Reference text', extensions: ['txt', 'md', 'pdf'] }],
    properties: ['openFile', 'multiSelections'],
  });
  if (selection.canceled || selection.filePaths.length === 0) return { status: 'cancelled' };
  if (selection.filePaths.length > MAX_REFERENCE_FILES) {
    return { status: 'failed', message: 'Choose at most 5 reference files.' };
  }
  try {
    const references: ReferenceText[] = [];
    let totalBytes = 0;
    for (const filePath of selection.filePaths) {
      const bytes = await readBounded(filePath);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_REFERENCE_FILE_BYTES) {
        throw new Error('Reference files may total at most 20 MiB.');
      }
      references.push(await prepareReference(filePath, bytes));
      if (
        references.reduce((total, reference) => total + reference.text.length, 0) >
        MAX_TOTAL_REFERENCE_TEXT_LENGTH
      ) {
        throw new Error('Extracted reference text may total at most 200,000 characters.');
      }
    }
    return { status: 'selected', references };
  } catch (error) {
    return {
      status: 'failed',
      message:
        error instanceof Error ? error.message.slice(0, 500) : 'The reference could not be read.',
    };
  }
}
