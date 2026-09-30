/**
 * The Brand Kit library as the window last received it. The library belongs
 * to this computer, not to a project: nothing here enters the undo history
 * or a project file, and replacing the project does not clear it.
 */
import { create } from 'zustand';
import type { BrandKitLibraryState, SavedBrandKitSummary } from '../../../shared/ipc';

export type LibraryView =
  | { readonly status: 'idle' }
  | {
      readonly status: 'ready';
      readonly kits: readonly SavedBrandKitSummary[];
      readonly unreadableCount: number;
    }
  | { readonly status: 'damaged'; readonly message: string; readonly canStartNew: boolean }
  | { readonly status: 'failed'; readonly message: string };

interface BrandKitLibraryStoreState {
  readonly library: LibraryView;
  /** True while a request to the library is running. */
  readonly busy: boolean;
  readonly selectedKitId: string | null;

  readonly setBusy: (busy: boolean) => void;
  readonly select: (kitId: string | null) => void;
  /** Takes the state the main process reported after a list or an action. */
  readonly receive: (state: BrandKitLibraryState) => void;
  readonly fail: (message: string) => void;
}

export const useBrandKitLibraryStore = create<BrandKitLibraryStoreState>((set) => ({
  library: { status: 'idle' },
  busy: false,
  selectedKitId: null,

  setBusy(busy) {
    set({ busy });
  },
  select(selectedKitId) {
    set({ selectedKitId });
  },
  receive(state) {
    switch (state.status) {
      case 'ready':
        set((current) => {
          const selected = state.kitId ?? current.selectedKitId;
          return {
            library: { status: 'ready', kits: state.kits, unreadableCount: state.unreadableCount },
            selectedKitId: state.kits.some((kit) => kit.id === selected) ? selected : null,
          };
        });
        return;
      case 'damaged':
        set({
          library: { status: 'damaged', message: state.message, canStartNew: state.canStartNew },
          selectedKitId: null,
        });
        return;
      case 'failed':
        set({ library: { status: 'failed', message: state.message }, selectedKitId: null });
        return;
    }
  },
  fail(message) {
    set({ library: { status: 'failed', message }, selectedKitId: null });
  },
}));

const NO_KITS: readonly SavedBrandKitSummary[] = [];

export function selectSavedKits(state: {
  readonly library: LibraryView;
}): readonly SavedBrandKitSummary[] {
  return state.library.status === 'ready' ? state.library.kits : NO_KITS;
}
