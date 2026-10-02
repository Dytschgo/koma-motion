import type { Presentation } from '@koma-motion/core';
import { buildProject } from '@koma-motion/core/testing';
import { afterEach, describe, expect, it } from 'vitest';
import { buildDeck, makeStale } from '../lib/presentationDeck.fixture';
import { stepKey } from '../lib/presentationPlan';
import { deleteKoma, reorderKoma, type ProjectCommand } from './commands';
import {
  DEFAULT_AUTOPLAY_DELAY_MS,
  MAX_AUTOPLAY_DELAY_MS,
  MIN_AUTOPLAY_DELAY_MS,
  usePresenterStore,
} from './presenterStore';
import { useProjectStore } from './projectStore';
import { useUiStore } from './uiStore';

function load(presentation: Presentation): void {
  useProjectStore.getState().load(buildProject({ presentation }), null);
}

function presenter() {
  return usePresenterStore.getState();
}

function session() {
  const current = presenter().session;
  if (current === null) throw new Error('Expected a presentation');
  return current;
}

/** Replaces the presentation without rebuilding motion, as an opened file can. */
function replacePresentation(presentation: Presentation): ProjectCommand {
  return (project) => ({ ...project, presentation });
}

function apply(command: ProjectCommand): void {
  useProjectStore.getState().apply(command);
}

afterEach(() => {
  usePresenterStore.setState({
    session: null,
    autoplay: false,
    autoplayDelayMs: DEFAULT_AUTOPLAY_DELAY_MS,
    fullScreen: false,
  });
  useUiStore.getState().reset();
  useUiStore.setState({ notices: [] });
  useProjectStore.setState({ history: null, file: null, savedProject: null, loadWarnings: [] });
});

describe('starting a presentation', () => {
  it('starts from the beginning or from the selected Koma and stops a preview', () => {
    load(buildDeck(3));
    useUiStore.getState().selectKoma('koma-2');
    const [transition] = useProjectStore.getState().history?.present.presentation.transitions ?? [];
    useUiStore.getState().startPreview(transition?.id ?? '');
    expect(useUiStore.getState().preview).not.toBeNull();

    expect(presenter().start('selected')).toBe(true);
    expect(session()).toMatchObject({ phase: 'playing', komaId: 'koma-2', startIndex: 1 });
    expect(useUiStore.getState().preview).toBeNull();

    presenter().exit();
    presenter().start('beginning');
    expect(session()).toMatchObject({ komaId: 'koma-1', startIndex: 0 });
  });

  it('refuses an empty presentation and says why', () => {
    load({ ...buildDeck(1), komas: [], transitions: [] });
    expect(presenter().start('beginning')).toBe(false);
    expect(presenter().session).toBeNull();
    expect(useUiStore.getState().notices.at(-1)?.message).toContain('nothing to present');
  });

  it('reviews problems first and cuts across exactly the accepted steps', () => {
    load(makeStale(buildDeck(3), 1));
    presenter().start('beginning');
    expect(session().phase).toBe('review');
    // Nothing moves before the presenter chooses.
    presenter().next();
    expect(session().komaId).toBe('koma-1');

    presenter().continueWithCuts([stepKey('koma-1', 'koma-2')]);
    presenter().next();
    expect(session()).toMatchObject({ komaId: 'koma-2', motion: null, halted: null });
    // The second stale step was not accepted, so playback waits.
    presenter().next();
    expect(session()).toMatchObject({ komaId: 'koma-2', halted: stepKey('koma-2', 'koma-3') });
    presenter().next();
    expect(session().komaId).toBe('koma-2');
    presenter().cutAcross();
    expect(session()).toMatchObject({ komaId: 'koma-3', halted: null });
  });

  it('returns to edit on the Koma that leaves the problem', () => {
    load(makeStale(buildDeck(3), 2));
    presenter().start('beginning');
    presenter().returnToEdit('koma-2');
    expect(presenter().session).toBeNull();
    expect(useUiStore.getState().selectedKomaId).toBe('koma-2');
  });
});

