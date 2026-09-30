import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it, vi } from 'vitest';
import { extractLogoCandidates, inspectPptx } from './deckPptx';

const image = vi.hoisted(() => ({
  isEmpty: vi.fn(() => false),
  resize: vi.fn(),
  toPNG: vi.fn(() => Buffer.from('sanitized png')),
}));
vi.mock('electron', () => ({
  nativeImage: {
    createFromBuffer: vi.fn(() => {
      image.resize.mockReturnValue(image);
      return image;
    }),
  },
}));

/** Minimal ZIP writer for adversarial archive fixtures; no filesystem extraction. */
function zip(entries: Record<string, string | Buffer>, flags = 0): Buffer {
  const local: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, input] of Object.entries(entries)) {
    const data = Buffer.isBuffer(input) ? input : Buffer.from(input);
    const compressed = deflateRawSync(data);
    const filename = Buffer.from(name);
    let crc = -1;
    for (const byte of data) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    crc = (crc ^ -1) >>> 0;
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(flags, 6);
    header.writeUInt16LE(8, 8);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(compressed.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(filename.length, 26);
    local.push(header, filename, compressed);
    const record = Buffer.alloc(46);
    record.writeUInt32LE(0x02014b50);
    record.writeUInt16LE(20, 4);
    record.writeUInt16LE(20, 6);
    record.writeUInt16LE(flags, 8);
    record.writeUInt16LE(8, 10);
    record.writeUInt32LE(crc, 16);
    record.writeUInt32LE(compressed.length, 20);
    record.writeUInt32LE(data.length, 24);
    record.writeUInt16LE(filename.length, 28);
    record.writeUInt32LE(offset, 42);
    central.push(record, filename);
    offset += header.length + filename.length + compressed.length;
  }
  const index = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(central.length / 2, 8);
  end.writeUInt16LE(central.length / 2, 10);
  end.writeUInt32LE(index.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...local, index, end]);
}
const base = {
  '[Content_Types].xml': '<Types/>',
  'ppt/presentation.xml': '<p:presentation xmlns:p="p"/>',
};
const signal = () => new AbortController().signal;
describe('PPTX safety preflight and logo extraction', () => {
  it('rejects excessive image dimensions before LibreOffice or a native decoder sees the image', async () => {
    const png = await readFile(resolve('apps/desktop/e2e/fixtures/decks/logo.png'));
    png.writeUInt32BE(100000, 16);
    await expect(
      inspectPptx(zip({ ...base, 'ppt/media/large.png': png }), signal()),
    ).rejects.toThrow('dimension limit');
  });
  it('reads a representative PPTX and finds a recurring whole logo', async () => {
    const bytes = await readFile(resolve('apps/desktop/e2e/fixtures/decks/northstar.pptx'));
    const result = await inspectPptx(bytes, signal());
    expect(result.media.size).toBe(1);
    expect(result.references.get('ppt/media/image1.png')).toEqual([1, 2, 3]);
    expect(extractLogoCandidates(result.media, result.references)).toMatchObject([
      { slides: [1, 2, 3], image: { mediaType: 'image/png' } },
    ]);
  });
  it.each([
    ['invalid archive', Buffer.from('not a zip archive')],
    ['encrypted', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])],
    ['archive encryption', zip(base, 1)],
    ['archive bomb', zip({ ...base, 'large.txt': Buffer.alloc(2 * 1024 * 1024) })],
    ['macros', zip({ ...base, 'ppt/vbaProject.bin': 'active' })],
    [
      'active content type',
      zip({
        ...base,
        '[Content_Types].xml': '<Types><Override ContentType="macroEnabled"/></Types>',
      }),
    ],
    ['unsafe path', zip({ ...base, '../outside.xml': '<x/>' })],
    [
      'entities',
      zip({
        ...base,
        'ppt/entity.xml': '<!DOCTYPE a [<!ENTITY b SYSTEM "file:///secret">]><a>&b;</a>',
      }),
    ],
    ['malformed XML', zip({ ...base, 'ppt/bad.xml': '<unclosed>' })],
    [
      'external relationships',
      zip({
        ...base,
        'ppt/_rels/presentation.xml.rels':
          '<Relationships><Relationship Target="https://example.com" TargetMode="External"/></Relationships>',
      }),
    ],
    [
      'internal traversal',
      zip({
        ...base,
        'ppt/_rels/presentation.xml.rels':
          '<Relationships><Relationship Target="../../../secret"/></Relationships>',
      }),
    ],
    ['XML depth', zip({ ...base, 'ppt/deep.xml': '<a>'.repeat(65) + '</a>'.repeat(65) })],
  ])('rejects %s without extracting files', async (_name, bytes) => {
    await expect(inspectPptx(bytes, signal())).rejects.toThrow();
  });
  it('rejects cancellation before reading', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(inspectPptx(zip(base), controller.signal)).rejects.toThrow();
  });
  it('rejects corrupt checksums', async () => {
    const bytes = zip(base);
    const index = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(0, index + 16);
    await expect(inspectPptx(bytes, signal())).rejects.toThrow('integrity');
  });
  it('leaves logo empty for oversized dimensions, invalid image data and non-recurring imagery', () => {
    const png = Buffer.alloc(24);
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(png);
    png.writeUInt32BE(100000, 16);
    png.writeUInt32BE(100000, 20);
    expect(extractLogoCandidates(new Map([['x', png]]), new Map([['x', [1, 2]]]))).toEqual([]);
    png.writeUInt32BE(100, 16);
    png.writeUInt32BE(100, 20);
    expect(extractLogoCandidates(new Map([['x', png]]), new Map([['x', [1]]]))).toEqual([]);
    image.isEmpty.mockReturnValueOnce(true);
    expect(extractLogoCandidates(new Map([['x', png]]), new Map([['x', [1, 2]]]))).toEqual([]);
    expect(extractLogoCandidates(new Map(), new Map())).toEqual([]);
  });
});
