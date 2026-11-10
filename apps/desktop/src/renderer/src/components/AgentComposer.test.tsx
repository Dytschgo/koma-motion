// @vitest-environment jsdom
import type { ProviderMetadata, ReferenceText } from '@koma-motion/agent-runtime';
import type { KomaProject } from '@koma-motion/core';
import { buildKoma, buildPresentation, buildProject } from '@koma-motion/core/testing';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cancelGeneration, generate } from '../lib/agentActions';
import { attachReferences } from '../lib/referenceActions';
import { useComposerDraft } from '../lib/useComposerDraft';
import { useComposerPanel } from '../lib/useComposerPanel';
import { useAgentStore, type DetectedProvider } from '../state/agentStore';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useReferenceStore } from '../state/referenceStore';
import { useUiStore } from '../state/uiStore';
import { AgentComposer } from './AgentComposer';

vi.mock('../lib/agentActions', () => ({
  generate: vi.fn(),
  cancelGeneration: vi.fn(),
  detectProviders: vi.fn(),
  listProviderModels: vi.fn(),
  acceptScopedProposal: vi.fn(),
  discardScopedProposal: vi.fn(),
}));
vi.mock('../lib/referenceActions', () => ({ attachReferences: vi.fn() }));

function provider(
  metadata: Partial<ProviderMetadata>,
  availability: DetectedProvider['detection']['availability'] = 'available',
): DetectedProvider {
  const id = metadata.id ?? 'mock';
  return {
    metadata: {
      id,
      displayName: 'Mock',
      description: 'Returns a demonstration.',
      kind: 'builtIn',
      usesExternalService: false,
      supportsModelSelection: false,
      defaultModel: null,
      modelCatalog: { source: 'curated', models: [], note: '' },
      acceptsCustomModel: false,
      streamsOutput: false,
      ...metadata,
    },
    detection: {
      providerId: id,
      availability,
      version: null,
      message: availability === 'available' ? 'Ready.' : 'The program was not found.',
      checkedAt: '2026-10-01T12:00:00.000Z',
    },
  };
}

const claude = (availability?: DetectedProvider['detection']['availability']) =>
  provider(
    { id: 'claude-code', displayName: 'Claude Code', kind: 'cli', usesExternalService: true },
    availability,
  );

const reference: ReferenceText = {
  id: '2f1c7d3e-8a4b-4c6d-9e0f-1a2b3c4d5e6f',
  name: 'brief.md',
  format: 'md',
  text: 'Tea sales grew by a fifth.',
  truncated: false,
};

const toggleChat = vi.fn();
let chat: { open: boolean; status: string | null } = { open: false, status: null };

/** The composer with the draft and panel state the sidebar gives it. */
function Composer({ project }: { readonly project: KomaProject }): ReactElement {
  const draft = useComposerDraft(project);
  const panel = useComposerPanel(project.id, true);
  return (
    <AgentComposer
      project={project}
      draft={draft}
      panel={panel}
      chat={{ ...chat, controls: 'conversation', toggle: toggleChat }}
    />
  );
}

function Sidebar(): ReactElement | null {
  const project = useProjectStore(selectProject);
  return project === null ? null : <Composer project={project} />;
}

function open(
  overrides: Partial<KomaProject> = {},
  providers: readonly DetectedProvider[] = [provider({})],
) {
  useProjectStore.getState().load(buildProject(overrides), null);
  useAgentStore.getState().setDetection('done', providers);
  return { user: userEvent.setup({ delay: null }), ...render(<Sidebar />) };
}

const request = () => screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Your request' });
const button = (name: string) => screen.getByRole<HTMLButtonElement>('button', { name });
const scope = () => screen.getByRole<HTMLSelectElement>('combobox', { name: 'Generation scope' });

