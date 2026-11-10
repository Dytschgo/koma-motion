// @vitest-environment jsdom
import { MAX_SYSTEM_INSTRUCTIONS_LENGTH } from '@koma-motion/core';
import { buildBrandKit, buildProject } from '@koma-motion/core/testing';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { PreparedMaterial } from '../../../shared/brandProfile';
import {
  API_KEY,
  type IpcChannel,
  type IpcResponse,
  type KomaMotionBridge,
} from '../../../shared/ipc';
import { useAgentStore } from '../state/agentStore';
import { useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { selectCanUndo, selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { BrandProfileDialog } from './BrandProfileDialog';

const SESSION = '2f1c7d3e-8a4b-4c6d-9e0f-1a2b3c4d5e6f';
const DECK_LOGO = `logo-${'a'.repeat(32)}`;
const IMAGE_LOGO = `logo-${'b'.repeat(32)}`;
const pixel = { mediaType: 'image/png', preview: 'AAAA' } as const;

const material: PreparedMaterial = {
  sessionId: SESSION,
  files: [
    { file: 1, name: 'deck.pptx', kind: 'pptx', total: 12 },
    { file: 2, name: 'mark.png', kind: 'image', total: 1 },
  ],
  exhibits: [
    { number: 1, file: 1, kind: 'slide', page: 1, text: 'Northstar annual review', ...pixel },
    { number: 2, file: 1, kind: 'slide', page: 4, text: '', ...pixel },
    { number: 3, file: 2, kind: 'image', page: null, text: '', ...pixel },
  ],
  logos: [
    {
      id: DECK_LOGO,
      file: 1,
      exhibits: [2],
      image: { name: 'deck-logo.png', mediaType: 'image/png', data: 'AAAA' },
    },
    {
      id: IMAGE_LOGO,
      file: 2,
      exhibits: [3],
      image: { name: 'mark.png', mediaType: 'image/png', data: 'AAAA' },
    },
  ],
  warnings: ['Only 2 of the 12 slides of deck.pptx were prepared.'],
};

const available: IpcResponse<'koma:deck:capabilities'> = {
  allowMock: true,
  claude: {
    providerId: 'claude-code',
    availability: 'available',
    version: '2.1.0',
    message: 'Claude Code 2.1.0 is ready.',
    checkedAt: '2026-10-01T12:00:00.000Z',
  },
};

const proposed: Extract<IpcResponse<'koma:brand-profile:analyze'>, { status: 'proposed' }> = {
  status: 'proposed',
  proposal: {
    brandKit: { ...buildBrandKit({ name: 'Northstar' }), logoAssetId: null },
    instructions: 'Use short sentences.',
    logoCandidateId: null,
    evidence: [
      { field: 'colours', exhibits: [2], observation: 'Orange leads.', confidence: 'high' },
      { field: 'typography', exhibits: [3], observation: 'Looks like a serif.', confidence: 'low' },
    ],
    warnings: ['Two slides were hard to read.'],
  },
  fontsNamedInMaterial: false,
  analyzedAt: '2026-10-01T12:00:00.000Z',
  provider: 'mock',
  model: 'mock',
};

const emptyLibrary: IpcResponse<'koma:brand-profile:save'> = {
  status: 'ready',
  kits: [],
  unreadableCount: 0,
  kitId: null,
};

/** What the main process answers, per channel. A channel without an answer rejects. */
let answers: Partial<Record<IpcChannel, (request: unknown) => unknown>>;
let requests: { readonly channel: IpcChannel; readonly request: unknown }[];
const listeners = new Set<(payload: unknown) => void>();
const onClose = vi.fn();
const onFinished = vi.fn();

const bridge: KomaMotionBridge = {
  invoke(channel, request) {
    requests.push({ channel, request });
    const answer = answers[channel];
    return answer === undefined
      ? Promise.reject(new Error(`No answer for ${channel}.`))
      : Promise.resolve().then(() => answer(request));
  },
  subscribe(_channel, listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

const sent = (channel: IpcChannel) =>
  requests.filter((entry) => entry.channel === channel).map((entry) => entry.request);
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const notices = () => useUiStore.getState().notices.map((notice) => notice.message);

function open() {
  const user = userEvent.setup({ delay: null });
  render(
    <BrandProfileDialog
      material={material}
      projectSession={useProjectStore.getState().sessionId}
      onClose={onClose}
      onFinished={onFinished}
    />,
  );
  return user;
}

/** Opens the dialog and runs the mock analysis through to the review. */
async function review(response: IpcResponse<'koma:brand-profile:analyze'> = proposed) {
  answers['koma:brand-profile:analyze'] = () => response;
  const user = open();
  await waitFor(() => expect(button('Send listed content and analyze').disabled).toBe(false));
  await user.click(button('Send listed content and analyze'));
  await screen.findByRole('heading', { name: 'Review Brand Kit and instructions' });
  return user;
}

beforeEach(() => {
  // jsdom has no modal dialogs. Opening one makes its content reachable, as in a browser.
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', {
    configurable: true,
    value(this: HTMLDialogElement) {
      this.setAttribute('open', '');
    },
  });
  answers = {
    'koma:deck:capabilities': () => available,
    'koma:brand-profile:cancel': () => ({}),
  };
  requests = [];
  vi.stubGlobal(API_KEY, bridge);
  useProjectStore.getState().load(buildProject(), null);
  useUiStore.getState().reset();
  useUiStore.setState({ notices: [] });
  useBrandKitLibraryStore.setState({ library: { status: 'idle' }, selectedKitId: null });
});

afterEach(() => {
  cleanup();
  listeners.clear();
  useAgentStore.setState({ execution: null });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('discloses the files, the text and the logo candidates before anything is sent', async () => {
  open();
  expect(button('Send listed content and analyze').disabled).toBe(true);
  expect(screen.getByText('Checking the connected Claude Code provider…')).toBeTruthy();
  await screen.findByText('Claude Code 2.1.0 is ready.');
  expect(button('Send listed content and analyze').disabled).toBe(false);

  expect(screen.getByText('2 files · 3 prepared items')).toBeTruthy();
  expect(
    [...screen.getByRole('list', { name: 'Files to analyze' }).children].map(
      (item) => item.textContent,
    ),
  ).toEqual(['deck.pptx · PowerPoint · slides 1, 4 of 12', 'mark.png · Image · 1 preview']);
  expect(screen.getByText('Only 2 of the 12 slides of deck.pptx were prepared.')).toBeTruthy();
  const disclosure = screen.getByText(/are sent to Anthropic/).textContent;
  expect(disclosure).toContain('the 3 prepared previews listed above');
  expect(disclosure).toContain('the 23 characters of text extracted from them');
  expect(disclosure).toContain('and 1 extracted logo candidates');
  expect(disclosure).toContain('File names, file paths and the original files stay on this');
  expect(screen.getByRole('img', { name: 'Prepared preview of deck.pptx, slide 4' })).toBeTruthy();
  expect(screen.getByText('Northstar annual review')).toBeTruthy();
  expect(screen.getAllByText('No extracted text; only the preview is analyzed.')).toHaveLength(2);

  expect(requests.map((entry) => entry.channel)).toEqual(['koma:deck:capabilities']);
});

it('does not analyse without Claude Code, and uses the mock only when it is chosen', async () => {
  answers['koma:deck:capabilities'] = () => ({
    ...available,
    claude: {
      ...available.claude,
      availability: 'unavailable',
      message: 'Claude Code was not found.',
    },
  });
  answers['koma:brand-profile:analyze'] = () => proposed;
  const user = open();
  const alert = await screen.findByRole('alert');
  expect(alert.textContent).toContain('Claude Code was not found.');
  expect(alert.textContent).toContain('No other provider is used in its place.');
  expect(button('Send listed content and analyze').disabled).toBe(true);

  await user.selectOptions(
    screen.getByRole('combobox', { name: 'Analysis provider and model' }),
    'Mock provider · local demonstration',
  );
  expect(screen.queryByRole('alert')).toBeNull();
  expect(
    screen.getByText(/does not\s+analyze your files or send content to Anthropic/),
  ).toBeTruthy();
  await user.click(button('Create mock proposal'));
  await screen.findByRole('heading', { name: 'Review Brand Kit and instructions' });
  expect(sent('koma:brand-profile:analyze')).toEqual([
    { sessionId: SESSION, provider: 'mock', consent: true },
  ]);
});

it('offers no mock provider unless the application allows it', async () => {
  answers['koma:deck:capabilities'] = () => ({ ...available, allowMock: false });
  open();
  await screen.findByText('Claude Code 2.1.0 is ready.');
  expect(screen.getAllByRole('option').map((option) => option.textContent)).toEqual([
    'Claude Code · Opus (latest)',
  ]);
});

it('keeps the analysis unavailable when the provider cannot be checked', async () => {
  answers['koma:deck:capabilities'] = () => {
    throw new Error('The main process did not answer.');
  };
  open();
  expect((await screen.findByRole('alert')).textContent).toBe(
    'The connected Claude provider could not be checked. Close this window and retry.',
  );
  expect(button('Send listed content and analyze').disabled).toBe(true);
});

it('cancels a running analysis instead of closing, and keeps the files', async () => {
  let finish: (response: IpcResponse<'koma:brand-profile:analyze'>) => void = () => undefined;
  answers['koma:brand-profile:analyze'] = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  const user = open();
  await screen.findByText('Claude Code 2.1.0 is ready.');
  await user.click(button('Send listed content and analyze'));

  const status = await screen.findByRole('status');
  expect(status.textContent).toContain('Preparing analysis');
  const progress = { phase: 'analyzing', completed: 1, total: 3 };
  act(() => {
    for (const listener of listeners) {
      listener({ ...progress, sessionId: SESSION, message: 'Reading slide 4' });
      listener({
        ...progress,
        sessionId: '9b2e4c1a-7d3f-4a5b-8c6d-0e1f2a3b4c5d',
        message: 'Another draft',
      });
    }
  });
  expect(status.textContent).toContain('Reading slide 4');
  expect(button('Send listed content and analyze').disabled).toBe(true);

  await user.click(button('Cancel analysis'));
  expect(sent('koma:brand-profile:cancel')).toEqual([{ sessionId: SESSION, scope: 'analysis' }]);
  expect(onClose).not.toHaveBeenCalled();

  act(() => finish({ status: 'cancelled' }));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'Analysis was cancelled. Nothing was saved or applied.',
  );
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('list', { name: 'Files to analyze' })).toBeTruthy();

  await user.click(button('Close'));
  expect(onClose).toHaveBeenCalledOnce();
  expect(onFinished).not.toHaveBeenCalled();
  expect(sent('koma:brand-profile:cancel')).toHaveLength(1);
});

it('reports a refused analysis and an invalid answer without showing a proposal', async () => {
  answers['koma:brand-profile:analyze'] = () => ({
    status: 'failed',
    message: 'The answer named a file that was not attached.',
  });
  const user = open();
  await screen.findByText('Claude Code 2.1.0 is ready.');
  await user.click(button('Send listed content and analyze'));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'The answer named a file that was not attached.',
  );

  // An answer outside the contract never reaches the review.
  answers['koma:brand-profile:analyze'] = () => ({ status: 'proposed', proposal: {} });
  await user.click(button('Send listed content and analyze'));
  await waitFor(() =>
    expect(screen.getByRole('alert').textContent).toBe(
      'Analysis failed. Nothing was saved or applied. Retry the analysis.',
    ),
  );
  expect(screen.queryByRole('heading', { name: 'Review Brand Kit and instructions' })).toBeNull();
  expect(button('Send listed content and analyze').disabled).toBe(false);
});

it('presents a proposal as unverified, with its evidence, guessed fonts and no chosen logo', async () => {
  await review();
  expect(screen.getByText(/Mock demonstration ·.*· from deck\.pptx, mark\.png/)).toBeTruthy();
  expect(screen.getByText('Two slides were hard to read.')).toBeTruthy();
  expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual([
    'colours · high confidence · deck.pptx, slide 4: Orange leads.',
    'typography · low confidence · mark.png: Looks like a serif.',
  ]);
  expect(screen.getByText(/These fonts are not named in your files/)).toBeTruthy();
  expect(screen.getByText(/The analysis did not identify a reliable logo/)).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Library name' }).value).toBe(
    'Northstar',
  );
  expect(screen.getByRole<HTMLInputElement>('radio', { name: 'No logo' }).checked).toBe(true);
  expect(selectCanUndo(useProjectStore.getState())).toBe(false);
});

