import { flattenElements } from './schema/koma';
import type { KomaProject } from './schema/project';

export type ProjectWarningCode = 'missingAsset' | 'assetDataUnavailable' | 'missingLogoAsset';

export interface ProjectWarning {
  readonly code: ProjectWarningCode;
  readonly message: string;
}

/**
 * Reports problems that do not make a project invalid but that the user
 * should know about, such as images whose asset is missing.
 */
export function collectProjectWarnings(project: KomaProject): ProjectWarning[] {
  const warnings: ProjectWarning[] = [];
  const assets = new Map(project.assets.map((asset) => [asset.id, asset]));

  for (const asset of project.assets) {
    if (asset.embeddedData === null) {
      warnings.push({
        code: 'assetDataUnavailable',
        message: `The image data of asset "${asset.name}" is not stored in this project. It is shown as a placeholder.`,
      });
    }
  }

  const logoAssetId = project.brandKit.logoAssetId;
  if (logoAssetId !== null && !assets.has(logoAssetId)) {
    warnings.push({
      code: 'missingLogoAsset',
      message: `The Brand Kit logo refers to asset "${logoAssetId}", which is not part of this project.`,
    });
  }

  project.presentation.komas.forEach((koma, index) => {
    for (const element of flattenElements(koma.elements)) {
      if (element.type === 'image' && !assets.has(element.content.assetId)) {
        warnings.push({
          code: 'missingAsset',
          message: `Koma ${String(index + 1)}: image "${element.name}" refers to asset "${element.content.assetId}", which is not part of this project. It is shown as a placeholder.`,
        });
      }
    }
  });

  return warnings;
}
