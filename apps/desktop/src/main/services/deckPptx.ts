import { randomBytes } from 'node:crypto';
import { access, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, posix } from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildCliChildEnvironment, runProcess } from '@koma-motion/agent-runtime/node';
import { nativeImage } from 'electron';
import { XMLParser, XMLValidator } from 'fast-xml-parser';
import { imageSize } from 'image-size';
import { z } from 'zod';
import { fromBuffer, type Entry, type ZipFile } from 'yauzl';
import { MAX_DECK_BYTES, type PreparedDeck } from '../../shared/deckAnalysis';

function hasControl(value: string): boolean {
  return [...value].some((character) => character.charCodeAt(0) < 32);
}

const LIMIT = 128 * 1024 * 1024;
const XML_LIMIT = 2 * 1024 * 1024;
const parser = new XMLParser({ ignoreAttributes: false, processEntities: false });
const crcTable = Array.from({ length: 256 }, (_, value) => {
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});
function updateCrc(value: number, bytes: Buffer): number {
  for (const byte of bytes) value = (crcTable[(value ^ byte) & 255] ?? 0) ^ (value >>> 8);
  return value;
}
const officePaths = () =>
  process.platform === 'win32'
    ? [
        join(process.env['PROGRAMFILES'] ?? 'C:/Program Files', 'LibreOffice/program/soffice.exe'),
        join(
          process.env['PROGRAMFILES(X86)'] ?? 'C:/Program Files (x86)',
          'LibreOffice/program/soffice.exe',
        ),
      ]
    : ['/Applications/LibreOffice.app/Contents/MacOS/soffice', '/usr/bin/libreoffice'];

export async function findLibreOffice(): Promise<string | null> {
  const configured = process.env['KOMA_LIBREOFFICE_EXECUTABLE'];
  if (configured && isAbsolute(configured)) {
    try {
      await access(configured);
      return configured;
    } catch {
      return null;
    }
  }
  for (const candidate of officePaths()) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      /* try next installation */
    }
  }
  return null;
}

function validateXml(xml: string): void {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml) || XMLValidator.validate(xml) !== true)
    throw new Error('The PPTX contains invalid or unsupported XML.');
  let depth = 0;
  for (const match of xml.matchAll(/<([^>]+)>/g)) {
    const tag = match[1] ?? '';
    if (tag.startsWith('?') || tag.startsWith('!')) continue;
    if (tag.startsWith('/')) depth--;
    else if (!tag.endsWith('/')) depth++;
    if (depth > 64) throw new Error('The PPTX XML is too deeply nested.');
  }
}

