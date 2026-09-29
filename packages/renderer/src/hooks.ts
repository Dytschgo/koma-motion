import type { Size } from '@koma-motion/core';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { advancePlayback, IDLE_PLAYBACK, type PlaybackState } from './preview';

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function subscribeToReducedMotion(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

/** Whether the operating system asks for reduced motion. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/** Measures an element and keeps the measurement up to date. */
export function useElementSize<T extends HTMLElement>(): [(node: T | null) => void, Size] {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const attach = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (node === null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry !== undefined) {
        const { width, height } = entry.contentRect;
        setSize((previous) =>
          previous.width === width && previous.height === height ? previous : { width, height },
        );
      }
    });
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  useEffect(
    () => () => {
      observerRef.current?.disconnect();
    },
    [],
  );

  return [attach, size];
}

export interface TransitionPlayback extends PlaybackState {
  play(): void;
  pause(): void;
  /** Starts again from the beginning. */
  restart(): void;
  /** Returns to the idle state at progress 0. */
  reset(): void;
  seek(progress: number): void;
}

/**
 * Drives the progress of a transition preview with animation frames. The
 * hook knows nothing about Komas: it only produces a progress between 0 and 1.
 */
export function useTransitionPlayback(options: {
  readonly durationMs: number;
  readonly onFinished?: () => void;
}): TransitionPlayback {
  const [state, setState] = useState<PlaybackState>(IDLE_PLAYBACK);
  const durationRef = useRef(options.durationMs);
  const onFinishedRef = useRef(options.onFinished);

  useEffect(() => {
    durationRef.current = options.durationMs;
    onFinishedRef.current = options.onFinished;
  });

  const playing = state.status === 'playing';
  useEffect(() => {
    if (!playing) {
      return;
    }
    let frame = 0;
    let previous: number | null = null;
    const tick = (time: number): void => {
      const elapsed = previous === null ? 0 : time - previous;
      previous = time;
      setState((current) => advancePlayback(current, elapsed, durationRef.current));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
    };
  }, [playing]);

  const finished = state.status === 'finished';
  useEffect(() => {
    if (finished) {
      onFinishedRef.current?.();
    }
  }, [finished]);

  const play = useCallback(() => {
    setState((current) =>
      current.status === 'finished' || current.progress >= 1
        ? { status: 'playing', progress: 0 }
        : { status: 'playing', progress: current.progress },
    );
  }, []);
  const pause = useCallback(() => {
    setState((current) =>
      current.status === 'playing' ? { status: 'paused', progress: current.progress } : current,
    );
  }, []);
  const restart = useCallback(() => {
    setState({ status: 'playing', progress: 0 });
  }, []);
  const reset = useCallback(() => {
    setState(IDLE_PLAYBACK);
  }, []);
  const seek = useCallback((progress: number) => {
    const clamped = Math.min(1, Math.max(0, progress));
    setState({ status: 'paused', progress: clamped });
  }, []);

  return { ...state, play, pause, restart, reset, seek };
}
