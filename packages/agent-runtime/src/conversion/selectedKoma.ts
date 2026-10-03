import {
  appendGenerationHistory,
  flattenElements,
  komaProjectSchema,
  komaSchema,
  type AssetReference,
  type GenerationHistoryEntry,
  type IdGenerator,
  type Koma,
  type KomaElement,
  type KomaProject,
} from '@koma-motion/core';

/** Pure atomic merge. Stored motion is deliberately left for explicit review/repair. */
export function mergeSelectedKoma(
  project: KomaProject,
  targetId: string,
  proposed: Koma,
  assets: readonly AssetReference[],
  entry: GenerationHistoryEntry,
  ids: IdGenerator,
  unavailableAssetIds: readonly string[] = [],
): KomaProject {
  const target = project.presentation.komas.find((koma) => koma.id === targetId);
  if (!target) throw new Error('The target Koma no longer exists. Generate a new proposal.');
  const replacement = komaSchema.parse(proposed);
  const oldElements = flattenElements(target.elements);
  const original = new Map(oldElements.map((element) => [element.persistentId, element]));
  const allElements = project.presentation.komas.flatMap((koma) => flattenElements(koma.elements));
  const used = new Set([
    ...project.presentation.komas.map((koma) => koma.id),
    ...project.presentation.transitions.map((transition) => transition.id),
    ...allElements.map((element) => element.id),
    ...project.assets.map((asset) => asset.id),
    ...project.generationHistory.map((history) => history.id),
  ]);
  const persistent = new Set(allElements.map((element) => element.persistentId));
  const unique = (prefix: string, taken: Set<string>): string => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      const id = ids.next(prefix);
      if (!taken.has(id)) {
        taken.add(id);
        return id;
      }
    }
    throw new Error('Unique identifiers could not be allocated. Generate a new proposal.');
  };
  const reconcile = (element: KomaElement): KomaElement => {
    const old = original.get(element.persistentId);
    const continues = old?.type === element.type;
    const persistentId =
      continues || !persistent.has(element.persistentId)
        ? element.persistentId
        : unique('object', persistent);
    persistent.add(persistentId);
    const base = {
      ...element,
      persistentId,
      id: continues ? old.id : unique('element', used),
      locked: continues ? old.locked : element.locked,
      visible: continues ? old.visible : element.visible,
    };
    return base.type === 'group'
      ? {
          ...base,
          content: {
            ...base.content,
            children: base.content.children.map((child) => {
              const reconciled = reconcile(child);
              if (reconciled.type === 'group') throw new Error('Nested groups are not supported.');
              return reconciled;
            }),
          },
        }
      : base;
  };
  const assetIds = new Set(project.assets.map((asset) => asset.id));
  const paths = new Set(project.assets.map((asset) => asset.projectPath));
  for (const asset of assets) {
    if (used.has(asset.id) || assetIds.has(asset.id) || paths.has(asset.projectPath)) {
      throw new Error('A proposed asset conflicts with an existing project asset. Generate again.');
    }
    used.add(asset.id);
    assetIds.add(asset.id);
    paths.add(asset.projectPath);
  }
  const available = new Set(
    [...project.assets, ...assets]
      .filter((asset) => asset.embeddedData !== null && !unavailableAssetIds.includes(asset.id))
      .map((asset) => asset.id),
  );
  if (
    flattenElements(replacement.elements).some(
      (element) => element.type === 'image' && !available.has(element.content.assetId),
    )
  ) {
    throw new Error(
      'A proposed image is no longer available. Generate again with the current assets.',
    );
  }
  const updated = {
    ...target,
    title: replacement.title,
    purpose: replacement.purpose,
    speakerNotes: replacement.speakerNotes,
    background: replacement.background,
    elements: replacement.elements.map(reconcile),
  };
  const next = appendGenerationHistory(
    {
      ...project,
      presentation: {
        ...project.presentation,
        komas: project.presentation.komas.map((koma) => (koma.id === targetId ? updated : koma)),
      },
      assets: [...project.assets, ...assets],
    },
    entry,
  );
  // Validate whole-project bytes/identity/reference bounds without replacing unchanged objects.
  komaProjectSchema.parse(next);
  return next;
}