/** Streams archive members with both declared and actual expansion limits. Never extracts paths. */
export async function inspectPptx(
  bytes: Buffer,
  signal: AbortSignal,
): Promise<{ media: Map<string, Buffer>; references: Map<string, number[]> }> {
  if (bytes.subarray(0, 8).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])))
    throw new Error(
      'This deck is encrypted or uses an older PowerPoint format. Export an unprotected PPTX or PDF.',
    );
  if (bytes.length > MAX_DECK_BYTES) throw new Error('Choose a deck smaller than 32 MiB.');
  signal.throwIfAborted();
  const zip = await new Promise<ZipFile>((resolve, reject) =>
    fromBuffer(bytes, { lazyEntries: true, validateEntrySizes: true }, (error, result) =>
      error || !result ? reject(new Error('The PPTX archive could not be read.')) : resolve(result),
    ),
  );
  const media = new Map<string, Buffer>();
  const references = new Map<string, number[]>();
  const names = new Set<string>();
  const relationshipTargets: string[] = [];
  const presentationTargets = new Map<string, string>();
  let presentationXml = '';
  let total = 0;
  const abort = () => zip.close();
  signal.addEventListener('abort', abort, { once: true });
  try {
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => {
        zip.close();
        reject(error instanceof Error ? error : new Error('Invalid PPTX archive.'));
      };
      zip.on('error', () => fail(new Error('The PPTX archive is damaged.')));
      zip.on('close', () => {
        if (signal.aborted) reject(new Error('Deck processing was cancelled.'));
      });
      zip.on('end', resolve);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          signal.throwIfAborted();
          const name = entry.fileName;
          if (
            names.has(name) ||
            names.size >= 5000 ||
            /(^|\/)\.\.?(\/|$)|[:\\]/.test(name) ||
            hasControl(name) ||
            name.startsWith('/')
          )
            throw new Error('The PPTX archive has unsafe or excessive entries.');
          names.add(name);
          if ((entry.generalPurposeBitFlag & 1) !== 0)
            throw new Error('This deck is encrypted. Export an unprotected copy.');
          if (
            entry.uncompressedSize > 16 * 1024 * 1024 ||
            entry.uncompressedSize > Math.max(1024 * 1024, entry.compressedSize * 100) ||
            total + entry.uncompressedSize > LIMIT
          )
            throw new Error('The PPTX exceeds the safe archive expansion limit.');
          if (
            /vba|activex|embeddings|oleobject|externalLinks/i.test(name) ||
            (/\.(exe|dll|js|vbs|bin|wmf|emf|svg|mp4|mp3|mov)$/i.test(name) &&
              !/^ppt\/printerSettings\/printerSettings\d+\.bin$/.test(name))
          )
            throw new Error(
              'The PPTX contains active content or unsupported media. Export a static PDF instead.',
            );
          if (name.endsWith('/')) {
            zip.readEntry();
            return;
          }
          const xml = /\.(xml|rels)$/i.test(name);
          const imagePart = /^ppt\/media\//i.test(name);
          if (imagePart && !/\.(png|jpe?g|webp|gif)$/i.test(name))
            throw new Error('The PPTX contains unsupported media. Export a static PDF instead.');
          if (xml && entry.uncompressedSize > XML_LIMIT)
            throw new Error('A PPTX XML part exceeds 2 MiB. Export a smaller PDF.');
          const chunks: Buffer[] = [];
          let actual = 0;
          let crc = -1;
          const stream = await new Promise<NodeJS.ReadableStream>((resolveStream, rejectStream) =>
            zip.openReadStream(entry, (error, result) =>
              error || !result
                ? rejectStream(new Error('A PPTX entry could not be read.'))
                : resolveStream(result),
            ),
          );
          for await (const chunk of stream) {
            signal.throwIfAborted();
            const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            actual += data.length;
            total += data.length;
            crc = updateCrc(crc, data);
            if (actual > entry.uncompressedSize || total > LIMIT)
              throw new Error('The PPTX exceeds its declared archive size.');
            if (xml || imagePart) chunks.push(data);
          }
          if (actual !== entry.uncompressedSize)
            throw new Error('A PPTX archive entry is truncated.');
          if ((crc ^ -1) >>> 0 !== entry.crc32)
            throw new Error('A PPTX archive entry failed its integrity check.');
          if (xml) {
            const text = Buffer.concat(chunks).toString('utf8');
            validateXml(text);
            if (name === 'ppt/presentation.xml') presentationXml = text;
            if (/macroEnabled|vbaProject|activeX|oleObject/i.test(text))
              throw new Error('The PPTX contains active content. Export a static PDF instead.');
            if (name.endsWith('.rels')) {
              const data: unknown = parser.parse(text);
              const root =
                typeof data === 'object' && data !== null && 'Relationships' in data
                  ? data.Relationships
                  : null;
              const rels =
                typeof root === 'object' && root !== null && 'Relationship' in root
                  ? root.Relationship
                  : [];
              for (const value of z.array(z.unknown()).parse(Array.isArray(rels) ? rels : [rels])) {
                const relation = z.record(z.string(), z.unknown()).parse(value);
                const target: unknown = relation['@_Target'];
                const mode: unknown = relation['@_TargetMode'];
                if (
                  mode === 'External' ||
                  typeof target !== 'string' ||
                  /[:\\]/.test(target) ||
                  target.startsWith('/')
                )
                  throw new Error(
                    'The PPTX contains external links or linked media. Export a self-contained PDF instead.',
                  );
                const ownerDirectory = posix.dirname(name).replace(/(^|\/)_rels$/, '');
                const resolved = posix.normalize(posix.join(ownerDirectory, target));
                if (
                  resolved.startsWith('../') ||
                  resolved === '..' ||
                  /[%?#]/.test(resolved) ||
                  hasControl(resolved)
                )
                  throw new Error(
                    'The PPTX has an unsafe internal reference. Export a static PDF.',
                  );
                relationshipTargets.push(resolved);
                if (
                  name === 'ppt/_rels/presentation.xml.rels' &&
                  typeof relation['@_Id'] === 'string'
                )
                  presentationTargets.set(relation['@_Id'], resolved);
                const slide = /^ppt\/slides\/_rels\/slide(\d+)\.xml\.rels$/.exec(name)?.[1];
                if (slide && /\/image$/.test(String(relation['@_Type']))) {
                  const asset = posix.normalize(posix.join('ppt/slides', target));
                  references.set(asset, [...(references.get(asset) ?? []), Number(slide)]);
                }
              }
            }
          } else if (imagePart) {
            const imageBytes = Buffer.concat(chunks);
            let dimensions;
            try {
              dimensions = imageSize(imageBytes);
            } catch {
              throw new Error('A PPTX image has invalid dimensions. Export a new PDF.');
            }
            if (
              !['png', 'jpg', 'webp', 'gif'].includes(dimensions.type ?? '') ||
              dimensions.width <= 0 ||
              dimensions.height <= 0 ||
              dimensions.width > 16000 ||
              dimensions.height > 16000 ||
              dimensions.width * dimensions.height > 16_000_000
            )
              throw new Error(
                'A PPTX image exceeds the safe dimension limit. Export a lower-resolution PDF.',
              );
            if (/\.png$/i.test(name) && imageBytes.length <= 1024 * 1024 && media.size < 100)
              media.set(name, imageBytes);
          }
          zip.readEntry();
        })().catch(fail);
      });
      zip.readEntry();
    });
    if (!names.has('ppt/presentation.xml') || !names.has('[Content_Types].xml'))
      throw new Error('This file is not a PPTX presentation.');
    if (relationshipTargets.some((target) => !names.has(target)))
      throw new Error('The PPTX has a missing or unsupported linked part. Export a static PDF.');
    // Slide part names need not follow presentation order. Only map evidence
    // where the actual presentation order is available; otherwise offer no logos.
    const slideOrder = [...presentationXml.matchAll(/<p:sldId\b[^>]*\br:id="([^"]+)"/g)].map(
      (match) => presentationTargets.get(match[1] ?? ''),
    );
    const ordered = new Map<string, number[]>();
    for (const [asset, parts] of references) {
      const positions = parts
        .map((part) => slideOrder.indexOf(`ppt/slides/slide${part}.xml`) + 1)
        .filter((position) => position > 0);
      if (positions.length > 0) ordered.set(asset, positions);
    }
    return { media, references: ordered };
  } finally {
    signal.removeEventListener('abort', abort);
    zip.close();
  }
}

