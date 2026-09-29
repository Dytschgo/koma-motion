/** Temporary interface state. Nothing in this store is saved with the project. */
import { clampZoom } from '@koma-motion/renderer';
import { create } from 'zustand';

export type WorkspaceView = 'canvas' | 'brandKit';

export interface ConfirmationRequest {
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Marks actions that lose data. */
  readonly destructive: boolean;
  readonly resolve: (confirmed: boolean) => void;
}

export interface Notice {
  readonly id: number;
  readonly kind: 'error' | 'info';
  readonly message: string;
}

interface UiState {
  readonly view: WorkspaceView;
  readonly selectedKomaId: string | null;
  readonly selectedElementId: string | null;
  /** `null` fits the canvas into the workspace. */
  readonly zoom: number | null;
  readonly settingsOpen: boolean;
  readonly agentPanelOpen: boolean;
  readonly confirmation: ConfirmationRequest | null;
  readonly notices: readonly Notice[];
  /** The transition that is being previewed. A new `token` starts it again. */
  readonly preview: { readonly transitionId: string; readonly token: number } | null;

  readonly setView: (view: WorkspaceView) => void;
  readonly selectKoma: (komaId: string | null) => void;
  readonly selectElement: (elementId: string | null) => void;
  readonly setZoom: (zoom: number | null) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly setAgentPanelOpen: (open: boolean) => void;
  readonly confirm: (request: Omit<ConfirmationRequest, 'resolve'>) => Promise<boolean>;
  readonly answerConfirmation: (confirmed: boolean) => void;
  readonly notify: (kind: Notice['kind'], message: string) => void;
  readonly dismissNotice: (id: number) => void;
  readonly startPreview: (transitionId: string) => void;
  readonly stopPreview: () => void;
  readonly reset: () => void;
}

let nextToken = 1;

export const useUiStore = create<UiState>((set, get) => ({
  view: 'canvas',
  selectedKomaId: null,
  selectedElementId: null,
  zoom: null,
  settingsOpen: false,
  agentPanelOpen: true,
  confirmation: null,
  notices: [],
  preview: null,

  setView(view) {
    set({ view, preview: null });
  },
  selectKoma(selectedKomaId) {
    set({ selectedKomaId, selectedElementId: null, preview: null, view: 'canvas' });
  },
  selectElement(selectedElementId) {
    set({ selectedElementId });
  },
  setZoom(zoom) {
    set({ zoom: zoom === null ? null : clampZoom(zoom) });
  },
  setSettingsOpen(settingsOpen) {
    set({ settingsOpen });
  },
  setAgentPanelOpen(agentPanelOpen) {
    set({ agentPanelOpen });
  },
  confirm(request) {
    get().confirmation?.resolve(false);
    return new Promise((resolve) => {
      set({ confirmation: { ...request, resolve } });
    });
  },
  answerConfirmation(confirmed) {
    get().confirmation?.resolve(confirmed);
    set({ confirmation: null });
  },
  notify(kind, message) {
    set((state) => ({
      notices: [...state.notices, { id: nextToken++, kind, message }].slice(-4),
    }));
  },
  dismissNotice(id) {
    set((state) => ({ notices: state.notices.filter((notice) => notice.id !== id) }));
  },
  startPreview(transitionId) {
    set({ preview: { transitionId, token: nextToken++ }, view: 'canvas', selectedElementId: null });
  },
  stopPreview() {
    set({ preview: null });
  },
  reset() {
    set({
      view: 'canvas',
      selectedKomaId: null,
      selectedElementId: null,
      zoom: null,
      preview: null,
    });
  },
}));