it('marks the logo the analysis suggested without choosing it', async () => {
  await review({
    ...proposed,
    fontsNamedInMaterial: true,
    proposal: { ...proposed.proposal, logoCandidateId: DECK_LOGO },
  });
  expect(
    screen.getByRole('radio', {
      name: /Use the image from deck\.pptx, slide 4 as\s+the logo \(suggested by the analysis\)/,
    }),
  ).toBeTruthy();
  expect(screen.getByRole<HTMLInputElement>('radio', { name: 'No logo' }).checked).toBe(true);
  expect(screen.queryByText(/These fonts are not named in your files/)).toBeNull();
  expect(screen.queryByText(/did not identify a reliable logo/)).toBeNull();
});

it('needs a library name to save, and valid instructions and colours for anything', async () => {
  const user = await review();
  const enabled = () =>
    ['Apply without saving', 'Save to library', 'Save and apply'].filter(
      (name) => !button(name).disabled,
    );
  expect(enabled()).toEqual(['Apply without saving', 'Save to library', 'Save and apply']);

  await user.clear(screen.getByRole('textbox', { name: 'Library name' }));
  expect(screen.getByRole('alert').textContent).toBe('Error: Enter a name of 1–120 characters.');
  expect(enabled()).toEqual(['Apply without saving']);
  await user.type(screen.getByRole('textbox', { name: 'Library name' }), 'Northstar 2026');
  expect(enabled()).toHaveLength(3);

  const instructions = screen.getByRole('textbox', { name: 'Instructions for this brand' });
  fireEvent.change(instructions, {
    target: { value: 'x'.repeat(MAX_SYSTEM_INSTRUCTIONS_LENGTH + 1) },
  });
  expect(screen.getByRole('alert').textContent).toContain('Your text has been kept.');
  expect(enabled()).toEqual([]);
  fireEvent.change(instructions, { target: { value: 'Use short sentences.' } });
  expect(enabled()).toHaveLength(3);

  await user.clear(screen.getByRole('textbox', { name: 'Primary colour' }));
  expect(screen.getByRole('alert').textContent).toContain('colours.primary');
  expect(enabled()).toEqual([]);
});

