import {
  brandColoursSchema,
  fontFamilySchema,
  idSchema,
  type AssetReference,
  type BrandKit,
} from '@koma-motion/core';
import { z } from 'zod';

/**
 * The Brand Kit as agents see it. It carries no image data and no filesystem
 * paths: a logo is only described by its asset id and display name.
 */
export const brandKitContextSchema = z.object({
  name: z.string().max(120),
  colours: brandColoursSchema,
  typography: z.object({
    headingFont: fontFamilySchema,
    bodyFont: fontFamilySchema,
  }),
  logo: z
    .object({
      assetId: idSchema,
      name: z.string().max(260),
    })
    .nullable(),
  tone: z.string().max(1000),
  visualStyle: z.string().max(1000),
  iconStyle: z.string().max(1000),
  preferredImagery: z.string().max(1000),
  preferredTopics: z.array(z.string().max(120)).max(30),
  referenceNotes: z.string().max(5000),
});

export type BrandKitContext = z.infer<typeof brandKitContextSchema>;

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
