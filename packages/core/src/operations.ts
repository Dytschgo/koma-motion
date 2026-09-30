/**
 * Pure document operations. Every function returns a new value and leaves its
 * input untouched, which keeps undo history and change detection simple.
 *
 * These operations do not recompute transitions. Callers combine them with
 * the motion engine (see `syncTransitions` in @koma-motion/motion-engine).
 */
import type { IdGenerator } from './ids';
import type { AssetReference } from './schema/asset';
import type { KomaElement } from './schema/element';
import { flattenElements, type Koma } from './schema/koma';
import { MAX_KOMAS, type Presentation } from './schema/presentation';
import {
  MAX_HISTORY_ENTRIES,
  MAX_PROJECT_ASSETS,
  type GenerationHistoryEntry,
  type KomaProject,
} from './schema/project';
import type { KomaTransition } from './schema/transition';

export type KomaDetailsPatch = Partial<
  Pick<Koma, 'title' | 'purpose' | 'speakerNotes' | 'background'>
>;

export type TransitionSettingsPatch = Partial<
  Pick<KomaTransition, 'duration' | 'easing' | 'strategy' | 'rationale'>
>;

export function findKoma(presentation: Presentation, komaId: string): Koma | undefined {
  return presentation.komas.find((koma) => koma.id === komaId);
}

export function findElement(koma: Koma, elementId: string): KomaElement | undefined {
  return koma.elements.find((element) => element.id === elementId);
}

function mapKoma(
  presentation: Presentation,
  komaId: string,
  update: (koma: Koma) => Koma,
): Presentation {
  return {
    ...presentation,
    komas: presentation.komas.map((koma) => (koma.id === komaId ? update(koma) : koma)),
  };
}

export function updateKomaDetails(
  presentation: Presentation,
  komaId: string,
  patch: KomaDetailsPatch,
): Presentation {
  return mapKoma(presentation, komaId, (koma) => ({ ...koma, ...patch }));
}

/** Replaces one element. The replacement must keep the identifier of the original. */
export function replaceElement(
  presentation: Presentation,
  komaId: string,
  replacement: KomaElement,
): Presentation {
  return mapKoma(presentation, komaId, (koma) => ({
    ...koma,
    elements: koma.elements.map((element) =>
      element.id === replacement.id ? replacement : element,
    ),
  }));
}

export function removeElement(
  presentation: Presentation,
  komaId: string,
  elementId: string,
): Presentation {
  return mapKoma(presentation, komaId, (koma) => ({
    ...koma,
    elements: koma.elements.filter((element) => element.id !== elementId),
  }));
}

function cloneElementWithNewIds(element: KomaElement, idGenerator: IdGenerator): KomaElement {
  if (element.type === 'group') {
    return {
      ...element,
      id: idGenerator.next('element'),
      content: {
        ...element.content,
        children: element.content.children.map((child) => ({
          ...child,
          id: idGenerator.next('element'),
        })),
      },
    };
  }
  return { ...element, id: idGenerator.next('element') };
}

/**
 * Creates the next visual state of an existing Koma: a copy in which every
 * element keeps its `persistentId`, so the objects stay the same objects.
 */
export function duplicateKoma(source: Koma, idGenerator: IdGenerator, title: string): Koma {
  return {
    ...source,
    id: idGenerator.next('koma'),
    title,
    elements: source.elements.map((element) => cloneElementWithNewIds(element, idGenerator)),
  };
}

/** Inserts `koma` after the Koma with id `afterKomaId`, or at the end when it is `null`. */
export function insertKoma(
  presentation: Presentation,
  koma: Koma,
  afterKomaId: string | null,
): Presentation {
  if (presentation.komas.length >= MAX_KOMAS) {
    return presentation;
  }
  const index = presentation.komas.findIndex((candidate) => candidate.id === afterKomaId);
  const position = index === -1 ? presentation.komas.length : index + 1;
  return {
    ...presentation,
    komas: [...presentation.komas.slice(0, position), koma, ...presentation.komas.slice(position)],
  };
}

export function removeKoma(presentation: Presentation, komaId: string): Presentation {
  return {
    ...presentation,
    komas: presentation.komas.filter((koma) => koma.id !== komaId),
    transitions: presentation.transitions.filter(
      (transition) => transition.fromKomaId !== komaId && transition.toKomaId !== komaId,
    ),
  };
}

/** Moves a Koma by `offset` positions (negative is earlier). Out-of-range moves are clamped. */
export function moveKoma(presentation: Presentation, komaId: string, offset: number): Presentation {
  const from = presentation.komas.findIndex((koma) => koma.id === komaId);
  const moved = presentation.komas[from];
  if (moved === undefined) {
    return presentation;
  }
  const to = Math.min(presentation.komas.length - 1, Math.max(0, from + offset));
  if (to === from) {
    return presentation;
  }
  const remaining = presentation.komas.filter((koma) => koma.id !== komaId);
  return {
    ...presentation,
    komas: [...remaining.slice(0, to), moved, ...remaining.slice(to)],
  };
}

export function updateTransitionSettings(
  presentation: Presentation,
  transitionId: string,
  patch: TransitionSettingsPatch,
): Presentation {
  return {
    ...presentation,
    transitions: presentation.transitions.map((transition) =>
      transition.id === transitionId ? { ...transition, ...patch } : transition,
    ),
  };
}

/** Finds the transition that leads from one Koma to another. */
export function findTransitionBetween(
  presentation: Presentation,
  fromKomaId: string,
  toKomaId: string,
): KomaTransition | undefined {
  return presentation.transitions.find(
    (transition) => transition.fromKomaId === fromKomaId && transition.toKomaId === toKomaId,
  );
}

export function appendGenerationHistory(
  project: KomaProject,
  entry: GenerationHistoryEntry,
): KomaProject {
  return {
    ...project,
    generationHistory: [...project.generationHistory, entry].slice(-MAX_HISTORY_ENTRIES),
  };
}

function isAssetUsedByImage(project: KomaProject, assetId: string | null): boolean {
  return (
    assetId !== null &&
    project.presentation.komas.some((koma) =>
      flattenElements(koma.elements).some(
        (element) => element.type === 'image' && element.content.assetId === assetId,
      ),
    )
  );
}

/** Stores `asset` as the brand logo and removes the old logo unless an image still uses it. */
export function setBrandLogo(project: KomaProject, asset: AssetReference): KomaProject {
  const previousLogoId = project.brandKit.logoAssetId;
  const keepPreviousLogo = isAssetUsedByImage(project, previousLogoId);
  const assets = [
    ...project.assets.filter(
      (candidate) =>
        candidate.id !== asset.id && (candidate.id !== previousLogoId || keepPreviousLogo),
    ),
    asset,
  ];
  if (assets.length > MAX_PROJECT_ASSETS) {
    throw new Error(
      `A project can contain up to ${String(MAX_PROJECT_ASSETS)} images. Remove an unused image before adding a new logo.`,
    );
  }
  return {
    ...project,
    assets,
    brandKit: { ...project.brandKit, logoAssetId: asset.id },
  };
}

export function clearBrandLogo(project: KomaProject): KomaProject {
  const previousLogoId = project.brandKit.logoAssetId;
  const keepPreviousLogo = isAssetUsedByImage(project, previousLogoId);
  return {
    ...project,
    assets: project.assets.filter(
      (candidate) => candidate.id !== previousLogoId || keepPreviousLogo,
    ),
    brandKit: { ...project.brandKit, logoAssetId: null },
  };
}
