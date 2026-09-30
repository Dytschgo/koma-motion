import type { Koma } from '@koma-motion/core';
import { useId, useState, type ReactElement } from 'react';
import { cancelTransitionRegeneration, regenerateTransition } from '../lib/transitionActions';
import type { TransitionAssessment } from '../lib/transitionIssues';
import { useProjectStore } from '../state/projectStore';
import {
  selectRunningRegeneration,
  useTransitionRegenerationStore,
} from '../state/transitionRegenerationStore';
import { useUiStore } from '../state/uiStore';
import { ChevronIcon, RefreshIcon, WarningIcon } from './icons';
import { Button } from './ui';

/**
 * The one place that explains a transition that cannot play, and offers what
 * helps. It sits between the canvas and the preview controls, so it never
 * covers the Koma, and it stays until the transition can play again.
 */
export function TransitionIssuePanel({
  transitionId,
  from,
  to,
  fromNumber,
  assessment,
}: {
  readonly transitionId: string;
  readonly from: Koma;
  readonly to: Koma;
  readonly fromNumber: number;
  readonly assessment: TransitionAssessment;
}): ReactElement {
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const sessionId = useProjectStore((state) => state.sessionId);
  const selectKoma = useUiStore((state) => state.selectKoma);
  const setView = useUiStore((state) => state.setView);
  const entry = useTransitionRegenerationStore((state) => {
    const found = state.entries[transitionId];
    return found?.sessionId === sessionId ? found : null;
  });
  const otherRunning = useTransitionRegenerationStore((state) => {
    const running = selectRunningRegeneration(state, sessionId);
    return running !== null && running.transitionId !== transitionId;
  });
  const running = entry?.status === 'running' ? entry : null;
  const ended = entry !== null && entry.status !== 'running' ? entry : null;
  const [endedSummary = '', ...endedDetails] = ended?.message.split('\n') ?? [];

  const open = (koma: Koma): void => {
    setView('canvas');
    selectKoma(koma.id);
  };

  const tone = assessment.blocked ? 'text-signal-warn' : 'text-ink-300';
  const headingId = `${id}-heading`;
  const detailsId = `${id}-details`;

  return (
    <section
      aria-labelledby={headingId}
      aria-describedby={`${id}-reason`}
      className={`flex-none border-t bg-desk-800 px-3 py-2 ${
        assessment.blocked ? 'border-signal-warn/50' : 'border-desk-600'
      }`}
    >
      <div className="flex items-start gap-2">
        <span aria-hidden="true" className={`mt-0.5 flex-none ${tone}`}>
          <WarningIcon size={16} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className={`font-semibold ${tone}`}>
            <span className="sr-only">
              {assessment.blocked ? 'Warning: ' : 'Note: '}
              Transition {fromNumber} to {fromNumber + 1}.{' '}
            </span>
            {assessment.headline}
          </h2>
          <p id={`${id}-reason`} className="text-sm text-ink-300">
            {assessment.reason} {assessment.remedyText}
          </p>

          {/* Present from the start, so that changes are announced. */}
          <p role="status" aria-live="polite" className="text-sm empty:hidden">
            {running !== null && (
              <span className="text-ink-100">
                {running.cancelRequested
                  ? 'Stopping the regeneration'
                  : `Regenerating with ${running.providerName}: ${running.progress}`}
              </span>
            )}
            {ended !== null && (
              <span className="text-pencil-red">
                {ended.status === 'failed' ? `Regeneration failed. ${endedSummary}` : endedSummary}{' '}
                The transition still cannot play.
              </span>
            )}
          </p>

          <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
            {assessment.remedy === 'regenerate' &&
              (running === null ? (
                <Button
                  variant="primary"
                  compact
                  icon={<RefreshIcon size={14} />}
                  disabled={otherRunning}
                  title={
                    otherRunning
                      ? 'Another transition is being regenerated. Wait until it finishes.'
                      : undefined
                  }
                  onClick={() => void regenerateTransition(transitionId)}
                >
                  {ended === null ? 'Regenerate transition' : 'Retry regeneration'}
                </Button>
              ) : (
                <Button
                  variant="outline"
                  compact
                  disabled={running.cancelRequested}
                  onClick={() => void cancelTransitionRegeneration()}
                >
                  Cancel regeneration
                </Button>
              ))}
            {assessment.blocked && (
              <>
                <Button
                  variant="outline"
                  compact
                  className="max-w-full min-w-0"
                  onClick={() => {
                    open(from);
                  }}
                >
                  <span className="truncate">Open source Koma “{from.title}”</span>
                </Button>
                <Button
                  variant="outline"
                  compact
                  className="max-w-full min-w-0"
                  onClick={() => {
                    open(to);
                  }}
                >
                  <span className="truncate">Open destination Koma “{to.title}”</span>
                </Button>
              </>
            )}
            <Button
              compact
              aria-expanded={expanded}
              aria-controls={detailsId}
              icon={<ChevronIcon size={12} direction={expanded ? 'up' : 'down'} />}
              onClick={() => {
                setExpanded(!expanded);
              }}
            >
              Details
            </Button>
          </div>

          <div id={detailsId} hidden={!expanded} className="mt-1.5">
            <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto text-sm">
              {assessment.details.map((detail, index) => (
                <li key={index} className="text-ink-300">
                  <span className="text-ink-100">{detail.message}</span> {detail.remedyText}
                </li>
              ))}
              {endedDetails.length > 0 && (
                <li className="whitespace-pre-line text-ink-300">{endedDetails.join('\n')}</li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
