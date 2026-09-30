import { getCanvasSize, type KomaProject } from '@koma-motion/core';
import {
  findUnsupportedOperations,
  komaToFrame,
  validateTransition,
} from '@koma-motion/motion-engine';
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
  getTransitionOfKoma,
  resolvePreviewTransition,
  useSelectedKoma,
} from '../lib/selectors';
import { chooseKomaImage } from '../lib/projectActions';
import { changeElement, changeTransition } from '../state/commands';
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
  const sessionId = useProjectStore((state) => state.sessionId);
  const apply = useProjectStore((state) => state.apply);
  const selectedElementId = useUiStore((state) => state.selectedElementId);
  const selectElement = useUiStore((state) => state.selectElement);
  const selectKoma = useUiStore((state) => state.selectKoma);
  const preview = useUiStore((state) => state.preview);
  const startPreview = useUiStore((state) => state.startPreview);
  const stopPreview = useUiStore((state) => state.stopPreview);
  const zoom = useUiStore((state) => state.zoom);
  const setZoom = useUiStore((state) => state.setZoom);
  const chatOpen = useUiStore((state) => state.agentPanelOpen);
  const setChatOpen = useUiStore((state) => state.setAgentPanelOpen);

  const koma = useSelectedKoma();
  // The stage follows only a preview whose recorded ends are still valid.
  // The transport keeps the selected Koma's transition so Play still has one
  // when that preview has been stopped.
  const stageContext = resolvePreviewTransition(presentation, preview);
  const selectedTransition = getTransitionOfKoma(presentation, koma?.id ?? null);
  const selectedContext =
    selectedTransition === null ? null : getTransitionContext(presentation, selectedTransition.id);
  const transportContext = stageContext ?? selectedContext;
  const reducedMotion = usePrefersReducedMotion();
  /** Lets Restart replay a preview after it ends and selects the destination. */
  const lastPreviewed = useRef<string | null>(null);
  if (stageContext !== null) {
    lastPreviewed.current = stageContext.transition.id;
  }

  const playback = useTransitionPlayback({
    durationMs: reducedMotion
      ? REDUCED_MOTION_DURATION_MS
      : (transportContext?.transition.duration ?? 0),
    onFinished: () => {
      // The presentation has arrived at the target Koma.
      if (stageContext !== null) {
        selectKoma(stageContext.to.id);
      }
    },
  });
  const { restart, reset, seek } = playback;

  /** Set when a preview starts because the position control was moved. */
  const pendingPosition = useRef<number | null>(null);
  const previewToken = preview?.token ?? null;
  // Depends on the token only. A duration edit keeps the token, so progress stays.
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

  const previewValid = stageContext !== null;
  useEffect(() => {
    if (preview !== null && !previewValid) {
      reset();
      stopPreview();
    }
  }, [preview, previewValid, reset, stopPreview]);

  const [attachArea, area] = useElementSize<HTMLDivElement>();
  const canvasSize = getCanvasSize(presentation.aspectRatio);
  const fitScale = getFitScale(canvasSize, area, CANVAS_PADDING);
  const scale = fitScale * (zoom ?? 1);
  const resolveAsset = useMemo(() => createAssetResolver(project.assets), [project.assets]);

  // The transport and the stage show the same transition whenever a preview
  // is valid, so its issues apply to both.
  const transportTransition = transportContext?.transition ?? null;
  const motionIssues = useMemo(() => {
    if (transportTransition === null) {
      return [];
    }
    const blocking = validateTransition(transportTransition, presentation).filter(
      (issue) => issue.code !== 'unsupportedOperation',
    );
    return [...blocking, ...findUnsupportedOperations(transportTransition)];
  }, [presentation, transportTransition]);
  const transitionBlocked = motionIssues.some((issue) => issue.code !== 'unsupportedOperation');

  const previewing = stageContext !== null && playback.status !== 'idle';
  const frame = useMemo(() => {
    if (stageContext !== null && playback.status !== 'idle') {
      return getPreviewFrame({
        from: stageContext.from,
        to: stageContext.to,
        transition: stageContext.transition,
        progress: playback.progress,
        reducedMotion,
        blocked: transitionBlocked,
      });
    }
    return koma === null ? null : komaToFrame(koma);
  }, [stageContext, playback.status, playback.progress, reducedMotion, koma, transitionBlocked]);

  const komaIndex = presentation.komas.findIndex((candidate) => candidate.id === koma?.id);
  const previousKoma = presentation.komas[komaIndex - 1];
  const nextKoma = presentation.komas[komaIndex + 1];

  const togglePlayback = (): void => {
    if (playback.status === 'playing') {
      playback.pause();
    } else if (playback.status === 'paused' && stageContext !== null) {
      playback.play();
    } else if (transportContext !== null) {
      startPreview(transportContext.transition.id);
    }
  };

  const restartPreview = (): void => {
    const candidates = [
      preview?.transitionId,
      lastPreviewed.current,
      transportContext?.transition.id,
    ];
    for (const transitionId of candidates) {
      if (
        typeof transitionId === 'string' &&
        presentation.transitions.some((candidate) => candidate.id === transitionId)
      ) {
        startPreview(transitionId);
        return;
      }
    }
  };

  const progressPercent = Math.round((previewing ? playback.progress : 0) * 100);

  return (
    <section aria-label="Canvas" className="flex min-h-0 min-w-0 flex-1 flex-col bg-desk-950">
      {motionIssues.length > 0 && (
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
              {motionIssues.map((issue, index) => (
                <li key={index}>{issue.message}</li>
              ))}
            </ul>
          </div>
        </div>
      )}

      <div className="flex flex-none items-center gap-3 border-b border-desk-600 px-3 py-1.5">
        <Button
          compact
          disabled={koma === null || preview !== null}
          onClick={() => {
            if (koma) void chooseKomaImage(koma.id);
          }}
        >
          Add image
        </Button>
        <p className="text-sm text-ink-400">
          Drag to move | Corners to resize | Enter to edit text | Esc to cancel
        </p>
        {preview !== null && (
          <Button compact onClick={stopPreview}>
            Stop preview
          </Button>
        )}
      </div>
      <div
        ref={attachArea}
        className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto"
      >
        {frame === null ? (
          <div className="max-w-md px-6 text-center">
            <p className="text-xl font-semibold">This presentation has no Komas yet</p>
            <p className="mt-2 text-ink-300">
              Describe what you want to present in the chat. The provider creates the Komas and Koma
              Motion works out the motion between them.
            </p>
            {!chatOpen && (
              <Button
                variant="outline"
                className="mt-4"
                onClick={() => {
                  setChatOpen(true);
                }}
              >
                Open the chat
              </Button>
            )}
          </div>
        ) : (
          scale > 0 && (
            <div className="shadow-[0_12px_48px_rgb(0_0_0/0.5)]">
              <KomaStage
                key={`${String(sessionId)}:${koma?.id ?? ''}:${String(preview !== null)}`}
                onCommitElement={
                  preview !== null || koma === null
                    ? undefined
                    : (element) => apply(changeElement(koma.id, element))
                }
                frame={frame}
                canvasSize={canvasSize}
                scale={scale}
                resolveAsset={resolveAsset}
                label={
                  stageContext !== null && playback.status !== 'idle'
                    ? `Preview of the transition from ${stageContext.from.title} to ${stageContext.to.title}`
                    : `Koma ${String(komaIndex + 1)}: ${koma?.title ?? ''}`
                }
                selectedElementId={preview !== null ? null : selectedElementId}
                onSelectElement={preview !== null ? undefined : selectElement}
              />
            </div>
          )
        )}

        {reducedMotion && transportContext !== null && (
          // On the canvas, not in the transport bar: there it competed with
          // the position control for space and one of them disappeared.
          <p
            role="note"
            className="absolute bottom-3 left-3 max-w-[60%] rounded-lg border border-desk-600 bg-desk-800 px-3 py-1.5 text-sm text-ink-300"
          >
            Reduced motion is on: previews cut instead of moving (
            {formatSeconds(REDUCED_MOTION_DURATION_MS)}).
          </p>
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
        // A container, so that the labels give way before the position control
        // when the canvas is narrow.
        className="@container flex-none border-t border-desk-600 bg-desk-800"
      >
        <div className="flex h-14 items-center gap-1 px-3">
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
            disabled={transportContext === null}
            tone="motion"
            onClick={togglePlayback}
          >
            {playback.status === 'playing' ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          <IconButton label="Restart" disabled={transportContext === null} onClick={restartPreview}>
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

          {transportContext === null ? (
            <p className="ml-3 text-ink-400">Add a second Koma to see motion between two Komas.</p>
          ) : (
            <>
              <p className="sr-only flex-none text-ink-300 @min-[36rem]:not-sr-only @min-[36rem]:mx-3">
                Koma {transportContext.fromIndex + 1} to Koma {transportContext.fromIndex + 2}
              </p>
              <input
                type="range"
                className="scrubber min-w-24 flex-1"
                min={0}
                max={1000}
                value={Math.round((previewing ? playback.progress : 0) * 1000)}
                aria-label="Position in the transition"
                aria-valuetext={`${String(progressPercent)} percent`}
                style={{ '--progress': `${String(progressPercent)}%` } as CSSProperties}
                onChange={(event) => {
                  const position = Number(event.target.value) / 1000;
                  if (stageContext?.transition.id === transportContext.transition.id) {
                    seek(position);
                  } else {
                    pendingPosition.current = position;
                    startPreview(transportContext.transition.id);
                  }
                }}
              />
              <label className="ml-3 flex flex-none items-center gap-2 text-ink-300">
                <span className="sr-only @min-[30rem]:not-sr-only">Duration</span>
                <NumberInput
                  className="w-16"
                  value={transportContext.transition.duration / 1000}
                  minimum={0.1}
                  maximum={10}
                  aria-label="Transition duration in seconds"
                  onValue={(seconds) => {
                    apply(
                      changeTransition(transportContext.transition.id, {
                        duration: seconds * 1000,
                      }),
                      {
                        coalesceKey: `transition-duration:${transportContext.transition.id}`,
                      },
                    );
                  }}
                />
                <span aria-hidden="true">s</span>
              </label>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
