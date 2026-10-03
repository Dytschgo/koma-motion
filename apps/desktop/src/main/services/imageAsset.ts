import { detectImageType, validateImageBytes } from './imageValidation';
export { detectImageType } from './imageValidation';
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
  if (!validateImageBytes(bytes, mediaType)) {
    return err(
      'The image data is damaged, incomplete or exceeds the image dimensions limit. Choose another image.',
    );
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
