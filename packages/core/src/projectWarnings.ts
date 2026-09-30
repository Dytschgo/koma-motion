import { flattenElements } from './schema/koma';
import type { KomaProject } from './schema/project';

export type ProjectWarningCode = 'missingAsset' | 'assetDataUnavailable' | 'missingLogoAsset';

export interface ProjectWarning {
  readonly id: string;
  readonly code: ProjectWarningCode;
  readonly message: string;
  readonly target:
    | {
        readonly kind: 'image';
        readonly komaId: string;
        readonly elementId: string;
        readonly assetId: string;
      }
    | { readonly kind: 'logo'; readonly assetId: string }
    | { readonly kind: 'asset'; readonly assetId: string };
}

/**
 * Reports problems that do not make a project invalid but that the user
 * should know about, such as images whose asset is missing.
 */
export function collectProjectWarnings(project: KomaProject): ProjectWarning[] {
  const warnings: ProjectWarning[] = [];
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));

  const used = new Set<string>();

  const logoAssetId = project.brandKit.logoAssetId;
  if (logoAssetId !== null) used.add(logoAssetId);
  if (logoAssetId !== null && assets.get(logoAssetId)?.embeddedData == null) {
    warnings.push({
      id: 'logo',
      code: 'missingLogoAsset',
      message: `The Brand Kit logo image is unavailable (asset "${logoAssetId}").`,
      target: { kind: 'logo', assetId: logoAssetId },
    });
  }

  project.presentation.komas.forEach((koma, index) => {
    for (const element of flattenElements(koma.elements)) {
      if (element.type !== 'image') continue;
      const assetId = element.content.assetId;
      used.add(assetId);
      if (assets.get(assetId)?.embeddedData == null) {
        warnings.push({
          id: `image:${koma.id}:${element.id}`,
          code: assets.has(assetId) ? 'assetDataUnavailable' : 'missingAsset',
          message: `Koma ${String(index + 1)}: image "${element.name}" is unavailable (asset "${assetId}"). It is shown as a placeholder.`,
          target: { kind: 'image', komaId: koma.id, elementId: element.id, assetId },
        });
      }
    }
  });

  for (const asset of project.assets) {
    if (asset.embeddedData === null && !used.has(asset.id))
      warnings.push({
        id: `asset:${asset.id}`,
        code: 'assetDataUnavailable',
        message: `Unused image "${asset.name}" has no image data stored in this project.`,
        target: { kind: 'asset', assetId: asset.id },
      });
  }

  return warnings;
}
