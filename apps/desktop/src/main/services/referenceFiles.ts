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
import { extractReferencePdf, ReferencePdfError } from './referencePdf';

export const MAX_REFERENCE_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_REFERENCE_FILE_BYTES = 20 * 1024 * 1024;
export const MAX_REFERENCE_PDF_PAGES = 40;

type ReferenceFormat = ReferenceText['format'];

/** Only messages created here may cross IPC; OS and parser errors can contain paths. */
class ReferenceFileError extends Error {}

function formatOf(fileName: string): ReferenceFormat {
  const extension = extname(fileName).toLowerCase();
  if (extension === '.txt') return 'txt';
  if (extension === '.md') return 'md';
  if (extension === '.pdf') return 'pdf';
  throw new ReferenceFileError('Choose a TXT, Markdown or PDF file.');
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

/** Only decoded text enters IPC and the provider request. No PDF scripts or links are run. */
export async function prepareReference(
  fileName: string,
  bytes: Uint8Array,
  id = randomUUID(),
  extractPdf?: (bytes: Uint8Array) => Promise<{ text: string; truncated: boolean }>,
): Promise<ReferenceText> {
  if (bytes.byteLength > MAX_REFERENCE_FILE_BYTES) {
    throw new ReferenceFileError('A reference file may be at most 10 MiB.');
  }
  const format = formatOf(fileName);
  let extracted: { text: string; truncated: boolean };
  if (format === 'pdf') {
    if (!Buffer.from(bytes.subarray(0, 1024)).includes(Buffer.from('%PDF-'))) {
      throw new ReferenceFileError('The selected PDF is invalid. Export a new copy.');
    }
    if (extractPdf === undefined) throw new ReferenceFileError('PDF processing is unavailable.');
    const pdf = await extractPdf(bytes);
    const clipped = clipText(pdf.text);
    extracted = { text: clipped.text, truncated: pdf.truncated || clipped.truncated };
  } else {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    } catch {
      throw new ReferenceFileError('The text file must use UTF-8 encoding.');
    }
    if (text.includes('\0')) {
      throw new ReferenceFileError(
        'The selected file contains binary data. Choose a UTF-8 text file.',
      );
    }
    extracted = clipText(text);
  }
  if (extracted.text.length === 0) {
    throw new ReferenceFileError('The selected file has no extractable text.');
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
    if (!details.isFile()) throw new ReferenceFileError('The selected item is not a file.');
    if (details.size > MAX_REFERENCE_FILE_BYTES) {
      throw new ReferenceFileError('A reference file may be at most 10 MiB.');
    }
    const buffer = Buffer.alloc(MAX_REFERENCE_FILE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > MAX_REFERENCE_FILE_BYTES) {
      throw new ReferenceFileError('A reference file may be at most 10 MiB.');
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
  try {
    const selection = await dialog.showOpenDialog(window, {
      title: 'Choose reference files',
      filters: [{ name: 'Reference text', extensions: ['txt', 'md', 'pdf'] }],
      properties: ['openFile', 'multiSelections'],
    });
    if (selection.canceled || selection.filePaths.length === 0) return { status: 'cancelled' };
    if (selection.filePaths.length > MAX_REFERENCE_FILES) {
      return { status: 'failed', message: 'Choose at most 5 reference files.' };
    }
    const references: ReferenceText[] = [];
    let totalBytes = 0;
    for (const filePath of selection.filePaths) {
      const bytes = await readBounded(filePath);
      totalBytes += bytes.byteLength;
      if (totalBytes > MAX_TOTAL_REFERENCE_FILE_BYTES) {
        throw new ReferenceFileError('Reference files may total at most 20 MiB.');
      }
      references.push(
        await prepareReference(filePath, bytes, randomUUID(), (file) =>
          extractReferencePdf(window, file),
        ),
      );
      if (
        references.reduce((total, reference) => total + reference.text.length, 0) >
        MAX_TOTAL_REFERENCE_TEXT_LENGTH
      ) {
        throw new ReferenceFileError(
          'Extracted reference text may total at most 200,000 characters.',
        );
      }
    }
    return { status: 'selected', references };
  } catch (error) {
    return {
      status: 'failed',
      message:
        error instanceof ReferenceFileError || error instanceof ReferencePdfError
          ? error.message
          : 'The reference could not be read. Check that it still exists and is supported.',
    };
  }
}
