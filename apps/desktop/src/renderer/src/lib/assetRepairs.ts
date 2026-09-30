import {
  collectProjectWarnings,
  flattenElements,
  type AssetReference,
  type KomaProject,
  type KomaElement,
  type LeafElement,
  type ProjectWarning,
} from '@koma-motion/core';
import { serialiseProject } from '@koma-motion/project-format';
import { changeLogo, type ProjectCommand } from '../state/commands';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { invoke } from './api';

export type RepairResult = {
  readonly status: 'fixed' | 'failed' | 'cancelled';
  readonly message: string;
};

export function repairIsLocked(project: KomaProject, warning: ProjectWarning): boolean {
  if (warning.target.kind !== 'image') return false;
  const { komaId, elementId } = warning.target;
  const koma = project.presentation.komas.find((item) => item.id === komaId);
  return (
    koma?.elements.some(
      (element) =>
        (element.id === elementId && element.locked) ||
        (element.type === 'group' &&
          element.content.children.some((child) => child.id === elementId) &&
          (element.locked ||
            element.content.children.some((child) => child.id === elementId && child.locked))),
    ) ?? false
  );
}

/** A targeted change, including children in groups. Shared assets and stored motion survive. */
export function repairAssetCommand(
  warning: ProjectWarning,
  replacement: AssetReference | null,
): ProjectCommand {
  return (project, ids) => {
    const current = collectProjectWarnings(project).find((item) => item.id === warning.id);
    if (!current || current.target.assetId !== warning.target.assetId)
      throw new Error('This item changed while the repair was open. Review it and try again.');
    if (replacement?.embeddedData === null) throw new Error('The replacement has no image data.');
    if (repairIsLocked(project, current))
      throw new Error('Unlock this image or its group before repairing it.');
    const target = current.target;
    if (target.kind === 'logo') return changeLogo(replacement)(project, ids);
    if (target.kind === 'asset') {
      if (replacement !== null) throw new Error('Choose a repair on the affected image.');
      return { ...project, assets: project.assets.filter((asset) => asset.id !== target.assetId) };
    }
    const presentation = {
      ...project.presentation,
      komas: project.presentation.komas.map((koma) =>
        koma.id !== target.komaId
          ? koma
          : {
              ...koma,
              elements: koma.elements.flatMap<KomaElement>((element) => {
                if (element.id === target.elementId && element.type === 'image') {
                  return replacement === null
                    ? []
                    : [{ ...element, content: { ...element.content, assetId: replacement.id } }];
                }
                if (element.type !== 'group') return [element];
                return [
                  {
                    ...element,
                    content: {
                      ...element.content,
                      children: element.content.children.flatMap<LeafElement>((child) =>
                        child.id !== target.elementId || child.type !== 'image'
                          ? [child]
                          : replacement === null
                            ? []
                            : [
                                {
                                  ...child,
                                  content: { ...child.content, assetId: replacement.id },
                                },
                              ],
                      ),
                    },
                  },
                ];
              }),
            },
      ),
    };
    const stillUsed =
      project.brandKit.logoAssetId === target.assetId ||
      presentation.komas.some((koma) =>
        flattenElements(koma.elements).some(
          (element) => element.type === 'image' && element.content.assetId === target.assetId,
        ),
      );
    return {
      ...project,
      presentation,
      assets: [
        ...project.assets.filter(
          (asset) => (asset.id !== target.assetId || stillUsed) && asset.id !== replacement?.id,
        ),
        ...(replacement === null ? [] : [replacement]),
      ],
    };
  };
}

/** Only the trusted native picker supplies replacement bytes. No path enters the document. */
export async function repairAsset(
  warning: ProjectWarning,
  action: 'replace' | 'remove',
): Promise<RepairResult> {
  const { sessionId } = useProjectStore.getState();
  const cancelled = {
    status: 'cancelled' as const,
    message: 'Repair cancelled. The issue is unchanged.',
  };
  try {
    let replacement: AssetReference | null = null;
    if (action === 'replace') {
      const response = await invoke(
        warning.target.kind === 'logo' ? 'koma:brand-kit:select-logo' : 'koma:project:select-image',
        {},
      );
      if (response.status === 'cancelled') return cancelled;
      if (response.status === 'failed') return { status: 'failed', message: response.message };
      replacement = response.asset;
    } else {
      const confirmed = await useUiStore.getState().confirm({
        title: warning.target.kind === 'logo' ? 'Clear logo?' : 'Remove image?',
        message: `${warning.message} ${warning.target.kind === 'image' ? 'This removes only this object from its Koma.' : 'This clears the unavailable image reference.'} You can undo this change.`,
        confirmLabel: warning.target.kind === 'logo' ? 'Clear logo' : 'Remove image',
        cancelLabel: 'Keep image',
        destructive: true,
      });
      if (!confirmed) return cancelled;
    }
    if (useProjectStore.getState().sessionId !== sessionId) return cancelled;
    const command = repairAssetCommand(warning, replacement);
    useProjectStore.getState().apply((project, ids) => {
      const next = command(project, ids);
      const validated = serialiseProject(next);
      if (!validated.ok) throw new Error(validated.error.message);
      return next;
    });
    const next = selectProject(useProjectStore.getState());
    if (next === null || collectProjectWarnings(next).some((item) => item.id === warning.id))
      throw new Error('The issue is still present. Review the item and try again.');
    return {
      status: 'fixed',
      message: `${action === 'replace' ? (warning.target.kind === 'logo' ? 'Logo replaced' : 'Image replaced') : warning.target.kind === 'logo' ? 'Logo cleared' : 'Image removed'}. You can undo this change. Save to keep it.`,
    };
  } catch (error) {
    return {
      status: 'failed',
      message:
        error instanceof Error ? error.message : 'The repair could not be completed. Try again.',
    };
  }
}