beforeEach(() => {
  chat = { open: false, status: null };
  useUiStore.getState().reset();
  useReferenceStore.getState().clear();
  useAgentStore.setState({
    execution: null,
    conversation: [],
    scopedProposal: null,
    providers: [],
    detection: 'idle',
  });
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* jsdom has no layout to report. */
      }
      disconnect() {
        /* Nothing was observed. */
      }
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('sends a trimmed request for the default number of Komas and empties the field', async () => {
  const { user } = open();
  expect(button('Generate Komas').disabled).toBe(true);
  await user.type(request(), '   ');
  expect(button('Generate Komas').disabled).toBe(true);

  await user.clear(request());
  await user.type(request(), '  Three Komas about tea ');
  await user.click(button('Generate Komas'));
  expect(generate).toHaveBeenCalledExactlyOnceWith({
    userRequest: 'Three Komas about tea',
    objective: null,
    audience: null,
    requestedKomaCount: 5,
  });
  expect(request().value).toBe('');
  expect(document.activeElement).toBe(request());
});

it('asks for a presentation in an empty project and for a change otherwise', () => {
  const { unmount } = open();
  expect(request().placeholder).toBe('Describe a change…');
  unmount();
  open({ presentation: buildPresentation({ komas: [] }) });
  expect(request().placeholder).toBe('Describe the presentation…');
});

it('does not send to a provider that is not available', async () => {
  const { user } = open(
    {
      agentConfiguration: {
        selectedProviderId: 'claude-code',
        timeoutSeconds: null,
        providers: {},
      },
    },
    [provider({}), claude('unavailable')],
  );
  await user.type(request(), 'Three Komas about tea{Enter}');
  expect(button('Generate Komas').disabled).toBe(true);
  expect(generate).not.toHaveBeenCalled();
  expect(request().value).toBe('Three Komas about tea');

  // The same draft can be sent once the provider is found.
  act(() => useAgentStore.getState().setDetection('done', [provider({}), claude()]));
  await user.click(button('Generate Komas'));
  expect(generate).toHaveBeenCalledOnce();
});

it('turns Send into Stop while Komas are generated and locks the choices', async () => {
  const { user } = open();
  await user.click(button('Generation options'));
  act(() =>
    useAgentStore.getState().startExecution({
      executionId: 'run-1',
      providerId: 'mock',
      providerName: 'Mock',
      streams: false,
      modelLabel: 'mock',
    }),
  );
  expect(screen.queryByRole('button', { name: 'Generate Komas' })).toBeNull();
  for (const name of ['Model', 'Koma count', 'Attach references', 'Choose Brand Kit']) {
    expect(button(name).disabled, name).toBe(true);
  }
  expect(scope().disabled).toBe(true);

  // A request typed during the run stays a draft; Enter does not start a second run.
  await user.type(request(), 'A follow-up{Enter}');
  expect(generate).not.toHaveBeenCalled();
  expect(request().value).toBe('A follow-up');

  await user.click(button('Stop generating'));
  expect(cancelGeneration).toHaveBeenCalledOnce();
  expect(document.activeElement).toBe(request());

  act(() => useAgentStore.getState().requestCancel());
  expect(button('Stop generating').disabled).toBe(true);
});

it('limits a request to the selected Koma and asks for exactly one', async () => {
  const { user } = open({
    presentation: buildPresentation({
      komas: [buildKoma(), buildKoma({ id: 'koma-2', title: 'Second' })],
    }),
  });
  const selected = () => within(scope()).getByRole<HTMLOptionElement>('option', { name: /Koma/ });
  expect(selected().textContent).toBe('Selected Koma');
  expect(selected().disabled).toBe(true);

  act(() => useUiStore.getState().selectKoma('koma-2'));
  expect(selected().textContent).toBe('Koma 2');
  await user.selectOptions(scope(), 'Koma 2');
  expect(scope().title).toBe('The request changes Koma 2 only and asks you to review it');

  await user.click(button('Generation options'));
  expect(button('Koma count').textContent).toBe('1 Koma');
  expect(button('Koma count').disabled).toBe(true);

  await user.type(request(), 'Shorten the headline{Enter}');
  expect(generate).toHaveBeenCalledExactlyOnceWith({
    userRequest: 'Shorten the headline',
    objective: null,
    audience: null,
    requestedKomaCount: 1,
    targetKomaId: 'koma-2',
  });
});

it('blocks sending while the Koma count is not a whole number, and explains it when collapsed', async () => {
  const { user } = open();
  await user.type(request(), 'Three Komas about tea');
  await user.click(button('Generation options'));
  await user.click(button('Koma count'));
  const dialog = screen.getByRole('dialog', { name: 'Koma count' });
  const count = within(dialog).getByRole<HTMLInputElement>('spinbutton', { name: 'Komas' });
  expect(document.activeElement).toBe(count);
  expect(within(dialog).getByText('Replaces current Komas. Undo is available.')).toBeTruthy();

  await user.clear(count);
  await user.type(count, '0');
  expect(within(dialog).getByRole('alert').textContent).toBe('Enter a whole number from 1.');
  expect(button('Koma count').textContent).toBe('Set Komas');
  expect(button('Generate Komas').disabled).toBe(true);
  // Enter keeps an invalid count open instead of accepting it.
  await user.keyboard('{Enter}');
  expect(screen.getByRole('dialog', { name: 'Koma count' })).toBeTruthy();
  expect(generate).not.toHaveBeenCalled();

  await user.click(button('Generation options'));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('alert').textContent).toBe('Koma count: enter a whole number from 1.');

  await user.click(button('Generation options'));
  await user.click(button('Koma count'));
  const again = within(screen.getByRole('dialog', { name: 'Koma count' })).getByRole('spinbutton');
  await user.clear(again);
  await user.type(again, '7{Enter}');
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(document.activeElement).toBe(button('Koma count'));
  expect(button('Koma count').textContent).toBe('7 Komas');
  await user.click(button('Generate Komas'));
  expect(generate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ requestedKomaCount: 7 }),
  );
});

