/**
 * Document commands: the changes a person can make to a project. They are
 * pure functions over the core model. Structural Koma commands reconnect
 * transitions; visual element commands expose endpoints and leave stored motion alone.
 */
import { applyBrandKitToProject, type BrandKitLogoData } from '@koma-motion/brand-kit';
import {
  appendGenerationHistory,
  clearBrandLogo,
  assetReferenceSchema,
  getCanvasSize,
  flattenElements,
  komaElementSchema,
  komaProjectSchema,
  MAX_ELEMENTS_PER_KOMA,
  MAX_PROJECT_ASSETS,
  createKoma,
  duplicateKoma,
  findKoma,
  insertKoma,
  moveKoma,
  removeElement,
  removeKoma,
  replaceElement,
  setBrandLogo,
  systemInstructionsSchema,
  updateKomaDetails,
  updateTransitionSettings,
  type AgentConfiguration,
  type AssetReference,
  type BrandKit,
  type GenerationHistoryEntry,
  type IdGenerator,
  type KomaDetailsPatch,
  type KomaElement,
  type KomaProject,
  type Presentation,
  type TransitionSettingsPatch,
} from '@koma-motion/core';
import {
  buildTransition,
  normaliseDuration,
  syncTransitions,
  type TransitionSuggestion,
} from '@koma-motion/motion-engine';
import { restackElements, type StackMove } from '../lib/layers';

export type ProjectCommand = ((project: KomaProject, idGenerator: IdGenerator) => KomaProject) & {
  /** Visual endpoints for PR 3. These commands do not regenerate stored motion. */
  readonly affectedKomaIds?: readonly string[];
};

function visualCommand(komaId: string, command: ProjectCommand): ProjectCommand {
  return Object.assign(command, { affectedKomaIds: [komaId] });
}

/** Changes the Komas and recomputes transitions when their visual content may change. */
function changeKomas(
  update: (presentation: Presentation) => Presentation,
  affectsMotion = true,
): ProjectCommand {
  return (project, idGenerator) => {
    const updated = update(project.presentation);
    if (updated === project.presentation) {
      return project;
    }
    return {
      ...project,
      presentation: affectsMotion
        ? syncTransitions(updated, idGenerator, project.presentation).presentation
        : updated,
    };
  };
}

export const renameProject =
  (name: string): ProjectCommand =>
  (project) => ({ ...project, name });

export const changeBrandKit =
  (brandKit: BrandKit): ProjectCommand =>
  (project) =>
    project.brandKit === brandKit ? project : { ...project, brandKit };

export const changeSystemInstructions = (instructions: string): ProjectCommand => {
  const systemInstructions = systemInstructionsSchema.parse(instructions);
  return (project) =>
    project.systemInstructions === systemInstructions
      ? project
      : { ...project, systemInstructions };
};

export const changeLogo =
  (asset: AssetReference | null): ProjectCommand =>
  (project) =>
    asset === null ? clearBrandLogo(project) : setBrandLogo(project, asset);

/**
 * Switches the project to a saved Brand Kit. Its logo becomes an asset of the
 * project, or reuses an asset with the same image bytes.
 */
export const applySavedBrandKit =
  (brandKit: BrandKit, logo: BrandKitLogoData | null): ProjectCommand =>
  (project, idGenerator) =>
    applyBrandKitToProject(project, brandKit, logo, idGenerator);

export const changeAgentConfiguration =
  (agentConfiguration: AgentConfiguration): ProjectCommand =>
  (project) => ({ ...project, agentConfiguration });

export const changeKomaDetails = (komaId: string, patch: KomaDetailsPatch): ProjectCommand =>
  // Titles, purpose and notes do not enter the element diff or stored motion.
  changeKomas(
    (presentation) => updateKomaDetails(presentation, komaId, patch),
    patch.background !== undefined,
  );

export const changeElement = (komaId: string, element: KomaElement): ProjectCommand =>
  visualCommand(komaId, (project) => {
    const original = findKoma(project.presentation, komaId)?.elements.find(
      (item) => item.id === element.id,
    );
    if (!original || original.type !== element.type) return project;
    const next = komaElementSchema.parse({
      ...element,
      id: original.id,
      persistentId: original.persistentId,
    });
    if (JSON.stringify(komaElementSchema.parse(original)) === JSON.stringify(next)) return project;
    return { ...project, presentation: replaceElement(project.presentation, komaId, next) };
  });