/** Only whole, bounded, decoded PNGs. Candidate selection is confirmed by the user. */
export function extractLogoCandidates(
  media: Map<string, Buffer>,
  references: Map<string, number[]>,
): PreparedDeck['logos'] {
  const candidates: PreparedDeck['logos'] = [];
  for (const [name, bytes] of media) {
    const slides = [...new Set(references.get(name) ?? [])].filter(
      (value) => value >= 1 && value <= 200,
    );
    if (
      slides.length < 2 ||
      bytes.length < 24 ||
      !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
    )
      continue;
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (width < 16 || height < 16 || width > 2000 || height > 2000 || width * height > 1_000_000)
      continue;
    const decoded = nativeImage.createFromBuffer(bytes);
    if (decoded.isEmpty()) continue;
    const image = decoded.resize({ width: Math.min(width, 600) }).toPNG();
    if (image.length > 1024 * 1024) continue;
    candidates.push({
      id: `logo-${randomBytes(16).toString('hex')}`,
      slides,
      image: {
        name: 'Extracted logo candidate.png',
        mediaType: 'image/png',
        data: image.toString('base64'),
      },
    });
    if (candidates.length === 8) break;
  }
  return candidates;
}

export async function convertPptx(
  bytes: Buffer,
  directory: string,
  signal: AbortSignal,
): Promise<Buffer> {
  const command = await findLibreOffice();
  if (!command)
    throw new Error(
      'PPTX previews require a local LibreOffice installation. Install LibreOffice in its standard location, or export the deck to PDF and select that file.',
    );
  const profile = join(directory, 'office-profile');
  await mkdir(join(profile, 'user'), { recursive: true });
  await writeFile(
    join(profile, 'user/registrymodifications.xcu'),
    '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item><item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item></oor:items>',
  );
  await writeFile(join(directory, 'deck.pptx'), bytes, { flag: 'wx' });
  const budget = new AbortController();
  let measuring = false;
  const disappeared = (error: unknown): boolean =>
    typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
  const measure = async (path: string): Promise<number> => {
    let total = 0;
    const entries = await readdir(path, { withFileTypes: true }).catch((error: unknown) => {
      if (disappeared(error)) return [];
      throw error;
    });
    if (entries.length > 5000) return LIMIT + 1;
    for (const entry of entries) {
      if (entry.isSymbolicLink()) return LIMIT + 1;
      total += entry.isDirectory()
        ? await measure(join(path, entry.name))
        : await stat(join(path, entry.name))
            .then((details) => details.size)
            .catch((error: unknown) => {
              if (disappeared(error)) return 0;
              throw error;
            });
      if (total > LIMIT) break;
    }
    return total;
  };
  const monitor = setInterval(() => {
    if (measuring) return;
    measuring = true;
    void measure(directory)
      .then((size) => {
        if (size > LIMIT) budget.abort();
      })
      .catch(() => budget.abort())
      .finally(() => {
        measuring = false;
      });
  }, 200);
  const environment = buildCliChildEnvironment(process.env);
  for (const key of [
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
    'XAI_API_KEY',
    'CODEX_HOME',
    'GROK_HOME',
  ])
    delete environment[key];
  let result;
  try {
    result = await runProcess({
      executable: { command, prefixArguments: [] },
      arguments: [
        `-env:UserInstallation=${pathToFileURL(profile).href}`,
        '--headless',
        '--nologo',
        '--nodefault',
        '--norestore',
        '--nolockcheck',
        '--convert-to',
        'pdf:impress_pdf_Export',
        '--outdir',
        directory,
        join(directory, 'deck.pptx'),
      ],
      input: '',
      workingDirectory: directory,
      signal: AbortSignal.any([signal, budget.signal, AbortSignal.timeout(60000)]),
      maxOutputBytes: 64 * 1024,
      env: { ...environment, TEMP: directory, TMP: directory, TMPDIR: directory },
    });
  } finally {
    clearInterval(monitor);
  }
  signal.throwIfAborted();
  if (budget.signal.aborted || (await measure(directory)) > LIMIT)
    throw new Error(
      'Local conversion exceeded the 128 MiB temporary-storage budget. Export a smaller PDF.',
    );
  if (result.aborted || result.exitCode !== 0 || result.startError || result.outputLimitExceeded)
    throw new Error(
      'LibreOffice could not convert this deck within 60 seconds. Export it to PDF and retry.',
    );
  const output = join(directory, 'deck.pdf');
  if ((await stat(output)).size > MAX_DECK_BYTES)
    throw new Error('The converted PDF exceeds 32 MiB. Export a smaller deck.');
  return readFile(output);
}