it('leaves the number of Komas to the agent when Auto is on', async () => {
  const { user } = open();
  await user.click(button('Generation options'));
  await user.click(button('Koma count'));
  await user.click(screen.getByRole('button', { name: 'Auto', pressed: false }));
  expect(screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Komas' }).disabled).toBe(true);
  expect(button('Koma count').textContent).toBe('Auto Komas');

  await user.type(request(), 'A deck about tea{Enter}');
  expect(generate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ requestedKomaCount: null }),
  );
});

it('sends reference text to an online provider only after consent for exactly these files', async () => {
  const { user } = open(
    {
      agentConfiguration: {
        selectedProviderId: 'claude-code',
        timeoutSeconds: null,
        providers: {},
      },
    },
    [provider({}), claude()],
  );
  await user.type(request(), 'Summarise the brief');
  expect(screen.queryByRole('checkbox')).toBeNull();

  act(() =>
    useReferenceStore.getState().setReferences(useProjectStore.getState().sessionId, [reference]),
  );
  const consent = screen.getByRole<HTMLInputElement>('checkbox', {
    name: 'Send the extracted reference text to Claude Code with this request.',
  });
  expect(consent.checked).toBe(false);
  expect(button('Generate Komas').disabled).toBe(true);
  await user.click(consent);
  expect(button('Generate Komas').disabled).toBe(false);

  // Consent given for one set of files does not cover another.
  const second = { ...reference, id: '9b2e4c1a-7d3f-4a5b-8c6d-0e1f2a3b4c5d', name: 'notes.txt' };
  act(() =>
    useReferenceStore
      .getState()
      .setReferences(useProjectStore.getState().sessionId, [reference, second]),
  );
  expect(consent.checked).toBe(false);
  expect(button('Generate Komas').disabled).toBe(true);

  await user.click(consent);
  await user.click(button('Generate Komas'));
  expect(generate).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      userRequest: 'Summarise the brief',
      references: [reference, second],
    }),
  );
  // The next request needs consent again.
  expect(consent.checked).toBe(false);
});

it('needs no consent for the local mock provider and says that it ignores references', async () => {
  const { user } = open();
  act(() =>
    useReferenceStore.getState().setReferences(useProjectStore.getState().sessionId, [reference]),
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  await user.click(button('Generation options'));
  expect(
    screen.getByText('Mock repeats its demo and does not use reference content.'),
  ).toBeTruthy();
  await user.click(button('Attach references'));
  expect(attachReferences).toHaveBeenCalledOnce();
});

it('ignores references that belong to a project that is no longer open', () => {
  open(
    {
      agentConfiguration: {
        selectedProviderId: 'claude-code',
        timeoutSeconds: null,
        providers: {},
      },
    },
    [claude()],
  );
  act(() =>
    useReferenceStore
      .getState()
      .setReferences(useProjectStore.getState().sessionId - 1, [reference]),
  );
  expect(screen.queryByRole('checkbox')).toBeNull();
  expect(screen.queryByRole('list', { name: 'Attached references' })).toBeNull();
});

it('keeps the generation choices folded away until they are asked for', async () => {
  const { user } = open();
  const options = button('Generation options');
  expect(options.getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByRole('group', { name: 'Generation choices' })).toBeNull();

  await user.click(options);
  expect(options.getAttribute('aria-expanded')).toBe('true');
  const choices = screen.getByRole('group', { name: 'Generation choices' });
  expect(options.getAttribute('aria-controls')).toBe(choices.id);
  expect(button('Model').textContent).toBe('Mock · Demo');
  expect(button('Model').getAttribute('aria-description')).toBe('Mock has no model choice');
  expect(button('Koma count').textContent).toBe('5 Komas');
});

it('opens the time limit in Settings when the project has one', async () => {
  const { user } = open({
    agentConfiguration: { selectedProviderId: 'mock', timeoutSeconds: 600, providers: {} },
  });
  await user.click(button('Generation options'));
  expect(button('Change generation time limit').textContent).toMatch(/^Limit: /);
  await user.click(button('Change generation time limit'));
  expect(useUiStore.getState()).toMatchObject({ settingsOpen: true, settingsPage: 'generation' });
});

it('shows and hides the conversation, and reports its state while it is hidden', async () => {
  chat = { open: false, status: 'Mock is working' };
  const { user, unmount } = open();
  const show = button('Show the chat');
  expect(show.getAttribute('aria-expanded')).toBe('false');
  expect(show.getAttribute('aria-description')).toBe('Mock is working');
  expect(show.getAttribute('aria-controls')).toBe('conversation');
  await user.click(show);
  expect(toggleChat).toHaveBeenCalledOnce();
  unmount();

  chat = { open: true, status: 'Mock is working' };
  open();
  expect(button('Hide the chat').getAttribute('aria-expanded')).toBe('true');
  expect(button('Hide the chat').hasAttribute('aria-description')).toBe(false);
});
