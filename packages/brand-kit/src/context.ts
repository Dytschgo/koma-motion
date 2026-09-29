import type { AssetReference, BrandColours, BrandKit } from '@koma-motion/core';

/**
 * The Brand Kit as agents see it. It carries no image data and no filesystem
 * paths: a logo is only described by its asset id and display name.
 */
export interface BrandKitContext {
  readonly name: string;
  readonly colours: BrandColours;
  readonly typography: {
    readonly headingFont: string;
    readonly bodyFont: string;
  };
  readonly logo: { readonly assetId: string; readonly name: string } | null;
  readonly tone: string;
  readonly visualStyle: string;
  readonly iconStyle: string;
  readonly preferredImagery: string;
  readonly preferredTopics: readonly string[];
  readonly referenceNotes: string;
}

export function toBrandKitContext(
  brandKit: BrandKit,
  assets: readonly AssetReference[],
): BrandKitContext {
  const logoAsset = assets.find((asset) => asset.id === brandKit.logoAssetId);
  return {
    name: brandKit.name,
    colours: { ...brandKit.colours },
    typography: { ...brandKit.typography },
    logo: logoAsset?.embeddedData != null ? { assetId: logoAsset.id, name: logoAsset.name } : null,
    tone: brandKit.tone,
    visualStyle: brandKit.visualStyle,
    iconStyle: brandKit.iconStyle,
    preferredImagery: brandKit.preferredImagery,
    preferredTopics: [...brandKit.preferredTopics],
    referenceNotes: brandKit.referenceNotes,
  };
}
