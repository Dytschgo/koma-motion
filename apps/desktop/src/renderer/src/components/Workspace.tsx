import { getCanvasSize, type KomaProject } from '@koma-motion/core';
import { komaToFrame } from '@koma-motion/motion-engine';
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
import { useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import {
  formatSeconds,
  getTransitionContext,
  getTransitionOfKoma,
  resolvePreviewTransition,
  useSelectedKoma,
} from '../lib/selectors';
import { addKomaAfter, chooseKomaImage } from '../lib/projectActions';
import { AUTHORING_KINDS, AUTHORING_LABELS, type AuthoringKind } from '../lib/authoring';
import { assessTransition } from '../lib/transitionIssues';
import { changeElement, changeTransition, createElement } from '../state/commands';
import { useAgentStore } from '../state/agentStore';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useTransitionRegenerationStore } from '../state/transitionRegenerationStore';
import { useUiStore } from '../state/uiStore';
import { ImageIcon, NextIcon, PauseIcon, PlayIcon, PreviousIcon, RestartIcon } from './icons';
import { Button, Help, IconButton, NumberInput, POPOVER_SURFACE, Select } from './ui';

const CANVAS_PADDING = 32;
const ZOOM_STEP = 1.25;
/** With reduced motion a preview is a short cut, whatever the duration of the transition. */
const REDUCED_MOTION_DURATION_MS = 400;

