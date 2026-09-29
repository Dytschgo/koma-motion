import {
  err,
  MAX_EMBEDDED_ASSET_BYTES,
  ok,
  type AssetReference,
  type IdGenerator,
  type ImageMediaType,
  type Result,
} from '@koma-motion/core';

const EXTENSIONS: Readonly<Record<ImageMediaType, string>> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

export const IMAGE_FILE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'gif'] as const;

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  return signature.every((value, index) => bytes[offset + index] === value);
}

/**
 * Recognises the image type from the content of the file. File names and
 * extensions are not trusted.
 */
export function detectImageType(bytes: Uint8Array): ImageMediaType | null {
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) {
    return 'image/png';
  }
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) {
    return 'image/jpeg';
  }
  if (startsWith(bytes, [0x47, 0x49, 0x46, 0x38])) {
    return 'image/gif';
  }
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return 'image/webp';
  }
  return null;
}

/** Whether a character is a control character or is not allowed in file names. */
export function isUnsafeCharacter(character: string): boolean {
  const code = character.codePointAt(0) ?? 0;
  return code < 0x20 || code === 0x7f || '<>:"/\\|?*'.includes(character);
}

/** Reduces a file name to characters that are safe to display and store. */
export function toDisplayName(fileName: string): string {
  const cleaned = [...fileName]
    .filter((character) => !isUnsafeCharacter(character))
    .join('')
    .trim()
    .slice(0, 120);
  return cleaned === '' ? 'image' : cleaned;
}

/**
 * Turns the bytes of an image into an asset that is stored inside the
 * project. The original location of the file is not recorded.
 */
export function createImageAsset(options: {
  readonly bytes: Uint8Array;
  readonly fileName: string;
  readonly idGenerator: IdGenerator;
}): Result<AssetReference, string> {
  const { bytes } = options;
  if (bytes.byteLength === 0) {
    return err('The selected file is empty.');
  }
  if (bytes.byteLength > MAX_EMBEDDED_ASSET_BYTES) {
    const megabytes = MAX_EMBEDDED_ASSET_BYTES / (1024 * 1024);
    return err(`The image is larger than ${String(megabytes)} MB. Choose a smaller image.`);
  }
  const mediaType = detectImageType(bytes);
  if (mediaType === null) {
    return err('The selected file is not a PNG, JPEG, WebP or GIF image.');
  }
  const id = options.idGenerator.next('asset');
  return ok({
    id,
    type: 'image',
    name: toDisplayName(options.fileName),
    mediaType,
    projectPath: `assets/${id}.${EXTENSIONS[mediaType]}`,
    metadata: { byteLength: bytes.byteLength },
    embeddedData: { encoding: 'base64', data: Buffer.from(bytes).toString('base64') },
  });
}