/** Import/replacement and its bytes are one atomic undo step. Shared assets survive replacement. */
export const importImage = (
  komaId: string,
  asset: AssetReference,
  elementId?: string,
): ProjectCommand =>
  visualCommand(komaId, (project, ids) => {
    const koma = findKoma(project.presentation, komaId);
    if (!koma) return project;
    const original = koma.elements.find((element) => element.id === elementId);
    if (elementId !== undefined && (!original || original.type !== 'image' || original.locked))
      return project;
    if (!original && koma.elements.length >= MAX_ELEMENTS_PER_KOMA)
      throw new Error('This Koma has reached its element limit.');
    assetReferenceSchema.parse(asset);
    if (asset.embeddedData === null) throw new Error('The image has no embedded content.');
    const canvas = getCanvasSize(project.presentation.aspectRatio);
    const element: KomaElement =
      original?.type === 'image'
        ? { ...original, content: { ...original.content, assetId: asset.id } }
        : {
            id: ids.next('element'),
            persistentId: ids.next('object'),
            type: 'image',
            name: asset.name.slice(0, 120),
            position: { x: canvas.width / 4, y: canvas.height / 4 },
            size: { width: canvas.width / 2, height: canvas.height / 2 },
            rotation: 0,
            opacity: 1,
            zIndex: Math.min(10000, Math.max(0, ...koma.elements.map((item) => item.zIndex)) + 1),
            locked: false,
            visible: true,
            content: { assetId: asset.id, altText: '' },
            style: { fit: 'contain', cornerRadius: 0 },
          };
    const presentation = original
      ? replaceElement(project.presentation, komaId, element)
      : {
          ...project.presentation,
          komas: project.presentation.komas.map((item) =>
            item.id === komaId ? { ...item, elements: [...item.elements, element] } : item,
          ),
        };
    const previousAsset = original?.type === 'image' ? original.content.assetId : null;
    const stillUsed =
      project.brandKit.logoAssetId === previousAsset ||
      presentation.komas.some((item) =>
        flattenElements(item.elements).some(
          (item) => item.type === 'image' && item.content.assetId === previousAsset,
        ),
      );
    const assets = [
      ...project.assets.filter(
        (item) => item.id !== asset.id && (item.id !== previousAsset || stillUsed),
      ),
      asset,
    ];
    if (assets.length > MAX_PROJECT_ASSETS)
      throw new Error('This project has reached its image limit.');
    return { ...project, presentation, assets };
  });

/** Moves an element in the stacking order of its Koma. Stored motion is left alone, as for other visual edits. */
export const restackElement = (
  komaId: string,
  elementId: string,
  move: StackMove,
): ProjectCommand =>
  visualCommand(komaId, (project) => {
    const koma = findKoma(project.presentation, komaId);
    if (!koma) return project;
    const elements = restackElements(koma.elements, elementId, move);
    if (elements === koma.elements) return project;
    return {
      ...project,
      presentation: {
        ...project.presentation,
        komas: project.presentation.komas.map((item) =>
          item.id === komaId ? { ...item, elements: [...elements] } : item,
        ),
      },
    };
  });

export const deleteElement = (komaId: string, elementId: string): ProjectCommand =>
  changeKomas((presentation) => removeElement(presentation, komaId, elementId));

/**
 * Adds a Koma after `afterKomaId`. The new Koma is the next state of that
 * Koma: a copy in which every object keeps its persistent identity. Without
 * a Koma to continue from, an empty Koma is added at the end.
 */
export const addKoma =
  (afterKomaId: string | null): ProjectCommand =>
  (project, idGenerator) =>
    changeKomas((presentation) => {
      const source = afterKomaId === null ? undefined : findKoma(presentation, afterKomaId);
      const title = `Koma ${String(presentation.komas.length + 1)}`;
      const koma =
        source === undefined
          ? createKoma({
              idGenerator,
              title,
              backgroundColour: project.brandKit.colours.background,
            })
          : duplicateKoma(source, idGenerator, title);
      return insertKoma(presentation, koma, source?.id ?? null);
    })(project, idGenerator);

