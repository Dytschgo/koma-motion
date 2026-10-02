/**
 * Plays the whole presentation, Koma by Koma, like a slide show. It is a
 * separate mode from the preview of one transition: it covers the window,
 * cannot edit and ends with Escape.
 */
import { getCanvasSize, type KomaProject, type Presentation } from '@koma-motion/core';
import { komaToFrame } from '@koma-motion/motion-engine';
import {
  createAssetResolver,
  getFitScale,
  getPreviewFrame,
  KomaStage,
  useElementSize,
  usePrefersReducedMotion,
  useTransitionPlayback,
} from '@koma-motion/renderer';
import { useEffect, useId, useMemo, useRef, useState, type ReactElement } from 'react';
import { setPresentationFullScreen } from '../lib/presentationActions';
import {
  getPresentationStep,
  resolvePlayingStep,
  resolvePresenterKoma,
  reviewPresentation,
} from '../lib/presentationPlan';
import { formatSeconds } from '../lib/selectors';
import {
  MAX_AUTOPLAY_DELAY_MS,
  MIN_AUTOPLAY_DELAY_MS,
  usePresenterStore,
  type PresenterSession,
} from '../state/presenterStore';
import { selectProject, useProjectStore } from '../state/projectStore';
import {
  CloseIcon,
  NextIcon,
  PauseIcon,
  PlayIcon,
  PreviousIcon,
  RestartIcon,
  WarningIcon,
} from './icons';
import { Button, IconButton, Modal, NumberInput, POPOVER_SURFACE, Switch } from './ui';

/** With reduced motion a transition is a short cut, as in the preview. */
const REDUCED_MOTION_DURATION_MS = 400;
const STAGE_PADDING = 24;

/** Keys of the player, also listed for the presenter. */
export const PRESENTATION_SHORTCUTS: readonly (readonly [string, string])[] = [
  ['Right, Down, Page Down, Space, N', 'Next'],
  ['Left, Up, Page Up, Backspace, P', 'Previous'],
  ['Home, End', 'First or last Koma'],
  ['K', 'Pause or resume'],
  ['R', 'Replay the transition into this Koma'],
  ['A', 'Autoplay on or off'],
  ['F', 'Full screen on or off'],
  ['?', 'Show or hide these shortcuts'],
  ['Esc', 'Exit the presentation'],
];

function isTextEntry(target: EventTarget | null): boolean {
  return (
    (target instanceof HTMLInputElement && target.type !== 'checkbox') ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement
  );
}

/** The presentation, when one is open: first the review, then the player. */
export function PresentationMode(): ReactElement | null {
  const session = usePresenterStore((state) => state.session);
  const project = useProjectStore(selectProject);
  const presenting = session !== null;

  // The window gets back the full-screen state it had before the presentation.
  const wasPresenting = useRef(false);
  useEffect(() => {
    if (wasPresenting.current && !presenting) {
      void setPresentationFullScreen('restore');
    }
    wasPresenting.current = presenting;
  }, [presenting]);

  if (session === null || project === null) {
    return null;
  }
  return session.phase === 'review' ? (
    <PresentationReview presentation={project.presentation} session={session} />
  ) : (
    <PresentationPlayer project={project} session={session} />
  );
}

