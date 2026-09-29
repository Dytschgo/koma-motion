/**
 * Document commands: the changes a person can make to a project. They are
 * pure functions that combine the operations of the core model with the
 * motion engine, so transitions always match the Komas they connect.
 */
import {
  appendGenerationHistory,
  clearBrandLogo,
  createKoma,
  duplicateKoma,
  findKoma,
  insertKoma,
  moveKoma,
  removeElement,
  removeKoma,
  replaceElement,
  setBrandLogo,
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
import { normaliseDuration, syncTransitions } from '@koma-motion/motion-engine';

export type ProjectCommand = (project: KomaProject, idGenerator: IdGenerator) => KomaProject;

/** Changes the Komas and recomputes the transitions that are affected. */
function changeKomas(update: (presentation: Presentation) => Presentation): ProjectCommand {
  return (project, idGenerator) => {
    const updated = update(project.presentation);
    if (updated === project.presentation) {
      return project;
    }
    return { ...project, presentation: syncTransitions(updated, idGenerator).presentation };
  };
}

export const renameProject =
  (name: string): ProjectCommand =>
  (project) => ({ ...project, name });

export const changeBrandKit =
  (brandKit: BrandKit): ProjectCommand =>
  (project) =>
    project.brandKit === brandKit ? project : { ...project, brandKit };

export const changeLogo =
  (asset: AssetReference | null): ProjectCommand =>
  (project) =>
    asset === null ? clearBrandLogo(project) : setBrandLogo(project, asset);

export const changeAgentConfiguration =
  (agentConfiguration: AgentConfiguration): ProjectCommand =>
  (project) => ({ ...project, agentConfiguration });

export const changeKomaDetails = (komaId: string, patch: KomaDetailsPatch): ProjectCommand =>
  changeKomas((presentation) => updateKomaDetails(presentation, komaId, patch));

export const changeElement = (komaId: string, element: KomaElement): ProjectCommand =>
  changeKomas((presentation) => replaceElement(presentation, komaId, element));

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

/** Replaces the presentation with a generated one and records the generation. */
export const applyGeneration =
  (presentation: Presentation, entry: GenerationHistoryEntry): ProjectCommand =>
  (project) =>
    appendGenerationHistory({ ...project, presentation }, entry);

export const recordGeneration =
  (entry: GenerationHistoryEntry): ProjectCommand =>
  (project) =>
    appendGenerationHistory(project, entry);