export const deleteKoma = (komaId: string): ProjectCommand =>
  changeKomas((presentation) => removeKoma(presentation, komaId));

export const reorderKoma = (komaId: string, offset: number): ProjectCommand =>
  changeKomas((presentation) => moveKoma(presentation, komaId, offset));

export const changeTransition =
  (transitionId: string, patch: TransitionSettingsPatch): ProjectCommand =>
  (project) => ({
    ...project,
    presentation: updateTransitionSettings(project.presentation, transitionId, {
      ...patch,
      ...(patch.duration === undefined ? {} : { duration: normaliseDuration(patch.duration) }),
    }),
  });

/**
 * Rebuilds one transition from its Komas as they are now, with regenerated
 * settings. Nothing else changes: not the Komas, not the other transitions.
 * A transition whose Komas are no longer neighbours, or cannot be compared,
 * is left as it is.
 */
export const regenerateTransitionMotion =
  (transitionId: string, settings: TransitionSuggestion): ProjectCommand =>
  (project) => {
    const { presentation } = project;
    const index = presentation.transitions.findIndex((item) => item.id === transitionId);
    const transition = presentation.transitions[index];
    if (transition === undefined) return project;
    const fromIndex = presentation.komas.findIndex((koma) => koma.id === transition.fromKomaId);
    const from = presentation.komas[fromIndex];
    const to = presentation.komas[fromIndex + 1];
    if (from === undefined || to?.id !== transition.toKomaId) return project;
    const built = buildTransition({ id: transition.id, from, to, suggestion: settings });
    if (!built.ok) return project;
    const transitions = [...presentation.transitions];
    transitions[index] = built.value.transition;
    return { ...project, presentation: { ...presentation, transitions } };
  };

/**
 * Works out the element motion of a transition again from its two Komas, for
 * motion that no longer matches them. Duration, strategy, easing and
 * rationale are kept. A pair that cannot be diffed is left unchanged.
 */
export const recalculateTransition =
  (transitionId: string): ProjectCommand =>
  (project) => {
    const presentation = rebuildTransition(project.presentation, transitionId);
    return presentation === null ? project : { ...project, presentation };
  };

/** Whether `recalculateTransition` would change the stored motion. */
export function canRecalculateTransition(
  presentation: Presentation,
  transitionId: string,
): boolean {
  return rebuildTransition(presentation, transitionId) !== null;
}

function rebuildTransition(presentation: Presentation, transitionId: string): Presentation | null {
  const existing = presentation.transitions.find((item) => item.id === transitionId);
  const fromIndex = presentation.komas.findIndex((koma) => koma.id === existing?.fromKomaId);
  const from = presentation.komas[fromIndex];
  const to = presentation.komas[fromIndex + 1];
  if (existing === undefined || from === undefined || to?.id !== existing.toKomaId) {
    return null;
  }
  const built = buildTransition({ id: existing.id, from, to, suggestion: existing });
  if (
    !built.ok ||
    JSON.stringify(built.value.transition.elementTransitions) ===
      JSON.stringify(existing.elementTransitions)
  ) {
    return null;
  }
  return {
    ...presentation,
    transitions: presentation.transitions.map((item) =>
      item === existing ? built.value.transition : item,
    ),
  };
}

/** Replaces the presentation with a generated one and records the generation. */
export const applyGeneration =
  (
    presentation: Presentation,
    entry: GenerationHistoryEntry,
    assets: readonly AssetReference[] = [],
  ): ProjectCommand =>
  (project) =>
    assets.length === 0
      ? appendGenerationHistory({ ...project, presentation }, entry)
      : komaProjectSchema.parse(
          appendGenerationHistory(
            { ...project, presentation, assets: [...project.assets, ...assets] },
            entry,
          ),
        );

export const recordGeneration =
  (entry: GenerationHistoryEntry): ProjectCommand =>
  (project) =>
    appendGenerationHistory(project, entry);