export function Workspace({
  project,
  onInspectSelected,
}: {
  readonly project: KomaProject;
  readonly onInspectSelected: () => void;
}): ReactElement {
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
  const generating = useAgentStore((state) => state.execution !== null);
  const [authoringKind, setAuthoringKind] = useState<AuthoringKind>('text');
  const toolbar = useRef<HTMLDivElement>(null);

  const koma = useSelectedKoma();
  const selectedElement = koma?.elements.find((element) => element.id === selectedElementId);
  const addElement = (): void => {
    if (koma === null || preview !== null) return;
    const known = new Set(koma.elements.map((element) => element.id));
    try {
      apply(createElement(koma.id, authoringKind));
      const added = selectProject(useProjectStore.getState())
        ?.presentation.komas.find((item) => item.id === koma.id)
        ?.elements.find((element) => !known.has(element.id));
      if (added) selectElement(added.id);
    } catch (error) {
      useUiStore
        .getState()
        .notify(
          'error',
          error instanceof Error ? error.message : 'The element could not be added.',
        );
    }
  };
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
  const assessment =
    transportContext === null
      ? null
      : assessTransition(
          presentation,
          transportContext.transition,
          transportContext.from,
          transportContext.to,
        );
  const transitionBlocked = assessment?.blocked === true;
  const transportTransitionId = transportContext?.transition.id ?? null;

  // A transition that cannot play is never previewed, whatever started it.
  useEffect(() => {
    if (preview !== null && stageContext !== null && transitionBlocked) {
      reset();
      stopPreview();
    }
  }, [preview, stageContext, transitionBlocked, reset, stopPreview]);

  // The outcome of an earlier attempt is forgotten once the transition plays again.
  const clearRegeneration = useTransitionRegenerationStore((state) => state.clear);
  const regeneration = useTransitionRegenerationStore((state) =>
    transportTransitionId === null ? undefined : state.entries[transportTransitionId],
  );
  useEffect(() => {
    if (
      transportTransitionId !== null &&
      assessment === null &&
      regeneration !== undefined &&
      regeneration.status !== 'running'
    ) {
      clearRegeneration(transportTransitionId);
    }
  }, [transportTransitionId, assessment, regeneration, clearRegeneration]);

  // When the warning disappears with the control that had the focus, the
  // focus moves to Play, which is what the fix made available.
  const hadWarning = useRef(false);
  const transportRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (assessment !== null) {
      hadWarning.current = true;
      return;
    }
    if (hadWarning.current) {
      hadWarning.current = false;
      if (document.activeElement === null || document.activeElement === document.body) {
        transportRef.current
          ?.querySelector<HTMLButtonElement>('button[aria-label="Play"]')
          ?.focus();
      }
    }
  }, [assessment]);

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
    <section
      data-guide-target="canvas"
      tabIndex={-1}
      aria-label="Canvas"
      className="flex min-h-0 min-w-0 flex-1 flex-col bg-surface-0"
    >
      <div
        ref={toolbar}
        className="flex min-h-11 flex-none flex-wrap items-center gap-1 border-b border-line bg-surface-1 px-2.5 py-1"
      >
        <Select
          aria-label="Element to add"
          className="w-28"
          disabled={koma === null || preview !== null}
          value={authoringKind}
          onChange={(event) => {
            const kind = AUTHORING_KINDS.find((item) => item === event.target.value);
            if (kind) setAuthoringKind(kind);
          }}
        >
          {AUTHORING_KINDS.map((kind) => (
            <option key={kind} value={kind}>
              {AUTHORING_LABELS[kind]}
            </option>
          ))}
        </Select>
        <Button
          compact
          aria-label={`Add ${authoringKind}`}
          disabled={koma === null || preview !== null}
          onClick={addElement}
        >
          Add
        </Button>
        <IconButton
          label="Add image"
          disabled={koma === null || preview !== null}
          onClick={() => {
            if (koma) void chooseKomaImage(koma.id);
          }}
        >
          <ImageIcon />
        </IconButton>
        <Button
          compact
          aria-label="Inspect selected element"
          disabled={!selectedElement || preview !== null}
          onClick={onInspectSelected}
        >
          Inspect
        </Button>
        <Help label="Canvas shortcuts">
          Drag to move. Drag corners to resize. Enter edits text; Esc cancels.
        </Help>
        {preview !== null && (
          <Button compact onClick={stopPreview}>
            Stop preview
          </Button>
        )}
      </div>
      <div
        ref={attachArea}
        className="studio-desk relative flex min-h-0 flex-1 items-center justify-center overflow-auto"
      >
        {frame === null ? (
          <div className="max-w-md rounded-dialog border border-dashed border-line-strong bg-surface-1/80 px-8 py-7 text-center">
            {generating ? (
              <>
                <p className="flex items-center justify-center gap-2 text-xl font-semibold tracking-tight">
                  <span aria-hidden="true" className="working-dot size-2 rounded-full bg-motion" />
                  Drawing your Komas
                </p>
                <p className="mt-2 text-ink-300">They appear here when the agent is done.</p>
              </>
            ) : (
              <>
                <p className="text-xl font-semibold tracking-tight">Start your presentation</p>
                <p className="mt-2 text-ink-300">Describe it in the chat, or add a Koma.</p>
                <Button
                  variant="outline"
                  className="mt-4"
                  onClick={() => {
                    addKomaAfter(null);
                    requestAnimationFrame(() => {
                      toolbar.current?.querySelector('select')?.focus();
                    });
                  }}
                >
                  Add first Koma
                </Button>
              </>
            )}
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
            <div className="rounded-[2px] shadow-[0_18px_60px_rgb(0_0_0/0.55),0_0_0_1px_rgb(255_255_255/0.06)]">
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
            className="absolute bottom-3 left-3 max-w-[60%] rounded-card border border-line bg-surface-2 px-3 py-1.5 text-sm text-ink-300 shadow-raised"
          >
            Reduced motion is on: previews cut instead of moving (
            {formatSeconds(REDUCED_MOTION_DURATION_MS)}).
          </p>
        )}

        <div
          className={`absolute right-3 bottom-3 flex items-center gap-0.5 p-0.5 ${POPOVER_SURFACE}`}
        >
          <Button
            aria-label="Zoom out"
            compact
            disabled={frame === null || (zoom ?? 1) <= MIN_ZOOM}
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
            disabled={frame === null}
            onClick={() => {
              setZoom(null);
            }}
          >
            {zoom === null ? 'Fit' : `${String(Math.round(zoom * 100))}%`}
          </Button>
          <Button
            aria-label="Zoom in"
            compact
            disabled={frame === null || (zoom ?? 1) >= MAX_ZOOM}
            onClick={() => {
              setZoom((zoom ?? 1) * ZOOM_STEP);
            }}
          >
            +
          </Button>
        </div>
      </div>

      <div
        ref={transportRef}
        role="group"
        aria-label="Transition preview"
        data-guide-target="preview"
        tabIndex={-1}
        // A container, so that the labels give way before the position control
        // when the canvas is narrow.
        className="@container flex-none border-t border-line bg-surface-1"
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
            disabled={transportContext === null || transitionBlocked}
            tone="motion"
            onClick={togglePlayback}
          >
            {playback.status === 'playing' ? <PauseIcon /> : <PlayIcon />}
          </IconButton>
          <IconButton
            label="Restart"
            disabled={transportContext === null || transitionBlocked}
            onClick={restartPreview}
          >
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
            <p className="ml-3 text-ink-400">Add another Koma for motion.</p>
          ) : (
            <>
              <p className="sr-only flex-none text-ink-300 @min-[36rem]:not-sr-only @min-[36rem]:mx-3">
                Koma {transportContext.fromIndex + 1} to Koma {transportContext.fromIndex + 2}
              </p>
              {transitionBlocked && (
                // The disabled controls cannot take the focus, so their reason
                // is shown next to them.
                <p className="mx-2 flex-none text-sm text-signal-warn">Cannot play</p>
              )}
              <input
                type="range"
                disabled={transitionBlocked}
                className="scrubber min-w-24 flex-1 disabled:cursor-not-allowed disabled:opacity-50"
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
