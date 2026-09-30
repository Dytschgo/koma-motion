/** Temporary interface state. Nothing in this store is saved with the project. */
import type { BrandKitRawDraft } from '@koma-motion/brand-kit';
import { clampZoom } from '@koma-motion/renderer';
import { create } from 'zustand';
import {
  clampChatWidth,
  parseChatPreferences,
  serializeChatPreferences,
  type ChatPreferences,
} from '../lib/chatLayout';
import { selectProject, useProjectStore } from './projectStore';

/** Key of the chat preferences in the local storage of the window. */
export const CHAT_PREFERENCES_KEY = 'koma-motion:chat';

/** The storage of the window, or nothing outside a window (unit tests). */
function getPreferenceStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

function loadChatPreferences(): ChatPreferences {
  try {
    return parseChatPreferences(getPreferenceStorage()?.getItem(CHAT_PREFERENCES_KEY) ?? null);
  } catch {
    return parseChatPreferences(null);
  }
}

function saveChatPreferences(preferences: ChatPreferences): void {
  try {
    getPreferenceStorage()?.setItem(CHAT_PREFERENCES_KEY, serializeChatPreferences(preferences));
  } catch {
    // The preferences are a convenience. Losing them must not break the interface.
  }
}

/**
 * Raw Brand Kit text for one open project. It is not saved. `projectId` stops
 * it applying to a different project. `reset()` drops it when the project is
 * replaced. A failed commit must not clear it; the editor removes a field
 * only after that field normalises and the control is no longer focused.
 */
export interface BrandKitDraftState {
  readonly projectId: string;
  readonly raw: BrandKitRawDraft;
}

const EMPTY_BRAND_KIT_RAW_DRAFT: BrandKitRawDraft = {};

/**
 * What the panel beside the canvas shows: the inspector or the Brand Kit.
 * The canvas and its controls stay visible either way.
 */
export type WorkspaceView = 'canvas' | 'brandKit';

/** The part of the Brand Kit panel that is shown. */
export type BrandKitTab = 'project' | 'library';

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

/**
 * The transition a preview is bound to. `fromKomaId` and `toKomaId` are the
 * ends recorded when it started. A new `token` starts playback again.
 * Progress stays in the playback hook; this store only keeps the identity.
 */
export interface PreviewIdentity {
  readonly transitionId: string;
  readonly fromKomaId: string;
  readonly toKomaId: string;
  readonly token: number;
}

interface UiState {
  readonly view: WorkspaceView;
  readonly brandKitTab: BrandKitTab;
  readonly selectedKomaId: string | null;
  readonly selectedElementId: string | null;
  /** `null` fits the canvas into the workspace. */
  readonly zoom: number | null;
  readonly settingsOpen: boolean;
  /** Chat sidebar. Kept across projects and restarts, never in the project. */
  readonly agentPanelOpen: boolean;
  /** The width the user chose for the chat sidebar. */
  readonly agentPanelWidth: number;
  readonly confirmation: ConfirmationRequest | null;
  readonly notices: readonly Notice[];
  readonly preview: PreviewIdentity | null;
  /** Raw Brand Kit text. Ignored when its project id is not the open project. */
  readonly brandKitDraft: BrandKitDraftState | null;

  readonly setView: (view: WorkspaceView) => void;
  readonly setBrandKitTab: (tab: BrandKitTab) => void;
  readonly selectKoma: (komaId: string | null) => void;
  readonly selectElement: (elementId: string | null) => void;
  readonly setZoom: (zoom: number | null) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  readonly setAgentPanelOpen: (open: boolean) => void;
  readonly setAgentPanelWidth: (width: number) => void;
  readonly confirm: (request: Omit<ConfirmationRequest, 'resolve'>) => Promise<boolean>;
  readonly answerConfirmation: (confirmed: boolean) => void;
  readonly notify: (kind: Notice['kind'], message: string) => void;
  readonly dismissNotice: (id: number) => void;
  readonly startPreview: (transitionId: string) => void;
  readonly stopPreview: () => void;
  readonly setBrandKitDraft: (projectId: string, raw: BrandKitRawDraft) => void;
  readonly reset: () => void;
}

/** Raw Brand Kit text for `projectId`, or nothing when the draft is for another project. */
export function selectBrandKitRawDraft(
  state: { readonly brandKitDraft: BrandKitDraftState | null },
  projectId: string,
): BrandKitRawDraft {
  const draft = state.brandKitDraft;
  if (draft === null || draft.projectId !== projectId) {
    return EMPTY_BRAND_KIT_RAW_DRAFT;
  }
  return draft.raw;
}

let nextToken = 1;

const initialChatPreferences = loadChatPreferences();

export const useUiStore = create<UiState>((set, get) => ({
  view: 'canvas',
  brandKitTab: 'project',
  selectedKomaId: null,
  selectedElementId: null,
  zoom: null,
  settingsOpen: false,
  agentPanelOpen: initialChatPreferences.open,
  agentPanelWidth: initialChatPreferences.width,
  confirmation: null,
  notices: [],
  preview: null,
  brandKitDraft: null,

  setView(view) {
    set({ view });
  },
  setBrandKitTab(brandKitTab) {
    set({ brandKitTab });
  },
  selectKoma(selectedKomaId) {
    set({ selectedKomaId, selectedElementId: null, preview: null });
  },
  selectElement(selectedElementId) {
    // Selecting an element asks for its properties, so the inspector replaces the Brand Kit.
    set(selectedElementId === null ? { selectedElementId } : { selectedElementId, view: 'canvas' });
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
  setAgentPanelWidth(width) {
    set({ agentPanelWidth: clampChatWidth(width) });
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
    const transition = selectProject(useProjectStore.getState())?.presentation.transitions.find(
      (candidate) => candidate.id === transitionId,
    );
    if (transition === undefined) {
      return;
    }
    set({
      preview: {
        transitionId: transition.id,
        fromKomaId: transition.fromKomaId,
        toKomaId: transition.toKomaId,
        token: nextToken++,
      },
      selectedElementId: null,
    });
  },
  stopPreview() {
    set({ preview: null });
  },
  setBrandKitDraft(projectId, raw) {
    set((state) =>
      state.brandKitDraft?.projectId === projectId && state.brandKitDraft.raw === raw
        ? state
        : { brandKitDraft: { projectId, raw } },
    );
  },
  reset() {
    get().confirmation?.resolve(false);
    set({
      confirmation: null,
      view: 'canvas',
      brandKitTab: 'project',
      selectedKomaId: null,
      selectedElementId: null,
      zoom: null,
      preview: null,
      brandKitDraft: null,
    });
  },
}));

useUiStore.subscribe((state, previous) => {
  if (
    state.agentPanelOpen !== previous.agentPanelOpen ||
    state.agentPanelWidth !== previous.agentPanelWidth
  ) {
    saveChatPreferences({ open: state.agentPanelOpen, width: state.agentPanelWidth });
  }
});
