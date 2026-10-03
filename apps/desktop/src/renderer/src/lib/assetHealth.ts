import { collectProjectWarnings, type KomaProject, type ProjectWarning } from '@koma-motion/core';
import { createAssetResolver } from '@koma-motion/renderer';

/** Reuse targeted repair identities without changing or dropping the stored bytes. */
export function collectAssetWarnings(project: KomaProject): ProjectWarning[] {
  const resolve = createAssetResolver(project.assets);
  return collectProjectWarnings({
    ...project,
    assets: project.assets.map((asset) =>
      resolve(asset.id).status === 'missing' ? { ...asset, embeddedData: null } : asset,
    ),
  }).map((warning) => {
    const original = project.assets.find((asset) => asset.id === warning.target.assetId);
    return original?.embeddedData == null
      ? warning
      : {
          ...warning,
          message:
            warning.message.replace(
              'has no image data stored',
              'has unreadable image data stored',
            ) + ' The stored bytes are kept until you choose a repair.',
        };
  });
}