it('saves the reviewed kit, instructions and chosen logo without changing the project', async () => {
  answers['koma:brand-profile:save'] = () => emptyLibrary;
  const user = await review();
  await user.clear(screen.getByRole('textbox', { name: 'Library name' }));
  await user.type(screen.getByRole('textbox', { name: 'Library name' }), '  Northstar 2026 ');
  await user.clear(screen.getByRole('textbox', { name: 'Tone' }));
  await user.type(screen.getByRole('textbox', { name: 'Tone' }), 'Warm');
  await user.type(
    screen.getByRole('textbox', { name: 'Preferred topics (one per line)' }),
    '{Enter} strategy {Enter}{Enter}',
  );
  await user.type(
    screen.getByRole('textbox', { name: 'Instructions for this brand' }),
    ' No jargon.',
  );
  await user.click(
    screen.getByRole('radio', { name: /Use the image from mark\.png as\s+the logo/ }),
  );
  await user.click(button('Save to library'));

  await waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
  expect(sent('koma:brand-profile:save')).toEqual([
    {
      sessionId: SESSION,
      name: 'Northstar 2026',
      brandKit: buildBrandKit({
        name: 'Northstar',
        tone: 'Warm',
        preferredTopics: ['motion', 'strategy'],
      }),
      instructions: 'Use short sentences. No jargon.',
      logoCandidateId: IMAGE_LOGO,
    },
  ]);
  expect(notices()).toEqual([
    'Saved "Northstar 2026" with its instructions to your Brand Kit library. This project was not changed.',
  ]);
  expect(useBrandKitLibraryStore.getState().library.status).toBe('ready');
  expect(selectCanUndo(useProjectStore.getState())).toBe(false);
  expect(sent('koma:brand-profile:cancel')).toEqual([]);
});

