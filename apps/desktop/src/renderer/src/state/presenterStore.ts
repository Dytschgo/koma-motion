/**
 * The presentation player: which Koma is shown, which step plays and what the
 * presenter agreed to. Nothing here is saved with the project.
 *
 * The session names Komas and transitions by id and is checked against the
 * project after every change, so an edit, a deletion or a reorder never
 * leaves the player on a Koma or a transition that no longer exists.
 */
import type { Presentation } from '@koma-motion/core';
import { create } from 'zustand';
import {
  getPresentationStep,
  resolvePlayingStep,
  resolvePresenterKoma,
  reviewPresentation,
} from '../lib/presentationPlan';
import { selectProject, useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';

/** Where a presentation starts. */
export type PresentationStart = 'beginning' | 'selected';

/** A transition that is playing. A new `token` starts it again from the beginning. */
export interface PresenterMotion {
  readonly transitionId: string;
  readonly fromKomaId: string;
  readonly toKomaId: string;
  readonly token: number;
}

export interface PresenterSession {
  /** The project session the presentation belongs to. Opening another project ends it. */
  readonly projectSessionId: number;
  /** `review` lists the steps that cannot play before anything plays. */
  readonly phase: 'review' | 'playing';
  readonly startIndex: number;
  /** The Koma at rest, or the source Koma while `motion` plays. */
  readonly komaId: string;
  /** Where `komaId` was last seen, to find its place after it is deleted. */
  readonly komaIndex: number;
  readonly motion: PresenterMotion | null;
  /** Steps, by key, the presenter chose to cut across. */
  readonly acceptedCuts: readonly string[];
  /** A step that cannot play and was reached without a choice. Playback waits for one. */
  readonly halted: string | null;
  readonly paused: boolean;
}

export const MIN_AUTOPLAY_DELAY_MS = 1000;
export const MAX_AUTOPLAY_DELAY_MS = 60_000;
export const DEFAULT_AUTOPLAY_DELAY_MS = 5000;

interface PresenterState {
  readonly session: PresenterSession | null;
  /**
   * Advance on a timer. Off by default: Komas have no stored display time,
   * so a presentation advances when the presenter asks, as with a click in
   * PowerPoint. Kept for this window, not in the project.
   */
  readonly autoplay: boolean;
  /** How long each Koma stays at rest before autoplay moves on. */
  readonly autoplayDelayMs: number;
  /** Whether the window is full screen, as last reported by the main process. */
  readonly fullScreen: boolean;

  /** Returns false when there is nothing to present. */
  readonly start: (from: PresentationStart) => boolean;
  /** Leaves the review and plays, cutting across exactly the steps in `keys`. */
  readonly continueWithCuts: (keys: readonly string[]) => void;
  /** Ends the presentation and shows `komaId` in the editor. */
  readonly returnToEdit: (komaId: string | null) => void;
  readonly next: () => void;
  readonly previous: () => void;
  readonly first: () => void;
  readonly last: () => void;
  /** Plays the transition into the current Koma again. */
  readonly replay: () => void;
  readonly togglePause: () => void;
  /** Cuts across the step playback halted at. */
  readonly cutAcross: () => void;
  readonly finishMotion: (token: number) => void;
  readonly exit: () => void;
  /** Checks the session against the project. Called after every project change. */
  readonly reconcile: () => void;
  readonly setAutoplay: (autoplay: boolean) => void;
  readonly setAutoplayDelay: (milliseconds: number) => void;
  readonly setFullScreen: (fullScreen: boolean) => void;
}

let nextToken = 1;

function currentPresentation(): Presentation | null {
  return selectProject(useProjectStore.getState())?.presentation ?? null;
}

export const usePresenterStore = create<PresenterState>((set, get) => {
  /** Applies `change` to the session while it plays. */
  const update = (
    change: (session: PresenterSession, presentation: Presentation) => PresenterSession | null,
  ): void => {
    const { session } = get();
    const presentation = currentPresentation();
    if (session === null || presentation === null || session.phase !== 'playing') {
      return;
    }
    const changed = change(session, presentation);
    if (changed !== null && changed !== session) {
      set({ session: changed });
    }
  };

  /** The session at rest on the Koma at `index`. */
  const restAt = (
    session: PresenterSession,
    presentation: Presentation,
    index: number,
  ): PresenterSession | null => {
    const koma = presentation.komas[index];
    return koma === undefined
      ? null
      : { ...session, komaId: koma.id, komaIndex: index, motion: null, halted: null };
  };

  return {
    session: null,
    autoplay: false,
    autoplayDelayMs: DEFAULT_AUTOPLAY_DELAY_MS,
    fullScreen: false,

    start(from) {
      const project = selectProject(useProjectStore.getState());
      const ui = useUiStore.getState();
      if (project === null || project.presentation.komas.length === 0) {
        ui.notify('info', 'There is nothing to present yet. Add a Koma first.');
        return false;
      }
      const { komas } = project.presentation;
      const selected = komas.findIndex((koma) => koma.id === ui.selectedKomaId);
      const startIndex = from === 'beginning' ? 0 : Math.max(0, selected);
      const start = komas[startIndex];
      if (start === undefined) {
        return false;
      }
      const review = reviewPresentation(project.presentation, startIndex);
      // Presentation and the single-transition preview never run together.
      ui.stopPreview();
      set({
        session: {
          projectSessionId: useProjectStore.getState().sessionId,
          phase: review.problems.length + review.notes.length > 0 ? 'review' : 'playing',
          startIndex,
          komaId: start.id,
          komaIndex: startIndex,
          motion: null,
          acceptedCuts: [],
          halted: null,
          paused: false,
        },
      });
      return true;
    },

    continueWithCuts(keys) {
      const { session } = get();
      if (session?.phase !== 'review') {
        return;
      }
      set({ session: { ...session, phase: 'playing', acceptedCuts: [...keys] } });
    },

    returnToEdit(komaId) {
      set({ session: null });
      const ui = useUiStore.getState();
      ui.setView('canvas');
      if (komaId !== null) {
        ui.selectKoma(komaId);
      }
    },

    next() {
      update((session, presentation) => {
        if (session.motion !== null) {
          // As with a click during a slide transition: arrive now.
          const toIndex = presentation.komas.findIndex(
            (koma) => koma.id === session.motion?.toKomaId,
          );
          return restAt({ ...session, paused: false }, presentation, toIndex);
        }
        if (session.halted !== null) {
          // Waiting for a choice about a step that cannot play.
          return session;
        }
        const here = resolvePresenterKoma(presentation, session.komaId, session.komaIndex);
        const step = here === null ? null : getPresentationStep(presentation, here.index);
        if (here === null || step === null) {
          return session;
        }
        if (step.kind === 'motion') {
          return {
            ...session,
            paused: false,
            motion: {
              transitionId: step.transition.id,
              fromKomaId: step.from.id,
              toKomaId: step.to.id,
              token: nextToken++,
            },
          };
        }
        if (session.acceptedCuts.includes(step.problem.key)) {
          return restAt({ ...session, paused: false }, presentation, here.index + 1);
        }
        return { ...session, halted: step.problem.key };
      });
    },

    previous() {
      update((session, presentation) => {
        if (session.motion !== null || session.halted !== null) {
          // Back to the Koma the step started from.
          return { ...session, motion: null, halted: null, paused: false };
        }
        const here = resolvePresenterKoma(presentation, session.komaId, session.komaIndex);
        return here === null || here.index === 0
          ? session
          : restAt({ ...session, paused: false }, presentation, here.index - 1);
      });
    },

    first() {
      update((session, presentation) => restAt({ ...session, paused: false }, presentation, 0));
    },

    last() {
      update((session, presentation) =>
        restAt({ ...session, paused: false }, presentation, presentation.komas.length - 1),
      );
    },

    replay() {
      update((session, presentation) => {
        if (session.motion !== null) {
          return { ...session, paused: false, motion: { ...session.motion, token: nextToken++ } };
        }
        const here = resolvePresenterKoma(presentation, session.komaId, session.komaIndex);
        const step = here === null ? null : getPresentationStep(presentation, here.index - 1);
        if (here === null || step?.kind !== 'motion') {
          return session;
        }
        return {
          ...session,
          komaId: step.from.id,
          komaIndex: here.index - 1,
          halted: null,
          paused: false,
          motion: {
            transitionId: step.transition.id,
            fromKomaId: step.from.id,
            toKomaId: step.to.id,
            token: nextToken++,
          },
        };
      });
    },

    togglePause() {
      update((session) => ({ ...session, paused: !session.paused }));
    },

    cutAcross() {
      update((session, presentation) => {
        const here = resolvePresenterKoma(presentation, session.komaId, session.komaIndex);
        const step = here === null ? null : getPresentationStep(presentation, here.index);
        if (here === null || step?.kind !== 'problem' || step.problem.key !== session.halted) {
          return { ...session, halted: null };
        }
        return restAt(
          { ...session, acceptedCuts: [...session.acceptedCuts, step.problem.key] },
          presentation,
          here.index + 1,
        );
      });
    },

    finishMotion(token) {
      update((session, presentation) => {
        if (session.motion?.token !== token) {
          return session;
        }
        const toIndex = presentation.komas.findIndex(
          (koma) => koma.id === session.motion?.toKomaId,
        );
        return restAt(session, presentation, toIndex);
      });
    },

    exit() {
      set({ session: null });
    },

    reconcile() {
      const { session } = get();
      if (session === null) {
        return;
      }
      const projectState = useProjectStore.getState();
      const presentation = currentPresentation();
      if (presentation === null || projectState.sessionId !== session.projectSessionId) {
        set({ session: null });
        return;
      }
      if (presentation.komas.length === 0) {
        set({ session: null });
        useUiStore.getState().notify('info', 'The presentation ended because it has no Komas.');
        return;
      }
      let next = session;
      // A transition that changed so that it may not play is stopped where it
      // started, never finished by a cut nobody chose.
      if (next.motion !== null && resolvePlayingStep(presentation, next.motion) === null) {
        next = { ...next, motion: null };
      }
      const here = resolvePresenterKoma(presentation, next.komaId, next.komaIndex);
      if (here === null) {
        set({ session: null });
        return;
      }
      if (here.koma.id !== next.komaId || here.index !== next.komaIndex) {
        next = { ...next, komaId: here.koma.id, komaIndex: here.index, motion: null };
      }
      if (next.halted !== null) {
        const step = getPresentationStep(presentation, here.index);
        if (step?.kind !== 'problem' || step.problem.key !== next.halted) {
          next = { ...next, halted: null };
        }
      }
      if (next.startIndex >= presentation.komas.length) {
        next = { ...next, startIndex: presentation.komas.length - 1 };
      }
      if (next !== session) {
        set({ session: next });
      }
    },

    setAutoplay(autoplay) {
      set({ autoplay });
    },

    setAutoplayDelay(milliseconds) {
      set({
        autoplayDelayMs: Math.min(
          MAX_AUTOPLAY_DELAY_MS,
          Math.max(MIN_AUTOPLAY_DELAY_MS, Math.round(milliseconds)),
        ),
      });
    },

    setFullScreen(fullScreen) {
      set({ fullScreen });
    },
  };
});

useProjectStore.subscribe(() => {
  usePresenterStore.getState().reconcile();
});