describe('playing', () => {
  it('plays motion, arrives on Next and ignores the end of an older run', () => {
    load(buildDeck(3));
    presenter().start('beginning');
    presenter().next();
    const motion = session().motion;
    expect(motion).toMatchObject({ fromKomaId: 'koma-1', toKomaId: 'koma-2' });
    if (motion === null) return;

    presenter().replay();
    presenter().finishMotion(motion.token);
    expect(session().motion).not.toBeNull();
    presenter().next();
    expect(session()).toMatchObject({ komaId: 'koma-2', motion: null });

    presenter().next();
    const second = session().motion;
    if (second === null) throw new Error('Expected motion');
    presenter().finishMotion(second.token);
    expect(session()).toMatchObject({ komaId: 'koma-3', motion: null });
    // The end of the presentation.
    presenter().next();
    expect(session()).toMatchObject({ komaId: 'koma-3', motion: null });
  });

  it('goes back without motion, cancels a step and replays the way in', () => {
    load(buildDeck(3));
    useUiStore.getState().selectKoma('koma-3');
    presenter().start('selected');
    presenter().previous();
    expect(session().komaId).toBe('koma-2');
    presenter().next();
    presenter().previous();
    expect(session()).toMatchObject({ komaId: 'koma-2', motion: null });

    presenter().replay();
    expect(session()).toMatchObject({
      komaId: 'koma-1',
      motion: { fromKomaId: 'koma-1', toKomaId: 'koma-2' },
    });
    presenter().first();
    expect(session()).toMatchObject({ komaId: 'koma-1', motion: null });
    presenter().replay();
    expect(session().motion).toBeNull();
    presenter().last();
    expect(session().komaId).toBe('koma-3');
  });

  it('pauses and resumes; navigation resumes', () => {
    load(buildDeck(2));
    presenter().start('beginning');
    presenter().next();
    presenter().togglePause();
    expect(session().paused).toBe(true);
    presenter().togglePause();
    expect(session().paused).toBe(false);
    presenter().togglePause();
    presenter().previous();
    expect(session().paused).toBe(false);
  });

  it('keeps the autoplay delay within its limits', () => {
    presenter().setAutoplayDelay(10);
    expect(presenter().autoplayDelayMs).toBe(MIN_AUTOPLAY_DELAY_MS);
    presenter().setAutoplayDelay(10 * 60_000);
    expect(presenter().autoplayDelayMs).toBe(MAX_AUTOPLAY_DELAY_MS);
  });
});

describe('changes during a presentation', () => {
  it('stops a step whose transition went stale, on its source Koma, and halts on Next', () => {
    const deck = buildDeck(3);
    load(deck);
    presenter().start('beginning');
    presenter().next();
    expect(session().motion).not.toBeNull();

    apply(replacePresentation(makeStale(deck, 1)));
    expect(session()).toMatchObject({ komaId: 'koma-1', motion: null });
    presenter().next();
    expect(session()).toMatchObject({ komaId: 'koma-1', halted: stepKey('koma-1', 'koma-2') });

    // Repairing it clears the prompt; the next Next plays the motion.
    useProjectStore.getState().undo();
    expect(session().halted).toBeNull();
    presenter().next();
    expect(session().motion).toMatchObject({ fromKomaId: 'koma-1', toKomaId: 'koma-2' });
  });

  it('cancels motion when a reorder separates its Komas', () => {
    load(buildDeck(3));
    presenter().start('beginning');
    presenter().next();
    apply(reorderKoma('koma-2', 1));
    expect(session()).toMatchObject({ komaId: 'koma-1', motion: null });
  });

  it('moves to the Koma that takes the place of a deleted one', () => {
    load(buildDeck(3));
    useUiStore.getState().selectKoma('koma-2');
    presenter().start('selected');
    apply(deleteKoma('koma-2'));
    expect(session()).toMatchObject({ komaId: 'koma-3', komaIndex: 1 });
    apply(deleteKoma('koma-3'));
    expect(session()).toMatchObject({ komaId: 'koma-1', komaIndex: 0 });
  });

  it('cancels motion whose source or target was deleted', () => {
    load(buildDeck(3));
    presenter().start('beginning');
    presenter().next();
    apply(deleteKoma('koma-2'));
    expect(session()).toMatchObject({ komaId: 'koma-1', motion: null });
  });

  it('ends when the last Koma is deleted or another project opens', () => {
    load(buildDeck(1));
    presenter().start('beginning');
    apply(deleteKoma('koma-1'));
    expect(presenter().session).toBeNull();
    expect(useUiStore.getState().notices.at(-1)?.message).toContain('no Komas');

    load(buildDeck(2));
    presenter().start('beginning');
    load(buildDeck(2));
    expect(presenter().session).toBeNull();
  });

  it('keeps the review start inside a shorter deck', () => {
    load(makeStale(buildDeck(3), 2));
    useUiStore.getState().selectKoma('koma-3');
    presenter().start('selected');
    apply(deleteKoma('koma-3'));
    expect(session()).toMatchObject({ startIndex: 1, komaId: 'koma-2' });
  });
});
