import { create } from 'zustand';

export const QUICK_START_PREFERENCE_KEY = 'koma-motion:quick-start-completed';

function loadCompleted(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.localStorage.getItem(QUICK_START_PREFERENCE_KEY) === 'true'
    );
  } catch {
    return false;
  }
}

interface QuickStartState {
  readonly open: boolean;
  readonly completed: boolean;
  readonly setOpen: (open: boolean) => void;
  readonly setCompleted: (completed: boolean) => void;
}

/** App preference, like chat layout. Never changes the project or its undo history. */
export const useQuickStartStore = create<QuickStartState>((set) => ({
  open: false,
  completed: loadCompleted(),
  setOpen: (open) => set({ open }),
  setCompleted(completed) {
    try {
      window.localStorage.setItem(QUICK_START_PREFERENCE_KEY, String(completed));
    } catch {
      // Keep the guide usable even when preferences cannot be written.
    }
    set({ completed });
  },
}));