function PresentationReview({
  presentation,
  session,
}: {
  readonly presentation: Presentation;
  readonly session: PresenterSession;
}): ReactElement {
  const continueWithCuts = usePresenterStore((state) => state.continueWithCuts);
  const returnToEdit = usePresenterStore((state) => state.returnToEdit);
  const exit = usePresenterStore((state) => state.exit);
  // Live, so that what is accepted is exactly what is listed.
  const { problems, notes } = reviewPresentation(presentation, session.startIndex);
  const count = problems.length;

  return (
    <Modal
      title={
        count > 0
          ? `${String(count)} ${count === 1 ? 'transition cannot' : 'transitions cannot'} play`
          : 'Part of the motion is skipped'
      }
      open
      width="wide"
      onClose={exit}
      footer={
        <>
          <Button
            variant="outline"
            autoFocus
            onClick={() => {
              returnToEdit(problems[0]?.from.id ?? null);
            }}
          >
            Return to edit
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              continueWithCuts(problems.map((problem) => problem.key));
            }}
          >
            {count > 0
              ? `Present and cut across ${count === 1 ? 'it' : `these ${String(count)}`}`
              : 'Present'}
          </Button>
        </>
      }
    >
      {count > 0 && (
        <>
          <p className="text-ink-300">
            The presentation never plays a transition that cannot play. Repair{' '}
            {count === 1 ? 'it' : 'them'} first, or present with a cut to the next Koma at{' '}
            {count === 1 ? 'this place' : 'each of these places'}.
          </p>
          <ul aria-label="Transitions that cannot play" className="mt-4 flex flex-col gap-2">
            {problems.map((problem) => (
              <li
                key={problem.key}
                className="flex items-start gap-3 rounded-card border border-signal-warn/40 bg-surface-1 px-3 py-2.5"
              >
                <span aria-hidden="true" className="mt-0.5 flex-none text-signal-warn">
                  <WarningIcon size={14} />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="font-medium">
                    Koma {problem.fromNumber} to Koma {problem.fromNumber + 1}: “
                    {problem.from.title}” to “{problem.to.title}”
                    <span className="ml-2 text-sm text-signal-warn">{problem.label}</span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-300">{problem.reason}</p>
                </div>
                <Button
                  compact
                  variant="outline"
                  aria-label={`Edit the transition from Koma ${String(problem.fromNumber)} to Koma ${String(problem.fromNumber + 1)}`}
                  onClick={() => {
                    returnToEdit(problem.from.id);
                  }}
                >
                  Edit
                </Button>
              </li>
            ))}
          </ul>
        </>
      )}
      {notes.length > 0 && (
        <div className={count > 0 ? 'mt-5' : ''}>
          <p className="text-ink-300">
            These transitions play, but leave out motion from a newer version of Koma Motion:
          </p>
          <ul aria-label="Transitions that play in part" className="mt-2 list-disc pl-5 text-sm">
            {notes.map((note) => (
              <li key={note.key}>{note.headline}.</li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

function PresentationPlayer({
  project,
  session,
}: {
  readonly project: KomaProject;
  readonly session: PresenterSession;
}): ReactElement {
  const { presentation } = project;
  const store = usePresenterStore;
  const autoplay = usePresenterStore((state) => state.autoplay);
  const autoplayDelayMs = usePresenterStore((state) => state.autoplayDelayMs);
  const fullScreen = usePresenterStore((state) => state.fullScreen);
  const { next, previous, first, last, replay, togglePause, cutAcross, finishMotion, exit } =
    store.getState();
  const returnToEdit = usePresenterStore((state) => state.returnToEdit);
  const reducedMotion = usePrefersReducedMotion();
  const titleId = useId();
  const shortcutsId = useId();
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (element !== null && !element.open) {
      element.showModal();
      element.querySelector<HTMLButtonElement>('button[aria-label="Next"]')?.focus();
    }
  }, []);

  const here = resolvePresenterKoma(presentation, session.komaId, session.komaIndex);
  const step = session.motion === null ? null : resolvePlayingStep(presentation, session.motion);
  const token = session.motion?.token ?? null;
  const total = presentation.komas.length;
  const index = here?.index ?? 0;
  const hereKoma = here?.koma ?? null;

  const tokenRef = useRef(token);
  tokenRef.current = token;
  const playback = useTransitionPlayback({
    durationMs: reducedMotion ? REDUCED_MOTION_DURATION_MS : (step?.transition.duration ?? 0),
    onFinished: () => {
      if (tokenRef.current !== null) {
        finishMotion(tokenRef.current);
      }
    },
  });
  const { restart, reset, pause, play } = playback;
  useEffect(() => {
    if (token === null) {
      reset();
    } else {
      restart();
    }
  }, [token, restart, reset]);
  const status = playback.status;
  useEffect(() => {
    if (session.paused && status === 'playing') {
      pause();
    } else if (!session.paused && status === 'paused') {
      play();
    }
  }, [session.paused, status, pause, play]);

  const atRest = session.motion === null && session.halted === null;
  const canAdvance = index < total - 1;
  useEffect(() => {
    if (!autoplay || session.paused || !atRest || !canAdvance) {
      return;
    }
    const timer = setTimeout(next, autoplayDelayMs);
    return () => {
      clearTimeout(timer);
    };
  }, [autoplay, session.paused, atRest, canAdvance, autoplayDelayMs, next, session.komaId]);

  const [attachArea, area] = useElementSize<HTMLDivElement>();
  const canvasSize = getCanvasSize(presentation.aspectRatio);
  const scale = getFitScale(canvasSize, area, STAGE_PADDING);
  const resolveAsset = useMemo(() => createAssetResolver(project.assets), [project.assets]);

  const moving = step !== null && status !== 'idle';
  const frame = useMemo(() => {
    if (step !== null && status !== 'idle') {
      return getPreviewFrame({
        from: step.from,
        to: step.to,
        transition: step.transition,
        progress: playback.progress,
        reducedMotion,
      });
    }
    return hereKoma === null ? null : komaToFrame(hereKoma);
  }, [step, status, playback.progress, reducedMotion, hereKoma]);

  const haltedStep =
    session.halted === null || here === null ? null : getPresentationStep(presentation, index);
  const halted =
    haltedStep?.kind === 'problem' && haltedStep.problem.key === session.halted
      ? haltedStep.problem
      : null;
  const haltedHeading = useRef<HTMLHeadingElement>(null);
  const haltedKey = halted?.key ?? null;
  // Once per prompt, so that a re-render does not take the focus from its buttons.
  useEffect(() => {
    if (haltedKey !== null) {
      haltedHeading.current?.focus();
    }
  }, [haltedKey]);

  const replayable =
    session.motion !== null || getPresentationStep(presentation, index - 1)?.kind === 'motion';
  const position = moving ? index + 2 : index + 1;
  const shownKoma = moving ? step.to : here?.koma;
  const pausable = session.motion !== null || autoplay || session.paused;

  const toggleFullScreen = (): void => {
    void setPresentationFullScreen(fullScreen ? 'leave' : 'enter');
  };

  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.ctrlKey || event.metaKey || event.altKey) {
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      exit();
      return;
    }
    if (isTextEntry(event.target)) {
      return;
    }
    const onControl =
      event.target instanceof HTMLButtonElement || event.target instanceof HTMLInputElement;
    const actions: Record<string, () => void> = {
      ArrowRight: next,
      ArrowDown: next,
      PageDown: next,
      n: next,
      ArrowLeft: previous,
      ArrowUp: previous,
      PageUp: previous,
      Backspace: previous,
      p: previous,
      Home: first,
      End: last,
      k: togglePause,
      r: replay,
      a: () => {
        store.getState().setAutoplay(!store.getState().autoplay);
      },
      f: toggleFullScreen,
      '?': () => {
        setShortcutsOpen((open) => !open);
      },
      // A focused control keeps Space and Enter for itself.
      ...(onControl ? {} : { ' ': next, Enter: next }),
    };
    const action = actions[event.key.length === 1 ? event.key.toLowerCase() : event.key];
    if (action !== undefined) {
      event.preventDefault();
      action();
    }
  };
  // On the window, so the keys keep working when the focused control is
  // disabled, for example Next on the last Koma.
  const keyHandler = useRef(onKeyDown);
  keyHandler.current = onKeyDown;
  useEffect(() => {
    const listener = (event: KeyboardEvent): void => {
      keyHandler.current(event);
    };
    window.addEventListener('keydown', listener);
    return () => {
      window.removeEventListener('keydown', listener);
    };
  }, []);

  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      className="fixed inset-0 m-0 flex h-full max-h-none w-full max-w-none flex-col border-0 bg-black p-0 text-ink-100 backdrop:bg-black"
      onCancel={(event) => {
        event.preventDefault();
        exit();
      }}
      onClose={exit}
    >
      <h2 id={titleId} className="sr-only">
        Presentation
      </h2>
      <p aria-live="polite" className="sr-only">
        {shownKoma === undefined
          ? ''
          : `Koma ${String(position)} of ${String(total)}: ${shownKoma.title}`}
      </p>
      <div
        ref={attachArea}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden"
      >
        {frame !== null && scale > 0 && (
          <KomaStage
            frame={frame}
            canvasSize={canvasSize}
            scale={scale}
            resolveAsset={resolveAsset}
            label={
              moving
                ? `Transition from ${step.from.title} to ${step.to.title}`
                : `Koma ${String(index + 1)} of ${String(total)}: ${here?.koma.title ?? ''}`
            }
          />
        )}
        {reducedMotion && (
          <p
            role="note"
            className="absolute top-3 left-3 rounded-card border border-line bg-surface-2/90 px-3 py-1.5 text-sm text-ink-300"
          >
            Reduced motion is on: transitions cut instead of moving (
            {formatSeconds(REDUCED_MOTION_DURATION_MS)}).
          </p>
        )}
        {shortcutsOpen && (
          // Inside the dialog: content outside it is hidden behind the presentation.
          <section
            id={shortcutsId}
            aria-label="Presentation shortcuts"
            className={`absolute right-3 bottom-3 w-[27rem] max-w-[calc(100%-1.5rem)] px-4 py-3 text-sm ${POPOVER_SURFACE}`}
          >
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
              {PRESENTATION_SHORTCUTS.map(([keys, action]) => (
                <div key={keys} className="contents">
                  <dt className="text-ink-100">{keys}</dt>
                  <dd className="text-ink-300">{action}</dd>
                </div>
              ))}
            </dl>
          </section>
        )}
        {halted !== null && (
          <section
            aria-labelledby={`${titleId}-halted`}
            className="absolute bottom-6 left-1/2 w-[min(36rem,calc(100%-2rem))] -translate-x-1/2 rounded-dialog border border-signal-warn/50 bg-surface-2 px-5 py-4 shadow-dialog"
          >
            <h3
              ref={haltedHeading}
              id={`${titleId}-halted`}
              tabIndex={-1}
              className="flex items-center gap-2 font-semibold text-signal-warn outline-none"
            >
              <WarningIcon size={14} />
              The transition to Koma {halted.fromNumber + 1} cannot play
            </h3>
            <p className="mt-1.5 text-ink-300">
              “{halted.from.title}” to “{halted.to.title}”: {halted.label}. {halted.reason}
            </p>
            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <Button variant="quiet" onClick={previous}>
                Stay on Koma {halted.fromNumber}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  returnToEdit(halted.from.id);
                }}
              >
                Return to edit
              </Button>
              <Button variant="primary" onClick={cutAcross}>
                Cut to Koma {halted.fromNumber + 1}
              </Button>
            </div>
          </section>
        )}
      </div>

      <div
        role="group"
        aria-label="Presentation controls"
        className="flex h-14 flex-none items-center gap-1 border-t border-white/10 bg-surface-0/95 px-3"
      >
        <Button
          compact
          icon={<CloseIcon />}
          aria-keyshortcuts="Escape"
          onClick={exit}
          className="mr-2"
        >
          Exit
        </Button>
        <IconButton
          label="Previous"
          aria-keyshortcuts="ArrowLeft"
          disabled={index === 0 && session.motion === null && session.halted === null}
          onClick={previous}
        >
          <PreviousIcon />
        </IconButton>
        <IconButton
          label={session.paused ? 'Resume' : 'Pause'}
          aria-keyshortcuts="K"
          tone="motion"
          disabled={!pausable}
          onClick={togglePause}
        >
          {session.paused ? <PlayIcon /> : <PauseIcon />}
        </IconButton>
        <IconButton
          label="Next"
          aria-keyshortcuts="ArrowRight"
          autoFocus
          disabled={!canAdvance && session.motion === null}
          onClick={next}
        >
          <NextIcon />
        </IconButton>
        <IconButton
          label="Replay the transition"
          aria-keyshortcuts="R"
          disabled={!replayable}
          onClick={replay}
        >
          <RestartIcon />
        </IconButton>

        <p className="mx-3 flex min-w-0 items-baseline gap-2">
          <span className="flex-none font-semibold tabular-nums" data-presentation-position>
            {position} of {total}
          </span>
          <span className="truncate text-ink-400">{shownKoma?.title}</span>
          {!canAdvance && atRest && <span className="flex-none text-ink-400">· End</span>}
        </p>

        <div className="ml-auto flex flex-none items-center gap-3">
          <label className="flex items-center gap-2 text-ink-300">
            <Switch
              checked={autoplay}
              aria-keyshortcuts="A"
              onCheckedChange={(checked) => {
                store.getState().setAutoplay(checked);
              }}
            />
            Autoplay
          </label>
          <label className="flex items-center gap-1.5 text-ink-300">
            <span className="sr-only">Autoplay: seconds on each Koma</span>
            <NumberInput
              className="w-14"
              value={autoplayDelayMs / 1000}
              minimum={MIN_AUTOPLAY_DELAY_MS / 1000}
              maximum={MAX_AUTOPLAY_DELAY_MS / 1000}
              disabled={!autoplay}
              aria-label="Seconds on each Koma"
              onValue={(seconds) => {
                store.getState().setAutoplayDelay(seconds * 1000);
              }}
            />
            <span aria-hidden="true">s</span>
          </label>
          <Button compact aria-keyshortcuts="F" onClick={toggleFullScreen}>
            {fullScreen ? 'Leave full screen' : 'Full screen'}
          </Button>
          <Button
            compact
            aria-expanded={shortcutsOpen}
            aria-controls={shortcutsId}
            aria-keyshortcuts="?"
            onClick={() => {
              setShortcutsOpen((open) => !open);
            }}
          >
            Shortcuts
          </Button>
        </div>
      </div>
    </dialog>
  );
}
