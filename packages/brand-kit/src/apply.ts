import {
  clearBrandLogo,
  setBrandLogo,
  type AssetReference,
  type BrandKit,
  type IdGenerator,
  type KomaProject,
} from '@koma-motion/core';
import {
  IMAGE_EXTENSION_BY_MEDIA_TYPE,
  sameBrandKitSettings,
  type BrandKitLogoData,
} from './library';

/** The image bytes of the project's logo, or null when it has none or its data is missing. */
export function getProjectLogoData(project: KomaProject): BrandKitLogoData | null {
  const asset = project.assets.find((candidate) => candidate.id === project.brandKit.logoAssetId);
  if (asset?.embeddedData == null || asset.embeddedData.data === '') {
    return null;
  }
  return { name: asset.name, mediaType: asset.mediaType, data: asset.embeddedData.data };
}

/** An image asset of the project with exactly these bytes, preferring the current logo. */
export function findMatchingImageAsset(
  project: KomaProject,
  logo: BrandKitLogoData,
): AssetReference | undefined {
  const matches = project.assets.filter(
    (asset) => asset.mediaType === logo.mediaType && asset.embeddedData?.data === logo.data,
  );
  return matches.find((asset) => asset.id === project.brandKit.logoAssetId) ?? matches[0];
}

/**
 * Makes `brandKit` the Brand Kit of the project, with `logo` as its logo.
 *
 * An asset with the same image bytes is reused, otherwise the logo becomes a
 * new asset of the project. The previous logo is removed unless an image on a
 * Koma still uses it, the same rule as replacing the logo in the editor.
 * Returns the project unchanged when nothing would change. Throws when the
 * project already holds the largest number of images.
 */
export function applyBrandKitToProject(
  project: KomaProject,
  brandKit: BrandKit,
  logo: BrandKitLogoData | null,
  idGenerator: IdGenerator,
): KomaProject {
  let updated: KomaProject;
  if (logo === null) {
    updated = project.brandKit.logoAssetId === null ? project : clearBrandLogo(project);
  } else {
    const existing = findMatchingImageAsset(project, logo);
    if (existing !== undefined && existing.id === project.brandKit.logoAssetId) {
      updated = project;
    } else if (existing !== undefined) {
      updated = setBrandLogo(project, existing);
    } else {
      const id = idGenerator.next('asset');
      updated = setBrandLogo(project, {
        id,
        type: 'image',
        name: logo.name,
        mediaType: logo.mediaType,
        projectPath: `assets/${id}.${IMAGE_EXTENSION_BY_MEDIA_TYPE[logo.mediaType]}`,
        metadata: { byteLength: Math.floor((logo.data.replace(/=+$/, '').length * 3) / 4) },
        embeddedData: { encoding: 'base64', data: logo.data },
      });
    }
  }

  if (updated === project && sameBrandKitSettings(project.brandKit, brandKit)) {
    return project;
  }
  return {
    ...updated,
    brandKit: { ...brandKit, logoAssetId: updated.brandKit.logoAssetId },
  };
}
