/** Recovery and panel state are temporary; they never enter document history. */
import { create } from 'zustand';

export interface OpenFailure {
  readonly message: string;
  readonly diagnostics: string;
}
export const useHealthStore = create<{
  open: boolean;
  failure: OpenFailure | null;
  setOpen: (open: boolean) => void;
  failOpen: (failure: OpenFailure) => void;
  clearFailure: () => void;
}>((set) => ({
  open: false,
  failure: null,
  setOpen: (open) => set({ open }),
  failOpen: (failure) => set({ failure, open: true }),
  clearFailure: () => set({ failure: null }),
}));