it('keeps the draft when the library refuses it, and says the project is unchanged', async () => {
  answers['koma:brand-profile:save'] = () => ({ status: 'failed', message: 'The disk is full.' });
  const user = await review();
  await user.click(button('Save and apply'));
  expect((await screen.findByRole('alert')).textContent).toBe(
    'The disk is full. The project was not changed. Retry, or apply without saving.',
  );
  expect(selectCanUndo(useProjectStore.getState())).toBe(false);
  expect(onFinished).not.toHaveBeenCalled();
  expect(button('Save and apply').disabled).toBe(false);
});

it('says that a profile was saved but not applied when the project was replaced meanwhile', async () => {
  answers['koma:brand-profile:save'] = () => emptyLibrary;
  const user = await review();
  act(() => useProjectStore.getState().load(buildProject({ id: 'project-2' }), null));
  await user.click(button('Save and apply'));

  await waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
  expect(notices()).toEqual([
    '"Northstar" was saved to your Brand Kit library, but it was not applied. The project was replaced, so the brand profile was not applied. Apply it from the Brand Kit library when you are ready.',
  ]);
  expect(selectProject(useProjectStore.getState())?.brandKit.name).toBe('Fixture Brand');
  expect(selectCanUndo(useProjectStore.getState())).toBe(false);
});

