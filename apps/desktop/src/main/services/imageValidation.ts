import { inflateSync } from 'node:zlib';
import {
  MAX_EMBEDDED_ASSET_BYTES,
  type AssetReference,
  type ImageMediaType,
} from '@koma-motion/core';
import { imageSize } from 'image-size';

const MAX_IMAGE_PIXELS = 40_000_000;
const MAX_INFLATED_BYTES = 64 * 1024 * 1024;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/** Content signatures only; use validateImageBytes before accepting an image. */
export function detectImageType(bytes: Uint8Array): ImageMediaType | null {
  if (startsWith(bytes, [137, 80, 78, 71, 13, 10, 26, 10])) return 'image/png';
  if (startsWith(bytes, [255, 216, 255])) return 'image/jpeg';
  if (startsWith(bytes, [71, 73, 70, 56])) return 'image/gif';
  if (startsWith(bytes, [82, 73, 70, 70]) && startsWith(bytes, [87, 69, 66, 80], 8))
    return 'image/webp';
  return null;
}

/** Mirrors the exporter's bounded PNG stream check without decoding pixels in main. */
function validPngData(bytes: Buffer): boolean {
  if (
    bytes.length < 33 ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString('ascii', 12, 16) !== 'IHDR'
  )
    return false;
  const chunks: Buffer[] = [];
  let offset = 8;
  let ended = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    if (length > bytes.length - offset - 12) return false;
    const type = bytes.toString('ascii', offset + 4, offset + 8);
    if (type === 'IDAT') chunks.push(bytes.subarray(offset + 8, offset + 8 + length));
    offset += length + 12;
    if (type === 'IEND') {
      if (length !== 0) return false;
      ended = true;
      break;
    }
  }
  if (!ended || chunks.length === 0 || offset !== bytes.length) return false;
  try {
    return inflateSync(Buffer.concat(chunks), { maxOutputLength: MAX_INFLATED_BYTES }).length > 0;
  } catch {
    return false;
  }
}

/** Bounded content validation at the trusted file boundary; not a full pixel decoder. */
export function validateImageBytes(bytes: Uint8Array, mediaType: ImageMediaType): boolean {
  if (
    bytes.length === 0 ||
    bytes.length > MAX_EMBEDDED_ASSET_BYTES ||
    detectImageType(bytes) !== mediaType
  )
    return false;
  const data = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  try {
    const { width, height } = imageSize(data);
    if (!width || !height || width * height > MAX_IMAGE_PIXELS) return false;
    switch (mediaType) {
      case 'image/png':
        return validPngData(data);
      case 'image/jpeg':
        return data.at(-2) === 255 && data.at(-1) === 217;
      case 'image/gif':
        return ['GIF87a', 'GIF89a'].includes(data.toString('ascii', 0, 6)) && data.at(-1) === 59;
      case 'image/webp':
        return data.length >= 20 && data.readUInt32LE(4) === data.length - 8;
    }
  } catch {
    return false;
  }
}

/** Invalid bytes stay in the document; only their availability crosses IPC. */
export function unavailableImageAssetIds(assets: readonly AssetReference[]): string[] {
  return assets
    .filter((asset) => {
      if (asset.embeddedData === null) return false;
      const data = asset.embeddedData.data;
      if (
        !data ||
        data.length > Math.ceil(MAX_EMBEDDED_ASSET_BYTES / 3) * 4 ||
        data.length % 4 !== 0
      )
        return true;
      const bytes = Buffer.from(data, 'base64');
      return bytes.toString('base64') !== data || !validateImageBytes(bytes, asset.mediaType);
    })
    .map((asset) => asset.id);
}
