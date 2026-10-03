import { mergeSelectedKoma } from '@koma-motion/agent-runtime';
import {
  flattenElements,
  type Koma,
  type KomaProject,
  type AssetReference,
  type GenerationHistoryEntry,
} from '@koma-motion/core';
import type { ProjectCommand } from './commands';

export interface ScopedProposal {
  readonly sessionId: number;
  readonly target: Koma;
  readonly originalAssets: readonly AssetReference[];
  readonly proposed: Koma;
  readonly assets: readonly AssetReference[];
  readonly historyEntry: GenerationHistoryEntry;
  readonly providerName: string;
  readonly warnings: readonly string[];
  readonly invalidReason: string | null;
}

export function scopedSnapshotIssue(
  proposal: Pick<ScopedProposal, 'sessionId' | 'target' | 'originalAssets'>,
  project: KomaProject | null,
  sessionId: number,
  proposed: Koma = proposal.target,
): string | null {
  if (project === null || sessionId !== proposal.sessionId)
    return 'This proposal belongs to a previous project session. Generate again.';
  const current = project.presentation.komas.find((koma) => koma.id === proposal.target.id);
  if (!current || JSON.stringify(current) !== JSON.stringify(proposal.target))
    return 'The target Koma changed or was removed. Discard this proposal and generate again.';
  const relevant = new Set(
    [...flattenElements(proposal.target.elements), ...flattenElements(proposed.elements)].flatMap(
      (element) => (element.type === 'image' ? [element.content.assetId] : []),
    ),
  );
  for (const asset of proposal.originalAssets.filter((asset) => relevant.has(asset.id))) {
    if (
      JSON.stringify(project.assets.find((candidate) => candidate.id === asset.id)) !==
      JSON.stringify(asset)
    )
      return 'An image used by this proposal changed or was removed. Generate again with the current assets.';
  }
  return null;
}

export function scopedProposalIssue(
  proposal: ScopedProposal,
  project: KomaProject | null,
  sessionId: number,
): string | null {
  const freshness =
    proposal.invalidReason ?? scopedSnapshotIssue(proposal, project, sessionId, proposal.proposed);
  if (freshness) return freshness;
  if (project === null) return 'No project is open.';
  const ids = new Set(project.assets.map((asset) => asset.id));
  const paths = new Set(project.assets.map((asset) => asset.projectPath));
  for (const asset of proposal.assets) {
    if (ids.has(asset.id) || paths.has(asset.projectPath))
      return 'A proposed asset conflicts with the current project. Generate again.';
    ids.add(asset.id);
    paths.add(asset.projectPath);
  }
  const available = new Set(
    [...project.assets, ...proposal.assets]
      .filter((asset) => asset.embeddedData !== null)
      .map((asset) => asset.id),
  );
  if (
    flattenElements(proposal.proposed.elements).some(
      (element) => element.type === 'image' && !available.has(element.content.assetId),
    )
  )
    return 'A proposed image is no longer available. Generate again.';
  return null;
}

export function applyScopedProposal(proposal: ScopedProposal, sessionId: number): ProjectCommand {
  const command: ProjectCommand = (project, ids) => {
    const issue = scopedProposalIssue(proposal, project, sessionId);
    if (issue) throw new Error(issue);
    return mergeSelectedKoma(
      project,
      proposal.target.id,
      proposal.proposed,
      proposal.assets,
      proposal.historyEntry,
      ids,
    );
  };
  return Object.assign(command, { affectedKomaIds: [proposal.target.id] });
}
