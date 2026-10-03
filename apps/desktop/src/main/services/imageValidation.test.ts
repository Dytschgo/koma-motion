import { deflateSync } from 'node:zlib';
import {
  MAX_EMBEDDED_ASSET_BYTES,
  createSeededIdGenerator,
  type AssetReference,
} from '@koma-motion/core';
import { describe, expect, it } from 'vitest';
import { createImageAsset } from './imageAsset';
import { unavailableImageAssetIds, validateImageBytes } from './imageValidation';

const VALID_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aD1sAAAAASUVORK5CYII=';
const CORRUPT_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9WlK3Y4AAAAASUVORK5CYII=';
const asset = (data: string): AssetReference => ({
  id: 'photo',
  type: 'image',
  name: 'photo.png',
  projectPath: 'assets/photo.png',
  mediaType: 'image/png',
  metadata: {},
  embeddedData: { encoding: 'base64', data },
});

describe('trusted image validation', () => {
  it('rejects the corrupt PNG stream on both project open and image import without changing bytes', () => {
    const corrupt = asset(CORRUPT_PNG);
    expect(unavailableImageAssetIds([corrupt])).toEqual(['photo']);
    expect(corrupt.embeddedData?.data).toBe(CORRUPT_PNG);
    const imported = createImageAsset({
      bytes: Buffer.from(CORRUPT_PNG, 'base64'),
      fileName: 'corrupt.png',
      idGenerator: createSeededIdGenerator('images'),
    });
    expect(imported.ok).toBe(false);
    expect(unavailableImageAssetIds([asset(VALID_PNG)])).toEqual([]);
  });

  it.each([
    '',
    'abc',
    'ab==',
    VALID_PNG + '=',
    VALID_PNG.slice(0, -4),
    Buffer.from('not an image').toString('base64'),
  ])('rejects malformed, noncanonical or truncated data: %s', (data) => {
    expect(unavailableImageAssetIds([asset(data)])).toEqual(['photo']);
  });

  it('rejects mismatched types and overlarge dimensions before decompression', () => {
    expect(unavailableImageAssetIds([{ ...asset(VALID_PNG), mediaType: 'image/jpeg' }])).toEqual([
      'photo',
    ]);
    const huge = Buffer.from(VALID_PNG, 'base64');
    huge.writeUInt32BE(10000, 16);
    huge.writeUInt32BE(10000, 20);
    expect(validateImageBytes(huge, 'image/png')).toBe(false);
    expect(validateImageBytes(Buffer.alloc(MAX_EMBEDDED_ASSET_BYTES + 1), 'image/png')).toBe(false);
  });

  it('bounds inflated PNG data even when compressed input and dimensions are small', () => {
    const png = Buffer.from(VALID_PNG, 'base64');
    const compressed = deflateSync(Buffer.alloc(64 * 1024 * 1024 + 1));
    const length = Buffer.alloc(4);
    length.writeUInt32BE(compressed.length);
    const bomb = Buffer.concat([
      png.subarray(0, 33),
      length,
      Buffer.from('IDAT'),
      compressed,
      Buffer.alloc(4),
      png.subarray(-12),
    ]);
    expect(bomb.length).toBeLessThan(MAX_EMBEDDED_ASSET_BYTES);
    expect(validateImageBytes(bomb, 'image/png')).toBe(false);
  });

  it('accepts supported PNG, JPEG, GIF and WebP fixtures', () => {
    expect(validateImageBytes(Buffer.from(VALID_PNG, 'base64'), 'image/png')).toBe(true);
    const jpeg = Buffer.from(
      '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDi6KKK+ZP3E//Z',
      'base64',
    );
    expect(validateImageBytes(jpeg, 'image/jpeg')).toBe(true);
    expect(validateImageBytes(jpeg.subarray(0, -2), 'image/jpeg')).toBe(false);
    expect(
      validateImageBytes(
        Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
        'image/gif',
      ),
    ).toBe(true);
    expect(
      validateImageBytes(
        Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64'),
        'image/webp',
      ),
    ).toBe(true);
  });
});
