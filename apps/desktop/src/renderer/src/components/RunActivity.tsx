/**
 * The activity of a generation in the chat: a pixel character that follows
 * the observed phases, the elapsed time, the streamed text and the run
 * monitor. Everything here reads the agent store; nothing starts a process
 * or a request.
 */
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { cancelGeneration } from '../lib/agentActions';
import { PIXEL_COLORS, SPRITE_ANIMATIONS, SPRITE_SIZE } from '../lib/pixelSprite';
import {
  ACTIVITY_LABELS,
  activityPhase,
  buildTimeline,
  formatElapsed,
  type ActivityPhase,
} from '../lib/runActivity';
import type { FinishedRun, RunningExecution } from '../state/agentStore';
import { Button, ModalFrame } from './ui';

type Run = RunningExecution | FinishedRun;

function isFinished(run: Run): run is FinishedRun {
  return 'finishedAt' in run;
}

/** Follows the reduced-motion setting of the system, also when it changes. */
export function useReducedMotion(): boolean {
  const query = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = (): void => setReduced(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

/** The current time, updated every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [active]);
  return now;
}

/**
 * The pixel character in one phase. With reduced motion it shows the still
 * pose of the phase; in forced colours it is hidden and the text remains.
 */
export function PixelSprite({
  phase,
  size = 48,
}: {
  readonly phase: ActivityPhase;
  readonly size?: number;
}): ReactElement {
  const reduced = useReducedMotion();
  const animation = SPRITE_ANIMATIONS[phase];
  const [frame, setFrame] = useState(0);
  const animate = !reduced && animation.frameMs > 0 && animation.frames.length > 1;

  useEffect(() => {
    setFrame(0);
    if (!animate) return;
    const timer = setInterval(
      () => setFrame((current) => (current + 1) % animation.frames.length),
      animation.frameMs,
    );
    return () => clearInterval(timer);
  }, [animate, animation]);

  const pixels = animation.frames[animate ? frame : 0] ?? [];
  return (
    <svg
      className="pixel-sprite flex-none"
      data-phase={phase}
      data-animated={animate ? '' : undefined}
      width={size}
      height={size}
      viewBox={`0 0 ${String(SPRITE_SIZE)} ${String(SPRITE_SIZE)}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {pixels.map(([x, y, color]) => (
        <rect
          key={`${String(x)}:${String(y)}`}
          x={x}
          y={y}
          width="1"
          height="1"
          fill={PIXEL_COLORS[color]}
        />
      ))}
    </svg>
  );
}

/**
 * A running run shows the phase of its latest status event. A finished run
 * shows how it ended: statuses such as "converting" can follow "succeeded".
 */
function phaseOf(run: Run): ActivityPhase {
  return isFinished(run) ? run.result : activityPhase(run.events);
}

const PHASE_TONES: Readonly<Record<ActivityPhase, string>> = {
  starting: 'text-ink-300',
  generating: 'text-accent',
  validating: 'text-accent',
  repairing: 'text-signal-warn',
  completed: 'text-signal-ok',
  failed: 'text-motion',
  cancelled: 'text-ink-300',
};

/** What the provider writes. Not a live region: screen readers hear the phase instead. */
function StreamedText({
  run,
  className = '',
}: {
  readonly run: Run;
  readonly className?: string;
}): ReactElement {
  const { output } = run;
  if (!run.streams) {
    return (
      <p className={`text-sm text-ink-400 ${className}`}>
        {run.providerName} reports its progress in steps and does not stream its text.
      </p>
    );
  }
  if (output.text === '') {
    return (
      <p className={`text-sm text-ink-400 ${className}`}>
        {isFinished(run)
          ? `${run.providerName} wrote no visible text.`
          : `Waiting for ${run.providerName} to write…`}
      </p>
    );
  }
  return (
    <div
      role="region"
      aria-label={`Output from ${run.providerName}`}
      className={`border-l-2 border-line-strong pl-3 ${className}`}
    >
      {output.attempt > 1 && <p className="eyebrow mb-1">Correction</p>}
      <p className="text-sm leading-relaxed whitespace-pre-wrap text-ink-100 select-text">
        {output.truncated && <span className="text-ink-400">… </span>}
        {output.text}
      </p>
    </div>
  );
}

/** The run in the chat: while it works, and its outcome until the next run. */
export function RunActivity({
  run,
  onOpenMonitor,
}: {
  readonly run: Run;
  readonly onOpenMonitor: () => void;
}): ReactElement {
  const finished = isFinished(run);
  const phase = phaseOf(run);
  const now = useNow(!finished);
  const elapsed = (finished ? run.finishedAt : now) - run.startedAt;
  const latest = run.events.at(-1);
  const message = !finished && run.cancelRequested ? 'Stopping' : (latest?.message ?? 'Starting');

  if (finished) {
    return (
      <div
        data-run-phase={phase}
        className="mt-5 flex items-center gap-3 rounded-card border border-line bg-surface-2/50 px-3 py-2"
      >
        <PixelSprite phase={phase} size={32} />
        <p className="min-w-0 flex-1 text-sm text-ink-300">
          <span className={`font-medium ${PHASE_TONES[phase]}`}>{ACTIVITY_LABELS[phase]}</span>{' '}
          after {formatElapsed(elapsed)} · {run.providerName}
        </p>
        <Button variant="quiet" compact onClick={onOpenMonitor}>
          Run details
        </Button>
      </div>
    );
  }

  return (
    <div
      data-run-phase={phase}
      className="mt-5 rounded-card border border-line bg-surface-2/70 px-3 py-3 wrap-break-word"
    >
      <div className="flex items-start gap-3">
        <div className="flex flex-col items-center gap-1">
          <PixelSprite phase={phase} />
          <span className="font-mono text-xs text-ink-400 tabular-nums" aria-hidden="true">
            {formatElapsed(elapsed)}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-ink-400">
            {run.providerName} · {run.modelLabel}
          </p>
          <div role="status">
            <p className={`font-semibold ${PHASE_TONES[phase]}`}>{ACTIVITY_LABELS[phase]}</p>
            <p className="text-ink-100">{message}</p>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Button variant="outline" compact onClick={onOpenMonitor}>
              Open run monitor
            </Button>
            {latest?.phase !== 'succeeded' && (
              <Button
                variant="outline"
                compact
                disabled={run.cancelRequested}
                onClick={() => void cancelGeneration()}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>
      <StreamedText run={run} className="mt-3 ml-[3.75rem]" />
    </div>
  );
}

/**
 * A larger live view of the same run. It reads what the chat reads; opening
 * it starts no process and no model request. Claude Code runs in print mode
 * without a saved session, so no terminal can attach to it.
 */
export function RunMonitor({
  run,
  open,
  onClose,
}: {
  readonly run: Run | null;
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactElement {
  const titleId = useId();
  const output = useRef<HTMLDivElement>(null);
  const following = useRef(true);
  const finished = run === null || isFinished(run);
  const now = useNow(open && !finished);
  const text = run?.output.text ?? '';

  useEffect(() => {
    if (open && following.current && output.current !== null) {
      output.current.scrollTop = output.current.scrollHeight;
    }
  }, [open, text]);

  const phase = run === null ? 'starting' : phaseOf(run);
  const elapsed = run === null ? 0 : (isFinished(run) ? run.finishedAt : now) - run.startedAt;
  const timeline = run === null ? [] : buildTimeline(run.events, run.startedAt);

  return (
    <ModalFrame
      open={open && run !== null}
      onClose={onClose}
      labelledBy={titleId}
      className="h-[min(640px,calc(100vh-2rem))] max-h-[calc(100vh-2rem)] w-[min(760px,calc(100vw-2rem))]"
    >
      {run !== null && (
        <div className="flex h-full min-h-0 flex-col" data-run-phase={phase}>
          <header className="flex items-start gap-4 border-b border-line px-6 pt-5 pb-4">
            <PixelSprite phase={phase} size={64} />
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-xl font-semibold tracking-tight">
                Run monitor
              </h2>
              <p className="mt-0.5 text-ink-300">
                {run.providerName} · {run.modelLabel}
              </p>
              <p className="mt-1 max-w-[62ch] text-sm text-ink-400">
                A live view inside Koma Motion of the run shown in the chat. It opens no second
                process and sends no second request. Claude Code runs in print mode without a saved
                session, so no terminal can attach to it.
              </p>
            </div>
          </header>

          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 border-b border-line px-6 py-3 sm:grid-cols-4">
            <div>
              <dt className="eyebrow">Phase</dt>
              <dd className={`font-medium ${PHASE_TONES[phase]}`}>{ACTIVITY_LABELS[phase]}</dd>
            </div>
            <div>
              <dt className="eyebrow">Elapsed</dt>
              <dd className="font-mono tabular-nums">{formatElapsed(elapsed)}</dd>
            </div>
            <div>
              <dt className="eyebrow">Attempt</dt>
              <dd>
                {run.events.some((event) => event.phase === 'repairing')
                  ? '2 of 2 (correction)'
                  : '1 of 2'}
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Run</dt>
              <dd className="truncate font-mono text-sm select-text" title={run.executionId}>
                {run.executionId.slice(-8)}
              </dd>
            </div>
          </dl>

          <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,15rem)_minmax(0,1fr)]">
            <section
              aria-label="Timeline"
              className="min-h-0 overflow-y-auto border-r border-line px-6 py-3"
            >
              <h3 className="eyebrow mb-2">Timeline</h3>
              <ol className="flex flex-col gap-2 text-sm">
                {timeline.map((entry, index) => (
                  <li key={index} className="flex gap-2">
                    <span className="flex-none font-mono text-xs text-ink-400 tabular-nums">
                      +{formatElapsed(entry.offset)}
                    </span>
                    <span className={PHASE_TONES[entry.phase]}>{entry.message}</span>
                  </li>
                ))}
              </ol>
            </section>
            <section aria-label="Output" className="flex min-h-0 flex-col px-6 py-3">
              <h3 className="eyebrow mb-2">Output</h3>
              <div
                ref={output}
                className="min-h-0 flex-1 overflow-y-auto rounded-control border border-line bg-surface-0 p-3"
                onScroll={(event) => {
                  const element = event.currentTarget;
                  following.current =
                    element.scrollHeight - element.scrollTop - element.clientHeight < 32;
                }}
              >
                <StreamedText run={run} />
              </div>
            </section>
          </div>

          <footer className="flex items-center justify-end gap-2 border-t border-line px-6 py-3">
            {!isFinished(run) && run.events.at(-1)?.phase !== 'succeeded' && (
              <Button
                variant="outline"
                disabled={run.cancelRequested}
                onClick={() => void cancelGeneration()}
              >
                {run.cancelRequested ? 'Stopping' : 'Cancel run'}
              </Button>
            )}
            <Button variant="primary" onClick={onClose}>
              Close
            </Button>
          </footer>
        </div>
      )}
    </ModalFrame>
  );
}
