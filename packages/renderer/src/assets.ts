import { IMAGE_MEDIA_TYPES, type AssetReference } from '@koma-motion/core';

export type ResolvedAsset =
  | { readonly status: 'available'; readonly url: string; readonly name: string }
  | { readonly status: 'missing'; readonly reason: string };

/** Looks up the image data of an asset by its id. */
export type AssetResolver = (assetId: string) => ResolvedAsset;

const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/;

/**
 * Creates the only way in which the renderer loads images: from the bytes
 * stored in the project, as a `data:` URL of an allowed image type. The
 * renderer never loads images from paths or from the network.
 */
export function createAssetResolver(assets: readonly AssetReference[]): AssetResolver {
  const resolved = new Map<string, ResolvedAsset>();
  for (const asset of assets) {
    if (asset.embeddedData === null) {
      resolved.set(asset.id, {
        status: 'missing',
        reason: `The image data of "${asset.name}" is not stored in this project.`,
      });
    } else if (
      !IMAGE_MEDIA_TYPES.includes(asset.mediaType) ||
      !BASE64_PATTERN.test(asset.embeddedData.data)
    ) {
      resolved.set(asset.id, {
        status: 'missing',
        reason: `"${asset.name}" is not a supported image.`,
      });
    } else {
      resolved.set(asset.id, {
        status: 'available',
        url: `data:${asset.mediaType};base64,${asset.embeddedData.data}`,
        name: asset.name,
      });
    }
  }
  return (assetId) =>
    resolved.get(assetId) ?? {
      status: 'missing',
      reason: `The asset "${assetId}" is not part of this project.`,
    };
}