it('saves and applies kit and instructions as one step that Undo takes back', async () => {
  answers['koma:brand-profile:save'] = () => emptyLibrary;
  const user = await review();
  await user.click(button('Save and apply'));
  await waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
  expect(selectProject(useProjectStore.getState())).toMatchObject({
    brandKit: { name: 'Northstar' },
    systemInstructions: 'Use short sentences.',
  });
  expect(notices()).toEqual([
    'Saved "Northstar" and applied its Brand Kit and instructions to this project. Use Undo to go back.',
  ]);
  act(() => useProjectStore.getState().undo());
  expect(selectProject(useProjectStore.getState())).toMatchObject({
    brandKit: { name: 'Fixture Brand' },
    systemInstructions: '',
  });
  expect(selectCanUndo(useProjectStore.getState())).toBe(false);
});

it('allows only saving to the library while Komas are being generated', async () => {
  await review();
  act(() =>
    useAgentStore.getState().startExecution({
      executionId: 'run-1',
      providerId: 'mock',
      providerName: 'Mock',
      streams: false,
      modelLabel: 'mock',
    }),
  );
  expect(button('Apply without saving').disabled).toBe(true);
  expect(button('Save and apply').disabled).toBe(true);
  expect(button('Save to library').disabled).toBe(false);
  expect(
    screen.getByText(/You can save now and apply when the generation has\s+finished/),
  ).toBeTruthy();
});

it('asks before a proposal is discarded and discards the draft only on confirmation', async () => {
  const user = await review();
  await user.click(button('Discard'));
  expect(useUiStore.getState().confirmation).toMatchObject({
    title: 'Discard this proposal?',
    confirmLabel: 'Discard proposal',
    destructive: true,
  });
  act(() => useUiStore.getState().answerConfirmation(false));
  await waitFor(() => expect(useUiStore.getState().confirmation).toBeNull());
  expect(sent('koma:brand-profile:cancel')).toEqual([]);
  expect(within(document.body).getByRole('textbox', { name: 'Library name' })).toBeTruthy();

  await user.click(button('Discard'));
  act(() => useUiStore.getState().answerConfirmation(true));
  await waitFor(() => expect(onFinished).toHaveBeenCalledOnce());
  expect(sent('koma:brand-profile:cancel')).toEqual([{ sessionId: SESSION, scope: 'draft' }]);
  expect(onClose).not.toHaveBeenCalled();
});
