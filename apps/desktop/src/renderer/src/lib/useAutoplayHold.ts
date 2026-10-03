import { useEffect, useRef } from 'react';

/** Hold only at rest, preserving elapsed time while paused. A different Koma or duration starts a new hold. */
export function useAutoplayHold({
  komaId,
  durationMs,
  enabled,
  paused,
  onAdvance,
}: {
  readonly komaId: string;
  readonly durationMs: number;
  readonly enabled: boolean;
  readonly paused: boolean;
  readonly onAdvance: () => void;
}): void {
  const hold = useRef<{ komaId: string; durationMs: number; remainingMs: number } | null>(null);
  useEffect(() => {
    if (!enabled) {
      hold.current = null;
      return;
    }
    if (hold.current?.komaId !== komaId || hold.current.durationMs !== durationMs) {
      hold.current = { komaId, durationMs, remainingMs: durationMs };
    }
    if (paused) return;
    const current = hold.current;
    const startedAt = performance.now();
    const timer = setTimeout(onAdvance, current.remainingMs);
    return () => {
      clearTimeout(timer);
      current.remainingMs = Math.max(0, current.remainingMs - (performance.now() - startedAt));
    };
  }, [komaId, durationMs, enabled, paused, onAdvance]);
}
