import { getCanvasSize, type KomaProject } from '@koma-motion/core';
import { komaToFrame } from '@koma-motion/motion-engine';
import { createAssetResolver, KomaStage, useElementSize } from '@koma-motion/renderer';
import type { ReactElement } from 'react';
import { acceptScopedProposal, discardScopedProposal } from '../lib/agentActions';
import { useAgentStore } from '../state/agentStore';
import { scopedProposalIssue } from '../state/scopedGeneration';
import { Button } from './ui';

export function ScopedProposal({
  project,
  sessionId,
}: {
  readonly project: KomaProject;
  readonly sessionId: number;
}): ReactElement | null {
  const proposal = useAgentStore((state) => state.scopedProposal);
  const [previewRef, previewSize] = useElementSize<HTMLDivElement>();
  if (proposal === null) return null;
  const issue = scopedProposalIssue(proposal, project, sessionId);
  const size = getCanvasSize(project.presentation.aspectRatio);
  const number = project.presentation.komas.findIndex((koma) => koma.id === proposal.target.id) + 1;
  return (
    <section
      aria-label="Selected Koma proposal"
      className="mx-3 my-3 rounded-panel border border-accent/40 bg-surface-2 p-3"
    >
      <h3 className="text-sm font-semibold text-ink-100">
        Proposal for Koma {number || 'removed'}: {proposal.target.title}
      </h3>
      <p className="mt-1 text-xs text-ink-300">
        Review the proposed content. Apply changes only this Koma. Its saved hold time and other
        Komas stay as they are. Neighboring motion may need repair.
      </p>
      <div
        ref={previewRef}
        className="my-3 overflow-hidden rounded-control"
        style={{ aspectRatio: `${size.width}/${size.height}` }}
      >
        <KomaStage
          frame={komaToFrame(proposal.proposed)}
          canvasSize={size}
          scale={previewSize.width / size.width}
          resolveAsset={createAssetResolver([...project.assets, ...proposal.assets])}
          label="Proposed Koma preview"
        />
      </div>
      <p className="text-sm text-ink-100">{proposal.proposed.title}</p>
      {proposal.warnings.map((warning, index) => (
        <p key={index} className="mt-1 text-xs text-signal-warn">
          {warning}
        </p>
      ))}
      {issue && (
        <p role="alert" className="my-2 text-sm text-signal-warn">
          {issue}
        </p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button type="button" disabled={issue !== null} onClick={acceptScopedProposal}>
          Apply proposal
        </Button>
        <Button type="button" onClick={discardScopedProposal}>
          Discard proposal
        </Button>
      </div>
    </section>
  );
}
