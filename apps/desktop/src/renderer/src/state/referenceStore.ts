import type { ReferenceText } from '@koma-motion/agent-runtime';
import { create } from 'zustand';

interface ReferenceState {
  readonly sessionId: number | null;
  readonly references: readonly ReferenceText[];
  readonly selecting: boolean;
  readonly error: string | null;
  readonly setReferences: (sessionId: number, references: readonly ReferenceText[]) => void;
  readonly setSelecting: (selecting: boolean) => void;
  readonly setError: (error: string | null) => void;
  readonly clear: () => void;
}

/** Source text is session-only. It is never part of the saved project or localStorage. */
export const useReferenceStore = create<ReferenceState>((set) => ({
  sessionId: null,
  references: [],
  selecting: false,
  error: null,
  setReferences: (sessionId, references) => set({ sessionId, references, error: null }),
  setSelecting: (selecting) => set({ selecting }),
  setError: (error) => set({ error }),
  clear: () => set({ sessionId: null, references: [], selecting: false, error: null }),
}));
