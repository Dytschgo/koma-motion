/** Temporary interface state. Nothing in this store is saved with the project. */
import type { BrandKitRawDraft } from '@koma-motion/brand-kit';
import { clampZoom } from '@koma-motion/renderer';
import { create } from 'zustand';
import { DEFAULT_SETTINGS_PAGE, type SettingsPageId } from '../lib/settingsPages';
import { selectProject, useProjectStore } from './projectStore';

/** Key of the properties panel preference in the local storage of the window. */
export const PROPERTIES_PREFERENCES_KEY = 'koma-motion:properties';

/** The storage of the window, or nothing outside a window (unit tests). */
function getPreferenceStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Whether a stored preference pins the properties panel beside the canvas. */
export function parsePropertiesPinned(raw: string | null): boolean {
  if (raw === null) return false;
  try {
    const value: unknown = JSON.parse(raw);
    return typeof value === 'object' && value !== null && 'pinned' in value
      ? value.pinned === true
      : false;
  } catch {
    return false;
  }
}

function loadPropertiesPinned(): boolean {
  try {
    return parsePropertiesPinned(
      getPreferenceStorage()?.getItem(PROPERTIES_PREFERENCES_KEY) ?? null,
    );
  } catch {
    return false;
  }
}

function savePropertiesPinned(pinned: boolean): void {
  try {
    getPreferenceStorage()?.setItem(PROPERTIES_PREFERENCES_KEY, JSON.stringify({ pinned }));
  } catch {
    // The preference is a convenience. Losing it must not break the interface.
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
 * What the properties panel shows: the Inspector or the Brand Kit. The
 * canvas and its controls stay visible either way.
 */
export type WorkspaceView = 'canvas' | 'brandKit';

/**
 * The context the Inspector shows. Selection moves it: an element opens
 * `element`, clearing the selection returns to `koma`, and a preview opens
 * `motion`. The person can switch at any time.
 */
export type InspectorTab = 'element' | 'koma' | 'motion';

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
  readonly inspectorTab: InspectorTab;
  /** The properties panel (Inspector or Brand Kit) is shown. */
  readonly propertiesOpen: boolean;
  /** The properties panel is a column beside the canvas instead of a popover. Kept across restarts. */
  readonly propertiesPinned: boolean;
  /** The conversation sheet above the prompt is expanded. */
  readonly chatOpen: boolean;
  /**
   * The transition controls below the canvas are shown without a running
   * preview, because the person opened a motion marker or chose Motion.
   */
  readonly motionEditing: boolean;
  readonly selectedKomaId: string | null;
  readonly selectedElementId: string | null;
  /**
   * Every selected element of the selected Koma, in the order they were
   * selected. It contains `selectedElementId`, which the Inspector shows,
   * and more elements when the person adds them with Shift or Ctrl/Cmd.
   */
  readonly selectedElementIds: readonly string[];
  /** `null` fits the canvas into the workspace. */
  readonly zoom: number | null;
  readonly settingsOpen: boolean;
  readonly modelPickerRequest: number;
  readonly showModelPicker: () => void;
  /** Increases when a menu asks the PowerPoint export dialog to open. */
  readonly exportRequest: number;
  readonly requestExport: () => void;
  /** The page Settings shows. Kept while the window is open, so Settings reopens where it was. */
  readonly settingsPage: SettingsPageId;
  readonly confirmation: ConfirmationRequest | null;
  readonly notices: readonly Notice[];
  readonly preview: PreviewIdentity | null;
  /** Raw Brand Kit text. Ignored when its project id is not the open project. */
  readonly brandKitDraft: BrandKitDraftState | null;
  /** A request to put into the chat composer, for example from a starter. Taken once. */
  readonly composerSeed: ComposerSeed | null;

  readonly setView: (view: WorkspaceView) => void;
  readonly setBrandKitTab: (tab: BrandKitTab) => void;
  readonly setInspectorTab: (tab: InspectorTab) => void;
  readonly setPropertiesOpen: (open: boolean) => void;
  readonly setPropertiesPinned: (pinned: boolean) => void;
  readonly setChatOpen: (open: boolean) => void;
  /** Shows the transition controls of the selected Koma's motion, or hides them and stops a preview. */
  readonly setMotionEditing: (editing: boolean) => void;
  readonly selectKoma: (komaId: string | null) => void;
  readonly selectElement: (elementId: string | null) => void;
  /** Adds an element to the selection, or removes it when it is already selected. */
  readonly toggleElementSelection: (elementId: string) => void;
  /** Selects several elements; the last one is shown in the Inspector. */
  readonly selectElements: (elementIds: readonly string[]) => void;
  /** Opens properties for the current Koma or element. */
  readonly inspectSelection: (tab?: InspectorTab) => void;
  readonly setZoom: (zoom: number | null) => void;
  readonly setSettingsOpen: (open: boolean) => void;
  /** Opens Settings, on `page` when given. */
  readonly openSettings: (page?: SettingsPageId) => void;
  readonly setSettingsPage: (page: SettingsPageId) => void;
  readonly confirm: (request: Omit<ConfirmationRequest, 'resolve'>) => Promise<boolean>;
  readonly answerConfirmation: (confirmed: boolean) => void;
  readonly notify: (kind: Notice['kind'], message: string) => void;
  readonly dismissNotice: (id: number) => void;
  readonly startPreview: (transitionId: string) => void;
  readonly stopPreview: () => void;
  readonly setBrandKitDraft: (projectId: string, raw: BrandKitRawDraft) => void;
  readonly seedComposer: (seed: ComposerSeed | null) => void;
  readonly reset: () => void;
}

export interface ComposerSeed {
  readonly request: string;
  readonly komaCount: number;
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

export const useUiStore = create<UiState>((set, get) => ({
  view: 'canvas',
  brandKitTab: 'project',
  inspectorTab: 'koma',
  propertiesOpen: false,
  propertiesPinned: loadPropertiesPinned(),
  chatOpen: false,
  motionEditing: false,
  selectedKomaId: null,
  selectedElementId: null,
  selectedElementIds: [],
  zoom: null,
  settingsOpen: false,
  modelPickerRequest: 0,
  showModelPicker() {
    set((state) => ({
      settingsOpen: false,
      modelPickerRequest: state.modelPickerRequest + 1,
    }));
  },
  exportRequest: 0,
  requestExport() {
    set((state) => ({ exportRequest: state.exportRequest + 1 }));
  },
  settingsPage: DEFAULT_SETTINGS_PAGE,
  confirmation: null,
  notices: [],
  preview: null,
  brandKitDraft: null,
  composerSeed: null,

  setView(view) {
    set(view === 'brandKit' ? { view, propertiesOpen: true } : { view });
  },
  setBrandKitTab(brandKitTab) {
    set({ brandKitTab });
  },
  setInspectorTab(inspectorTab) {
    set({ inspectorTab });
  },
  setPropertiesOpen(propertiesOpen) {
    set(propertiesOpen ? { propertiesOpen } : { propertiesOpen, view: 'canvas' });
  },
  setPropertiesPinned(propertiesPinned) {
    savePropertiesPinned(propertiesPinned);
    set({ propertiesPinned, propertiesOpen: true });
  },
  setChatOpen(chatOpen) {
    set({ chatOpen });
  },
  setMotionEditing(motionEditing) {
    set(motionEditing ? { motionEditing } : { motionEditing, preview: null });
  },
  selectKoma(selectedKomaId) {
    set((state) => ({
      selectedKomaId,
      selectedElementId: null,
      selectedElementIds: [],
      preview: null,
      inspectorTab: state.inspectorTab === 'element' ? 'koma' : state.inspectorTab,
    }));
  },
  selectElement(selectedElementId) {
    // Selecting an element shows its toolbar on the canvas. An open properties
    // panel follows the selection; a closed one stays closed.
    set((state) =>
      selectedElementId === null
        ? {
            selectedElementId,
            selectedElementIds: [],
            inspectorTab: state.inspectorTab === 'element' ? 'koma' : state.inspectorTab,
          }
        : {
            selectedElementId,
            selectedElementIds: [selectedElementId],
            view: 'canvas',
            inspectorTab: 'element',
          },
    );
  },
  toggleElementSelection(elementId) {
    const { selectedElementIds, selectElement, selectElements } = get();
    if (!selectedElementIds.includes(elementId)) {
      selectElements([...selectedElementIds, elementId]);
      return;
    }
    const remaining = selectedElementIds.filter((id) => id !== elementId);
    if (remaining.length === 0) selectElement(null);
    else selectElements(remaining);
  },
  selectElements(elementIds) {
    const unique = [...new Set(elementIds)];
    const primary = unique.at(-1);
    if (primary === undefined) {
      get().selectElement(null);
      return;
    }
    set({
      selectedElementId: primary,
      selectedElementIds: unique,
      view: 'canvas',
      inspectorTab: 'element',
    });
  },
  setZoom(zoom) {
    set({ zoom: zoom === null ? null : clampZoom(zoom) });
  },
  inspectSelection(tab) {
    if (get().selectedKomaId === null) return;
    set((state) => ({
      view: 'canvas',
      inspectorTab: tab ?? (state.selectedElementId === null ? 'koma' : 'element'),
      propertiesOpen: true,
    }));
  },
  setSettingsOpen(settingsOpen) {
    set({ settingsOpen });
  },
  openSettings(page) {
    set((state) => ({ settingsOpen: true, settingsPage: page ?? state.settingsPage }));
  },
  setSettingsPage(settingsPage) {
    set({ settingsPage });
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
      selectedElementIds: [],
      inspectorTab: 'motion',
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
  seedComposer(composerSeed) {
    set({ composerSeed });
  },
  reset() {
    get().confirmation?.resolve(false);
    set({
      confirmation: null,
      view: 'canvas',
      brandKitTab: 'project',
      inspectorTab: 'koma',
      propertiesOpen: false,
      chatOpen: false,
      motionEditing: false,
      selectedKomaId: null,
      selectedElementId: null,
      selectedElementIds: [],
      zoom: null,
      preview: null,
      brandKitDraft: null,
      composerSeed: null,
    });
  },
}));
