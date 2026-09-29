import { getCanvasSize, type KomaProject } from '@koma-motion/core';
import { findUnsupportedOperations, komaToFrame } from '@koma-motion/motion-engine';
import {
  createAssetResolver,
  getFitScale,
  getPreviewFrame,
  KomaStage,
  MAX_ZOOM,
  MIN_ZOOM,
  useElementSize,
  usePrefersReducedMotion,
  useTransitionPlayback,
} from '@koma-motion/renderer';
import { useEffect, useMemo, useRef, type CSSProperties, type ReactElement } from 'react';
import {
  formatSeconds,
  getTransitionContext,
  useCurrentTransition,
  useSelectedKoma,
} from '../lib/selectors';
import { changeTransition } from '../state/commands';
import { useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { NextIcon, PauseIcon, PlayIcon, PreviousIcon, RestartIcon, WarningIcon } from './icons';
import { Button, IconButton, NumberInput } from './ui';

const CANVAS_PADDING = 32;
const ZOOM_STEP = 1.25;
/** With reduced motion a preview is a short cut, whatever the duration of the transition. */
const REDUCED_MOTION_DURATION_MS = 400;

export function Workspace({ project }: { readonly project: KomaProject }): ReactElement {
  const { presentation } = project;
  const apply = useProjectStore((state) => state.apply);
  const selectedElementId = useUiStore((state) => state.selectedElementId);
  const selectElement = useUiStore((state) => state.selectElement);
  const selectKoma = useUiStore((state) => state.selectKoma);
  const preview = useUiStore((state) => state.preview);
  const startPreview = useUiStore((state) => state.startPreview);
  const zoom = useUiStore((state) => state.zoom);
  const setZoom = useUiStore((state) => state.setZoom);

  const koma = useSelectedKoma();
  const transition = useCurrentTransition();
  const context = transition === null ? null : getTransitionContext(presentation, transition.id);
  const reducedMotion = usePrefersReducedMotion();
  const lastPreviewed = useRef<string | null>(null);

  const playback = useTransitionPlayback({
    durationMs: reducedMotion ? REDUCED_MOTION_DURATION_MS : (transition?.duration ?? 0),
    onFinished: () => {
      // The presentation has arrived at the target Koma.
      if (context !== null) {
        selectKoma(context.to.id);
      }
    },
  });
  const { restart, reset, seek } = playback;

  /** Set when a preview starts because the position control was moved. */
  const pendingPosition = useRef<number | null>(null);
  const previewToken = preview?.token ?? null;
  useEffect(() => {
    if (previewToken === null) {
      reset();
    } else if (pendingPosition.current === null) {
      restart();
    } else {
      seek(pendingPosition.current);
      pendingPosition.current = null;
    }
  }, [previewToken, restart, reset, seek]);

  useEffect(() => {
    if (preview !== null) {
      lastPreviewed.current = preview.transitionId;
    }
  }, [preview]);

  const [attachArea, area] = useElementSize<HTMLDivElement>();
  const canvasSize = getCanvasSize(presentation.aspectRatio);
  const fitScale = getFitScale(canvasSize, area, CANVAS_PADDING);
  const scale = fitScale * (zoom ?? 1);
  const resolveAsset = useMemo(() => createAssetResolver(project.assets), [project.assets]);

  const previewing = preview !== null && context !== null && playback.status !== 'idle';
  const frame = useMemo(() => {
    if (previewing) {
      return getPreviewFrame({
        from: context.from,
        to: context.to,
        transition: context.transition,
        progress: playback.progress,
        reducedMotion,
      });
    }
    return koma === null ? null : komaToFrame(koma);
  }, [previewing, context, playback.progress, reducedMotion, koma]);

  const unsupported = useMemo(
    () => (transition === null ? [] : findUnsupportedOperations(transition)),
    [transition],
  );

  const komaIndex = presentation.komas.findIndex((candidate) => candidate.id === koma?.id);
  const previousKoma = presentation.komas[komaIndex - 1];
  const nextKoma = presentation.komas[komaIndex + 1];

  const togglePlayback = (): void => {
    if (playback.status === 'playing') {
      playback.pause();
    } else if (playback.status === 'paused' && preview !== null) {
      playback.play();
    } else if (transition !== null) {
      startPreview(transition.id);
    }
  };

  const restartPreview = (): void => {
    const transitionId = preview?.transitionId ?? lastPreviewed.current ?? transition?.id;
    if (
      transitionId !== undefined &&
      presentation.transitions.some((candidate) => candidate.id === transitionId)
    ) {
      startPreview(transitionId);
    }
  };

  const progressPercent = Math.round((previewing ? playback.progress : 0) * 100);

  return (
    <section aria-label="Canvas" className="flex min-h-0 min-w-0 flex-1 flex-col bg-desk-950">
      {unsupported.length > 0 && (
        <div
          role="alert"
          className="flex items-start gap-2 border-b border-signal-warn/40 bg-desk-800 px-4 py-2 text-signal-warn"
        >
          <span className="mt-0.5 flex-none">
            <WarningIcon />
          </span>
          <div>
            <p className="font-semibold">
              Warning: this transition contains operations that cannot be played.
            </p>
            <ul>
              {unsupported.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div
        ref={attachArea}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto"
      >
        {frame === null ? (
          <div className="max-w-md px-6 text-center">
            <p className="text-xl font-semibold">This presentation has no Komas yet</p>
            <p className="mt-2 text-ink-300">
              Describe what you want to present in the chat below. The provider creates the Komas
              and Koma Motion works out the motion between them.
            </p>
          </div>
        ) : (
          scale > 0 && (
            <div className="shadow-[0_12px_48px_rgb(0_0_0/0.5)]">
              <KomaStage
                frame={frame}
                canvasSize={canvasSize}
                scale={scale}
                resolveAsset={resolveAsset}
                label={
                  previewing
                    ? `Preview of the transition from ${context.from.title} to ${context.to.title}`
                    : `Koma ${String(komaIndex + 1)}: ${koma?.title ?? ''}`
                }
                selectedElementId={previewing ? null : selectedElementId}
                onSelectElement={previewing ? undefined : selectElement}
              />
            </div>
          )
        )}

        <div className="absolute right-3 bottom-3 flex items-center gap-0.5 rounded-lg border border-desk-600 bg-desk-800 p-0.5">
          <Button
            aria-label="Zoom out"
            compact
            disabled={(zoom ?? 1) <= MIN_ZOOM}
            onClick={() => {
              setZoom((zoom ?? 1) / ZOOM_STEP);
            }}
          >
            −
          </Button>
          <Button
            aria-label={`Zoom ${String(Math.round((zoom ?? 1) * 100))} percent. Fit the canvas to the window`}
            compact
            className="min-w-14 tabular-nums"
            onClick={() => {
              setZoom(null);
            }}
          >
            {zoom === null ? 'Fit' : `${String(Math.round(zoom * 100))}%`}
          </Button>
          <Button
            aria-label="Zoom in"
            compact
            disabled={(zoom ?? 1) >= MAX_ZOOM}
            onClick={() => {
              setZoom((zoom ?? 1) * ZOOM_STEP);
            }}
          >
            +
          </Button>
        </div>
      </div>

      <div
        role="group"
        aria-label="Transition preview"
        className="flex h-14 flex-none items-center gap-1 border-t border-desk-600 bg-desk-800 px-3"
      >
        <IconButton
          label="Previous Koma"
          disabled={previousKoma === undefined}
          onClick={() => {
            selectKoma(previousKoma?.id ?? null);
          }}
        >
          <PreviousIcon />
        </IconButton>
        <IconButton
          label={playback.status === 'playing' ? 'Pause' : 'Play'}
          disabled={transition === null}
          tone="motion"
          onClick={togglePlayback}
        >
          {playback.status === 'playing' ? <PauseIcon /> : <PlayIcon />}
        </IconButton>
        <IconButton label="Restart" disabled={transition === null} onClick={restartPreview}>
          <RestartIcon />
        </IconButton>
        <IconButton
          label="Next Koma"
          disabled={nextKoma === undefined}
          onClick={() => {
            selectKoma(nextKoma?.id ?? null);
          }}
        >
          <NextIcon />
        </IconButton>

        {context === null ? (
          <p className="ml-3 text-ink-400">Add a second Koma to see motion between two Komas.</p>
        ) : (
          <>
            <p className="mx-3 flex-none text-ink-300">
              Koma {context.fromIndex + 1} to Koma {context.fromIndex + 2}
            </p>
            <input
              type="range"
              className="scrubber min-w-0 flex-1"
              min={0}
              max={1000}
              value={Math.round((previewing ? playback.progress : 0) * 1000)}
              aria-label="Position in the transition"
              aria-valuetext={`${String(progressPercent)} percent`}
              style={{ '--progress': `${String(progressPercent)}%` } as CSSProperties}
              onChange={(event) => {
                const position = Number(event.target.value) / 1000;
                if (preview?.transitionId === context.transition.id) {
                  seek(position);
                } else {
                  pendingPosition.current = position;
                  startPreview(context.transition.id);
                }
              }}
            />
            <label className="ml-3 flex flex-none items-center gap-2 text-ink-300">
              Duration
              <NumberInput
                className="w-16"
                value={context.transition.duration / 1000}
                minimum={0.1}
                maximum={10}
                aria-label="Transition duration in seconds"
                onValue={(seconds) => {
                  apply(changeTransition(context.transition.id, { duration: seconds * 1000 }), {
                    coalesceKey: `transition-duration:${context.transition.id}`,
                  });
                }}
              />
              <span aria-hidden="true">s</span>
            </label>
            {reducedMotion && (
              <p className="ml-3 flex-none text-sm text-ink-400">
                Reduced motion is on: previews cut instead of moving (
                {formatSeconds(REDUCED_MOTION_DURATION_MS)}).
              </p>
            )}
          </>
        )}
      </div>
    </section>
  );
}
