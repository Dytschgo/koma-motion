import type { Koma } from '@koma-motion/core';
import { useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { cancelTransitionRegeneration, regenerateTransition } from '../lib/transitionActions';
import type { TransitionAssessment } from '../lib/transitionIssues';
import { useProjectStore } from '../state/projectStore';
import {
  selectRunningRegeneration,
  useTransitionRegenerationStore,
  type TransitionRegeneration,
} from '../state/transitionRegenerationStore';
import { useUiStore } from '../state/uiStore';
import { ChevronIcon, RefreshIcon, WarningIcon } from './icons';
import { Button } from './ui';

/**
 * Compact status for one transition, rendered in the Koma strip between its
 * source and destination. The action stays on that gap so it cannot be read
 * as belonging to either Koma card. The explanation opens in place.
 */
export function TransitionStripStatus({
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
  const rootRef = useRef<HTMLElement>(null);
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
  const statusText = describeRegeneration(running, ended);
  const phase = running !== null ? 'running' : ended !== null ? ended.status : 'ready';
  const phaseRef = useRef(phase);

  // Replacing the action unmounts the focused control. Put focus on the
  // control that replaced it, unless the person has already moved elsewhere.
  useLayoutEffect(() => {
    if (phaseRef.current === phase) {
      return;
    }
    const focusLost = document.activeElement === null || document.activeElement === document.body;
    phaseRef.current = phase;
    if (focusLost) {
      rootRef.current?.querySelector<HTMLButtonElement>('[data-transition-action]')?.focus();
    }
  }, [phase]);

  const open = (koma: Koma): void => {
    setView('canvas');
    selectKoma(koma.id);
  };

  const tone = assessment.blocked ? 'text-signal-warn' : 'text-ink-300';
  const detailsId = `${id}-details`;
  const endedDetails = ended?.message.split('\n').slice(1) ?? [];
  const between = `from “${from.title}” to “${to.title}”`;

  return (
    <section
      ref={rootRef}
      aria-label={`Transition ${String(fromNumber)} to ${String(fromNumber + 1)}. ${assessment.label}.`}
      aria-busy={running !== null}
      className="flex min-w-0 flex-col gap-1 py-0.5"
    >
      <div className="flex min-w-0 items-center gap-1">
        {running !== null ? (
          <span
            aria-hidden="true"
            className="working-dot size-1.5 flex-none rounded-full bg-motion"
          />
        ) : (
          <span aria-hidden="true" className={`flex-none ${tone}`}>
            <WarningIcon size={14} />
          </span>
        )}
        <p className={`min-w-0 flex-1 truncate text-sm font-semibold ${tone}`}>
          {assessment.label}
        </p>
        <Button
          compact
          className="flex-none"
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
      <p className="truncate text-xs text-ink-400">
        <span className="sr-only">From </span>
        {from.title}
        <span aria-hidden="true"> → </span>
        <span className="sr-only">to </span>
        {to.title}
      </p>

      {assessment.remedy === 'regenerate' &&
        (running === null ? (
          <Button
            variant="primary"
            compact
            data-transition-action=""
            icon={<RefreshIcon size={14} />}
            className="w-full whitespace-normal!"
            disabled={otherRunning}
            title={
              otherRunning
                ? 'Another transition is being regenerated. Wait until it finishes.'
                : undefined
            }
            aria-label={
              ended === null ? `Regenerate transition ${between}` : `Retry regeneration ${between}`
            }
            onClick={() => void regenerateTransition(transitionId)}
          >
            {ended === null ? 'Regenerate transition' : 'Retry regeneration'}
          </Button>
        ) : (
          <Button
            variant="outline"
            compact
            data-transition-action=""
            className="w-full whitespace-normal!"
            disabled={running.cancelRequested}
            aria-label={`Cancel regeneration ${between}`}
            onClick={() => void cancelTransitionRegeneration()}
          >
            Cancel regeneration
          </Button>
        ))}

      {/* Present from the start, so a change of state is announced. */}
      <p
        role="status"
        className={
          statusText === ''
            ? 'sr-only'
            : `text-sm ${running !== null ? 'text-ink-100' : 'text-motion'}`
        }
      >
        {statusText}
      </p>

      <div id={detailsId} hidden={!expanded} className="flex flex-col gap-1">
        <h2 className={`text-sm font-semibold ${tone}`}>{assessment.headline}</h2>
        <p className="text-sm text-ink-300">
          {assessment.reason} {assessment.remedyText}
        </p>
        {assessment.blocked && (
          <div className="flex flex-col gap-1">
            <Button
              variant="outline"
              compact
              className="w-full min-w-0 justify-start"
              onClick={() => {
                open(from);
              }}
            >
              <span className="min-w-0 truncate">Open source Koma “{from.title}”</span>
            </Button>
            <Button
              variant="outline"
              compact
              className="w-full min-w-0 justify-start"
              onClick={() => {
                open(to);
              }}
            >
              <span className="min-w-0 truncate">Open destination Koma “{to.title}”</span>
            </Button>
          </div>
        )}
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
    </section>
  );
}

function describeRegeneration(
  running: Extract<TransitionRegeneration, { status: 'running' }> | null,
  ended: Exclude<TransitionRegeneration, { status: 'running' }> | null,
): string {
  if (running !== null) {
    return running.cancelRequested
      ? 'Stopping the regeneration'
      : `Regenerating with ${running.providerName}: ${running.progress}`;
  }
  if (ended === null) {
    return '';
  }
  const summary = ended.message.split('\n')[0] ?? '';
  const lead = ended.status === 'failed' ? `Regeneration failed. ${summary}` : summary;
  return `${lead} The transition still cannot play.`;
}
