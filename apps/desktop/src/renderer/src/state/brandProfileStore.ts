import { create } from 'zustand';
import type { BrandProfileProgress, PreparedMaterial } from '../../../shared/brandProfile';

interface BrandProfileState {
  /** The project session the material was attached in. It is ignored in any other. */
  readonly projectSession: number | null;
  /** Identifies the draft in the main process. */
  readonly draftId: string | null;
  readonly material: PreparedMaterial | null;
  readonly attaching: boolean;
  readonly progress: BrandProfileProgress | null;
  readonly error: string | null;
  /** The disclosure and review dialog. */
  readonly dialogOpen: boolean;
  readonly begin: (projectSession: number, draftId: string) => void;
  readonly setMaterial: (material: PreparedMaterial) => void;
  readonly setAttaching: (attaching: boolean) => void;
  readonly setProgress: (progress: BrandProfileProgress | null) => void;
  readonly setError: (error: string | null) => void;
  readonly setDialogOpen: (open: boolean) => void;
  readonly clear: () => void;
}

const EMPTY = {
  projectSession: null,
  draftId: null,
  material: null,
  attaching: false,
  progress: null,
  error: null,
  dialogOpen: false,
} as const;

/** Attached brand material is session-only: never part of the project or of local storage. */
export const useBrandProfileStore = create<BrandProfileState>((set) => ({
  ...EMPTY,
  begin: (projectSession, draftId) => set({ ...EMPTY, projectSession, draftId }),
  setMaterial: (material) => set({ material, error: null }),
  setAttaching: (attaching) => set({ attaching }),
  setProgress: (progress) => set({ progress }),
  setError: (error) => set({ error }),
  setDialogOpen: (dialogOpen) => set({ dialogOpen }),
  clear: () => set({ ...EMPTY }),
}));
