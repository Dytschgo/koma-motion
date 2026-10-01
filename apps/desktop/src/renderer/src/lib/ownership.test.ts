import {
  MAX_EMBEDDED_ASSET_CHARACTERS,
  type AssetReference,
  type GenerationHistoryEntry,
  type ImageElement,
  type Presentation,
} from '@koma-motion/core';
import {
  buildKoma,
  buildPresentation,
  buildProject,
  buildShape,
  FIXTURE_TIMESTAMP,
} from '@koma-motion/core/testing';
import { serialiseProject } from '@koma-motion/project-format';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { IpcResponse } from '../../../shared/ipc';
import { useAgentStore } from '../state/agentStore';
import { changeKomaDetails, changeLogo, renameProject } from '../state/commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { generate } from './agentActions';
import { invoke } from './api';
import { chooseProjectLogo, createNewProject, saveAndClose, saveProject } from './projectActions';
import { buildTimeline } from './runActivity';

vi.mock('./api', () => ({
  invoke: vi.fn(),
  subscribe: vi.fn(() => () => undefined),
}));

const invokeMock = vi.mocked(invoke);

/** The mocked bridge returns plain fixtures, so the implementation is not the generic IPC type. */
function mockChannels(handler: (channel: string) => Promise<unknown>): void {
  invokeMock.mockImplementation(handler as typeof invoke);
}

function defer<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolvePromise: (value: T) => void = () => undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return { promise, resolve: resolvePromise };
}

const generationEntry: GenerationHistoryEntry = {
  id: 'generation-1',
  createdAt: FIXTURE_TIMESTAMP,
  providerId: 'mock',
  userRequest: 'Introduce the motion engine',
  status: 'succeeded',
  summary: 'Three frames',
  warnings: [],
};

const logo: AssetReference = {
  id: 'logo-1',
  type: 'image',
  name: 'logo.png',
  mediaType: 'image/png',
  projectPath: 'assets/logo-1.png',
  metadata: {},
  embeddedData: null,
};

const availableLogo: AssetReference = {
  ...logo,
  embeddedData: { encoding: 'base64', data: 'aGVsbG8=' },
};

function imagePresentation(grouped = false): Presentation {
  const image: ImageElement = {
    ...buildShape(),
    id: 'element-image',
    persistentId: 'image',
    type: 'image',
    name: 'Generated logo',
    content: { assetId: logo.id, altText: 'Logo' },
    style: { fit: 'contain', cornerRadius: 0 },
  };
  return buildPresentation({
    title: 'Generated image',
    komas: [
      buildKoma({
        elements: grouped
          ? [
              {
                ...buildShape(),
                type: 'group',
                content: { referenceSize: { width: 200, height: 200 }, children: [image] },
                style: {},
              },
            ]
          : [image],
      }),
    ],
  });
}

function resetStores(): void {
  useProjectStore.setState({
    history: null,
    file: null,
    savedProject: null,
    loadWarnings: [],
    sessionId: 0,
    nextSaveSerial: 1,
    appliedSaveSerial: 0,
  });
  useAgentStore.setState({
    providers: [],
    detection: 'idle',
    execution: null,
    lastRun: null,
    conversation: [],
  });
  useUiStore.getState().reset();
  invokeMock.mockReset();
}

describe('asynchronous project ownership', () => {
  beforeEach(() => {
    resetStores();
  });

  it('does not apply a delayed generation to the project that replaced it', async () => {
    const projectA = buildProject({
      name: 'Project A',
      presentation: buildPresentation({ title: 'Before' }),
    });
    const projectB = buildProject({
      id: 'project-2',
      name: 'Project B',
      presentation: buildPresentation({ id: 'presentation-2', title: 'Replacement' }),
    });
    const generated = buildPresentation({
      id: 'presentation-generated',
      title: 'Generated for A',
    });
    useProjectStore.getState().load(projectA, null);

    const execution = defer<unknown>();
    const calls: string[] = [];
    mockChannels((channel: string) => {
      calls.push(channel);
      if (channel === 'koma:providers:execute') {
        return execution.promise;
      }
      if (channel === 'koma:project:create') {
        return Promise.resolve({ project: projectB });
      }
      if (channel === 'koma:providers:cancel') {
        return Promise.resolve({ cancelled: true });
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    await createNewProject();
    execution.resolve(succeeded(generated));
    await pending;

    expect(calls).toContain('koma:providers:cancel');
    expect(selectProject(useProjectStore.getState())?.presentation.title).toBe('Replacement');
    expect(useAgentStore.getState().conversation.some((entry) => entry.kind === 'result')).toBe(
      false,
    );
    expect(useAgentStore.getState().execution).toBeNull();
  });

  it('keeps a generation of the replacement project when the previous one finishes', async () => {
    const projectA = buildProject({ name: 'Project A' });
    const projectB = buildProject({
      id: 'project-2',
      name: 'Project B',
      presentation: buildPresentation({ id: 'presentation-2', title: 'Replacement' }),
    });
    useProjectStore.getState().load(projectA, null);

    const executions: Array<ReturnType<typeof defer<unknown>>> = [];
    mockChannels((channel: string) => {
      if (channel === 'koma:providers:execute') {
        const pending = defer<unknown>();
        executions.push(pending);
        return pending.promise;
      }
      if (channel === 'koma:project:create') {
        return Promise.resolve({ project: projectB });
      }
      if (channel === 'koma:providers:cancel') {
        return Promise.resolve({ cancelled: true });
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    const first = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    await createNewProject();
    const second = generate({
      userRequest: 'A different presentation',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    const replacementExecution = useAgentStore.getState().execution?.executionId;
    executions[0]?.resolve(succeeded(buildPresentation({ title: 'Generated for A' })));
    await first;

    expect(useAgentStore.getState().execution?.executionId).toBe(replacementExecution);
    expect(selectProject(useProjectStore.getState())?.presentation.title).toBe('Replacement');
    executions[1]?.resolve(succeeded(buildPresentation({ title: 'Generated for B' })));
    await second;
    expect(selectProject(useProjectStore.getState())?.presentation.title).toBe('Generated for B');
  });

  it('applies a generation to the project that requested it', async () => {
    useProjectStore.getState().load(buildProject(), null);
    const execution = defer<unknown>();
    mockChannels((channel: string) => {
      if (channel === 'koma:providers:execute') {
        return execution.promise;
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    execution.resolve(succeeded(buildPresentation({ title: 'Generated for A' })));
    await pending;

    expect(selectProject(useProjectStore.getState())?.presentation.title).toBe('Generated for A');
    expect(useAgentStore.getState().conversation.some((entry) => entry.kind === 'result')).toBe(
      true,
    );
    expect(useAgentStore.getState().execution).toBeNull();
  });

  it('asks before replacing Komas edited while generation ran, then applies the accepted result', async () => {
    useProjectStore.getState().load(buildProject(), null);
    const execution = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') return execution.promise;
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    useProjectStore.getState().apply(changeKomaDetails('koma-1', { title: 'My edit' }));
    execution.resolve(succeeded(buildPresentation({ title: 'Generated for A' })));
    await vi.waitFor(() =>
      expect(useUiStore.getState().confirmation?.title).toBe('Replace your edited Komas?'),
    );

    expect(selectProject(useProjectStore.getState())?.presentation.komas[0]?.title).toBe('My edit');
    expect(useAgentStore.getState().conversation.some((entry) => entry.kind === 'result')).toBe(
      false,
    );
    useUiStore.getState().answerConfirmation(true);
    await pending;

    expect(selectProject(useProjectStore.getState())?.presentation.title).toBe('Generated for A');
    expect(selectProject(useProjectStore.getState())?.generationHistory).toHaveLength(1);
    useProjectStore.getState().undo();
    expect(selectProject(useProjectStore.getState())?.presentation.komas[0]?.title).toBe('My edit');
    expect(useAgentStore.getState().execution).toBeNull();
  });

  it('keeps edits and reports that a completed generation was not applied', async () => {
    useProjectStore.getState().load(buildProject(), null);
    const execution = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') return execution.promise;
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    useProjectStore.getState().apply(changeKomaDetails('koma-1', { title: 'My edit' }));
    execution.resolve(succeeded(buildPresentation({ title: 'Generated for A' })));
    await vi.waitFor(() => expect(useUiStore.getState().confirmation).not.toBeNull());
    useUiStore.getState().answerConfirmation(false);
    await pending;

    expect(selectProject(useProjectStore.getState())?.presentation.komas[0]?.title).toBe('My edit');
    expect(selectProject(useProjectStore.getState())?.generationHistory).toHaveLength(0);
    expect(useAgentStore.getState().conversation.at(-1)).toMatchObject({
      kind: 'notApplied',
      text: 'Three frames',
    });
    expect(useAgentStore.getState().execution).toBeNull();
  });

  it('does not prompt when only project metadata changed during generation', async () => {
    useProjectStore.getState().load(buildProject(), null);
    const execution = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') return execution.promise;
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    useProjectStore.getState().apply(renameProject('New name'));
    execution.resolve(succeeded(buildPresentation({ title: 'Generated for A' })));
    await pending;

    expect(useUiStore.getState().confirmation).toBeNull();
    expect(selectProject(useProjectStore.getState())?.name).toBe('New name');
    expect(selectProject(useProjectStore.getState())?.presentation.title).toBe('Generated for A');
  });

  it('dismisses a pending replacement decision when the project changes', async () => {
    useProjectStore.getState().load(buildProject(), null);
    const execution = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') return execution.promise;
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    useProjectStore.getState().apply(changeKomaDetails('koma-1', { title: 'My edit' }));
    execution.resolve(succeeded(buildPresentation({ title: 'Generated for A' })));
    await vi.waitFor(() => expect(useUiStore.getState().confirmation).not.toBeNull());
    useProjectStore.getState().load(buildProject({ name: 'Project B' }), null);
    useUiStore.getState().reset();
    await pending;

    expect(useUiStore.getState().confirmation).toBeNull();
    expect(selectProject(useProjectStore.getState())?.name).toBe('Project B');
    expect(selectProject(useProjectStore.getState())?.generationHistory).toHaveLength(0);
    expect(useAgentStore.getState().conversation.some((entry) => entry.kind === 'notApplied')).toBe(
      false,
    );
  });

  it('asks again if the presentation changes while the replacement decision is open', async () => {
    useProjectStore.getState().load(buildProject(), null);
    const execution = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') return execution.promise;
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    useProjectStore.getState().apply(changeKomaDetails('koma-1', { title: 'First edit' }));
    execution.resolve(succeeded(buildPresentation({ title: 'Generated for A' })));
    await vi.waitFor(() => expect(useUiStore.getState().confirmation).not.toBeNull());
    const firstDecision = useUiStore.getState().confirmation;
    useProjectStore.getState().apply(changeKomaDetails('koma-1', { title: 'Second edit' }));
    useUiStore.getState().answerConfirmation(true);
    await vi.waitFor(() => expect(useUiStore.getState().confirmation).not.toBe(firstDecision));
    expect(useUiStore.getState().confirmation).not.toBeNull();
    expect(selectProject(useProjectStore.getState())?.presentation.komas[0]?.title).toBe(
      'Second edit',
    );
    useUiStore.getState().answerConfirmation(false);
    await pending;
    expect(selectProject(useProjectStore.getState())?.presentation.komas[0]?.title).toBe(
      'Second edit',
    );
  });

  it('offers the completed proposal again when another confirmation interrupts it', async () => {
    useProjectStore.getState().load(buildProject(), null);
    const execution = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') return execution.promise;
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    useProjectStore.getState().apply(changeKomaDetails('koma-1', { title: 'My edit' }));
    execution.resolve(succeeded(buildPresentation({ title: 'Generated for A' })));
    await vi.waitFor(() => expect(useUiStore.getState().confirmation).not.toBeNull());

    const otherDecision = useUiStore.getState().confirm({
      title: 'Another action?',
      message: 'Another action needs a decision.',
      confirmLabel: 'Continue',
      cancelLabel: 'Stay',
      destructive: false,
    });
    await vi.waitFor(() =>
      expect(useUiStore.getState().confirmation?.title).toBe('Another action?'),
    );
    useUiStore.getState().answerConfirmation(false);
    await otherDecision;
    await vi.waitFor(() =>
      expect(useUiStore.getState().confirmation?.title).toBe('Replace your edited Komas?'),
    );

    expect(selectProject(useProjectStore.getState())?.presentation.komas[0]?.title).toBe('My edit');
    useUiStore.getState().answerConfirmation(false);
    await pending;
    expect(useAgentStore.getState().conversation.at(-1)?.kind).toBe('notApplied');
  });

  it('preserves edits made while a generation that fails was running', async () => {
    useProjectStore.getState().load(buildProject(), null);
    const execution = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') return execution.promise;
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Introduce the motion engine',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    useProjectStore.getState().apply(changeKomaDetails('koma-1', { title: 'My edit' }));
    execution.resolve({
      status: 'failed',
      historyEntry: { ...generationEntry, status: 'failed' },
      error: { code: 'internalError', message: 'Provider failed', issues: [] },
      diagnostics: {
        providerId: 'mock',
        startedAt: FIXTURE_TIMESTAMP,
        finishedAt: FIXTURE_TIMESTAMP,
        durationMs: 0,
        promptTemplate: '',
        attempts: [],
      },
    });
    await pending;

    expect(selectProject(useProjectStore.getState())?.presentation.komas[0]?.title).toBe('My edit');
    expect(selectProject(useProjectStore.getState())?.generationHistory[0]?.status).toBe('failed');
    expect(useUiStore.getState().confirmation).toBeNull();
  });

  it('refuses a delayed image proposal after its logo asset is replaced', async () => {
    const project = buildProject({
      brandKit: { ...buildProject().brandKit, logoAssetId: logo.id },
      assets: [availableLogo],
    });
    useProjectStore.getState().load(project, null);
    const execution = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') {
        return execution.promise;
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Use the logo as an image',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    useProjectStore
      .getState()
      .apply(changeLogo({ ...availableLogo, id: 'logo-2', projectPath: 'assets/logo-2.png' }));
    const edited = selectProject(useProjectStore.getState());
    execution.resolve(succeeded(imagePresentation()));
    await pending;

    expect(selectProject(useProjectStore.getState())).toBe(edited);
    expect(edited?.presentation).toBe(project.presentation);
    expect(edited?.assets.map((asset) => asset.id)).toEqual(['logo-2']);
    expect(edited?.generationHistory).toEqual([]);
    expect(useAgentStore.getState().conversation.some((entry) => entry.kind === 'result')).toBe(
      false,
    );
    const failure = useAgentStore.getState().conversation.at(-1);
    expect(failure?.kind).toBe('failure');
    if (failure?.kind === 'failure') {
      expect(failure.status).toBe('failed');
      expect(failure.error.code).toBe('invalidResponse');
      expect(failure.error.message).toMatch(/Generate again/);
      expect(failure.error.issues).toEqual([
        expect.objectContaining({
          code: 'invalidReference',
          path: 'komas[0].elements[0].content.assetId',
        }),
      ]);
    }
  });

  it.each(['removed', 'without bytes'] as const)(
    'checks grouped images when their asset is %s before applying a proposal',
    async (change) => {
      const project = buildProject({
        brandKit: { ...buildProject().brandKit, logoAssetId: logo.id },
        assets: [availableLogo],
      });
      useProjectStore.getState().load(project, null);
      const execution = defer<unknown>();
      mockChannels((channel) => {
        if (channel === 'koma:providers:execute') {
          return execution.promise;
        }
        throw new Error(`Unexpected channel ${channel}`);
      });

      const pending = generate({
        userRequest: 'Use the logo inside a group',
        objective: null,
        audience: null,
        requestedKomaCount: null,
      });
      if (change === 'removed') {
        useProjectStore.getState().apply(changeLogo(null));
      } else {
        useProjectStore.getState().apply((current) => ({
          ...current,
          assets: [{ ...availableLogo, embeddedData: null }],
        }));
      }
      const edited = selectProject(useProjectStore.getState());
      execution.resolve(succeeded(imagePresentation(true)));
      await pending;

      expect(selectProject(useProjectStore.getState())).toBe(edited);
      const failure = useAgentStore.getState().conversation.at(-1);
      expect(failure?.kind).toBe('failure');
      if (failure?.kind === 'failure') {
        expect(failure.error.issues).toEqual([
          expect.objectContaining({
            code: 'invalidReference',
            path: 'komas[0].elements[0].content.children[0].content.assetId',
          }),
        ]);
      }
    },
  );

  it('accepts a proposal when unrelated edits leave referenced images available', async () => {
    const project = buildProject({ assets: [availableLogo] });
    useProjectStore.getState().load(project, null);
    const execution = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') {
        return execution.promise;
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = generate({
      userRequest: 'Use the logo as an image',
      objective: null,
      audience: null,
      requestedKomaCount: null,
    });
    useProjectStore.getState().apply((current) => ({
      ...current,
      name: 'Edited while generating',
      assets: [
        {
          ...availableLogo,
          name: 'Updated asset name',
          embeddedData: { encoding: 'base64', data: 'bmV3' },
        },
        { ...availableLogo, id: 'other-asset', projectPath: 'assets/other.png' },
      ],
    }));
    execution.resolve(succeeded(imagePresentation()));
    await pending;

    const updated = selectProject(useProjectStore.getState());
    expect(updated?.name).toBe('Edited while generating');
    expect(updated?.assets).toHaveLength(2);
    expect(updated?.presentation.title).toBe('Generated image');
    expect(updated?.generationHistory).toEqual([generationEntry]);
    expect(useAgentStore.getState().conversation.at(-1)?.kind).toBe('result');
  });

  it('does not give the replacement project the file of a delayed save', async () => {
    const projectA = buildProject({ name: 'Project A' });
    const projectB = buildProject({ id: 'project-2', name: 'Project B' });
    useProjectStore.getState().load(projectA, null);

    const save = defer<unknown>();
    mockChannels((channel: string) => {
      if (channel === 'koma:project:save') {
        return save.promise;
      }
      if (channel === 'koma:project:create') {
        return Promise.resolve({ project: projectB });
      }
      if (channel === 'koma:providers:cancel') {
        return Promise.resolve({ cancelled: true });
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = saveProject();
    await createNewProject();
    save.resolve({
      status: 'saved',
      project: { ...projectA, updatedAt: '2026-09-29T12:00:00.000Z' },
      file: { fileName: 'project-a.koma', displayPath: 'C:\\docs\\project-a.koma' },
    });
    await pending;

    expect(selectProject(useProjectStore.getState())?.name).toBe('Project B');
    expect(useProjectStore.getState().file).toBeNull();
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
  });

  it('ignores an older save response that arrives after a newer one', async () => {
    const project = buildProject({ name: 'Draft' });
    useProjectStore.getState().load(project, {
      fileName: 'draft.koma',
      displayPath: 'C:\\draft.koma',
    });

    const first = defer<unknown>();
    const second = defer<unknown>();
    let saves = 0;
    mockChannels((channel: string) => {
      if (channel === 'koma:project:save') {
        saves += 1;
        return saves === 1 ? first.promise : second.promise;
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pendingFirst = saveProject();
    useProjectStore.getState().apply(renameProject('Renamed'));
    const renamed = selectProject(useProjectStore.getState());
    if (renamed === null) {
      throw new Error('Expected the renamed project');
    }
    const pendingSecond = saveProject();
    second.resolve({
      status: 'saved',
      project: { ...renamed, updatedAt: '2026-09-29T15:00:00.000Z' },
      file: { fileName: 'renamed.koma', displayPath: 'C:\\renamed.koma' },
    });
    await pendingSecond;
    first.resolve({
      status: 'saved',
      project: { ...project, updatedAt: '2026-09-29T14:00:00.000Z' },
      file: { fileName: 'draft.koma', displayPath: 'C:\\draft.koma' },
    });
    await pendingFirst;

    expect(selectProject(useProjectStore.getState())?.name).toBe('Renamed');
    expect(useProjectStore.getState().file?.fileName).toBe('renamed.koma');
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
  });

  it('marks the open project saved', async () => {
    const project = buildProject({ name: 'Draft' });
    useProjectStore.getState().load(project, null);
    mockChannels((channel: string) => {
      if (channel === 'koma:project:save') {
        return Promise.resolve({
          status: 'saved',
          project: { ...project, updatedAt: '2026-09-29T12:00:00.000Z' },
          file: { fileName: 'draft.koma', displayPath: 'C:\\draft.koma' },
        });
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    await expect(saveProject()).resolves.toBe(true);
    expect(useProjectStore.getState().file?.fileName).toBe('draft.koma');
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
    expect(selectProject(useProjectStore.getState())?.name).toBe('Draft');
  });

  it('undoes back to the saved project and redoes the edit', () => {
    useProjectStore.getState().load(buildProject({ name: 'Saved' }), null);
    useProjectStore.getState().apply(renameProject('Edited'));
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(true);

    useProjectStore.getState().undo();
    expect(selectProject(useProjectStore.getState())?.name).toBe('Saved');
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);

    useProjectStore.getState().redo();
    expect(selectProject(useProjectStore.getState())?.name).toBe('Edited');
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(true);
  });

  it('leaves the window open when the document changes while saving on close', async () => {
    const project = buildProject({ name: 'Closing' });
    useProjectStore.getState().load(project, {
      fileName: 'closing.koma',
      displayPath: 'C:\\closing.koma',
    });
    const save = defer<unknown>();
    const calls: string[] = [];
    mockChannels((channel: string) => {
      calls.push(channel);
      if (channel === 'koma:project:save') {
        return save.promise;
      }
      if (channel === 'koma:app:set-unsaved-changes' || channel === 'koma:app:confirm-close') {
        return Promise.resolve({});
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = saveAndClose();
    useProjectStore.getState().apply(renameProject('Still editing'));
    save.resolve({
      status: 'saved',
      project: { ...project, updatedAt: '2026-09-29T12:00:00.000Z' },
      file: { fileName: 'closing.koma', displayPath: 'C:\\closing.koma' },
    });
    await pending;

    expect(calls).not.toContain('koma:app:confirm-close');
    expect(selectProject(useProjectStore.getState())?.name).toBe('Still editing');
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(true);
  });

  it('leaves the window open when the save dialog is cancelled', async () => {
    useProjectStore.getState().load(buildProject({ name: 'Closing' }), null);
    const calls: string[] = [];
    mockChannels((channel: string) => {
      calls.push(channel);
      if (channel === 'koma:project:save') {
        return Promise.resolve({ status: 'cancelled' });
      }
      if (channel === 'koma:app:confirm-close' || channel === 'koma:app:set-unsaved-changes') {
        return Promise.resolve({});
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    await saveAndClose();
    expect(calls).not.toContain('koma:app:confirm-close');
    expect(selectProject(useProjectStore.getState())?.name).toBe('Closing');
  });

  it('closes after saving when the saved revision is still current', async () => {
    const project = buildProject({ name: 'Closing' });
    useProjectStore.getState().load(project, null);
    const calls: string[] = [];
    mockChannels((channel: string) => {
      calls.push(channel);
      if (channel === 'koma:project:save') {
        return Promise.resolve({
          status: 'saved',
          project: { ...project, updatedAt: '2026-09-29T12:00:00.000Z' },
          file: { fileName: 'closing.koma', displayPath: 'C:\\closing.koma' },
        });
      }
      if (channel === 'koma:app:confirm-close' || channel === 'koma:app:set-unsaved-changes') {
        return Promise.resolve({});
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    await saveAndClose();
    const savedFlag = calls.indexOf('koma:app:set-unsaved-changes');
    const confirm = calls.indexOf('koma:app:confirm-close');
    expect(savedFlag).toBeGreaterThan(-1);
    expect(confirm).toBeGreaterThan(savedFlag);
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
  });

  it('does not add a logo chosen for a project that has been replaced', async () => {
    const projectA = buildProject({ name: 'Project A' });
    const projectB = buildProject({ id: 'project-2', name: 'Project B' });
    useProjectStore.getState().load(projectA, null);
    const selection = defer<unknown>();
    mockChannels((channel: string) => {
      if (channel === 'koma:brand-kit:select-logo') {
        return selection.promise;
      }
      throw new Error(`Unexpected channel ${channel}`);
    });

    const pending = chooseProjectLogo();
    useProjectStore.getState().load(projectB, null);
    selection.resolve({ status: 'selected', asset: logo });
    await pending;

    expect(selectProject(useProjectStore.getState())?.brandKit.logoAssetId).toBeNull();
    expect(selectProject(useProjectStore.getState())?.assets).toEqual([]);
  });

  it('adds a logo to the project that is still open', async () => {
    useProjectStore.getState().load(buildProject(), null);
    invokeMock.mockResolvedValue({ status: 'selected', asset: logo });

    await chooseProjectLogo();
    expect(selectProject(useProjectStore.getState())?.brandKit.logoAssetId).toBe('logo-1');
  });

  it('refuses a logo that would make the project too large to save', async () => {
    const data = 'A'.repeat(MAX_EMBEDDED_ASSET_CHARACTERS);
    const embeddedData = { encoding: 'base64' as const, data };
    const project = buildProject({
      assets: Array.from({ length: 23 }, (_, index) => ({
        ...logo,
        id: `large-asset-${index}`,
        projectPath: `assets/large-${index}.png`,
        embeddedData,
      })),
    });
    expect(serialiseProject(project).ok).toBe(true);
    useProjectStore.getState().load(project, null);
    invokeMock.mockResolvedValue({
      status: 'selected',
      asset: { ...logo, embeddedData },
    });

    await chooseProjectLogo();

    expect(selectProject(useProjectStore.getState())).toBe(project);
    expect(selectHasUnsavedChanges(useProjectStore.getState())).toBe(false);
    const notice = useUiStore.getState().notices.at(-1);
    expect(notice?.kind).toBe('error');
    expect(notice?.message).toMatch(/larger than 64 MB.*Remove an unused image/);
  }, 20_000);
});

function succeeded(presentation: Presentation): IpcResponse<'koma:providers:execute'> {
  return {
    status: 'succeeded',
    presentation,
    historyEntry: generationEntry,
    warnings: [],
    repaired: false,
    diagnostics: {
      providerId: 'mock',
      startedAt: FIXTURE_TIMESTAMP,
      finishedAt: FIXTURE_TIMESTAMP,
      durationMs: 0,
      promptTemplate: '',
      attempts: [],
    },
  };
}

describe('combined generation confirmation and asset selection', () => {
  beforeEach(resetStores);

  it('reports a failed run when applying a successful response throws', async () => {
    const initial = buildProject();
    useProjectStore.getState().load(initial, null);
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute')
        return Promise.resolve(succeeded(buildPresentation()));
      throw new Error(`Unexpected channel ${channel}`);
    });
    const apply = vi.spyOn(useProjectStore.getState(), 'apply').mockImplementationOnce(() => {
      throw new Error('Could not apply the generated presentation');
    });
    try {
      await generate({
        userRequest: 'Create Komas',
        objective: null,
        audience: null,
        requestedKomaCount: null,
      });
    } finally {
      apply.mockRestore();
    }
    expect(selectProject(useProjectStore.getState())).toBe(initial);
    expect(useAgentStore.getState().conversation.at(-1)).toMatchObject({
      kind: 'failure',
      error: { code: 'internalError' },
    });
    const run = useAgentStore.getState().lastRun;
    expect(run?.result).toBe('failed');
    expect(buildTimeline(run?.events ?? [], run?.startedAt ?? 0).at(-1)).toMatchObject({
      phase: 'failed',
      message: 'The application could not complete the request.',
    });
  });

  it('rechecks assets selected while a generation decision is pending', async () => {
    const initial = buildProject({
      assets: [availableLogo],
      brandKit: { ...buildProject().brandKit, logoAssetId: availableLogo.id },
    });
    useProjectStore.getState().load(initial, null);
    const execution = defer<unknown>();
    const selection = defer<unknown>();
    mockChannels((channel) => {
      if (channel === 'koma:providers:execute') return execution.promise;
      if (channel === 'koma:brand-kit:select-logo') return selection.promise;
      throw new Error(`Unexpected channel ${channel}`);
    });
    const pendingGeneration = generate({
      userRequest: 'Use the logo',
      objective: null,
      audience: null,
      requestedKomaCount: 1,
    });
    const pendingLogo = chooseProjectLogo();
    const firstKoma = initial.presentation.komas[0];
    if (firstKoma === undefined) throw new Error('Expected a fixture Koma');
    useProjectStore
      .getState()
      .apply(changeKomaDetails(firstKoma.id, { title: 'My concurrent edit' }));
    execution.resolve(succeeded(imagePresentation()));
    await vi.waitFor(() => expect(useUiStore.getState().confirmation).not.toBeNull());
    selection.resolve({
      status: 'selected',
      asset: {
        ...availableLogo,
        id: 'replacement-logo',
        projectPath: 'assets/replacement-logo.png',
      },
    });
    await pendingLogo;
    const beforeDecision = selectProject(useProjectStore.getState());
    expect(beforeDecision?.assets.some((asset) => asset.id === availableLogo.id)).toBe(false);
    useUiStore.getState().answerConfirmation(true);
    await pendingGeneration;
    expect(selectProject(useProjectStore.getState())).toBe(beforeDecision);
    expect(beforeDecision?.presentation.komas[0]?.title).toBe('My concurrent edit');
    expect(beforeDecision?.generationHistory).toEqual([]);
    expect(useAgentStore.getState().conversation.some((entry) => entry.kind === 'result')).toBe(
      false,
    );
    const failure = useAgentStore.getState().conversation.at(-1);
    if (failure?.kind !== 'failure') throw new Error('Expected an asset conflict failure');
    expect(failure.error.code).toBe('invalidResponse');
    expect(failure.error.message).toContain('current assets');
    expect(failure.diagnostics).toMatchObject({ providerId: 'mock', attempts: [] });
    expect(useAgentStore.getState().execution).toBeNull();
    const run = useAgentStore.getState().lastRun;
    expect(run?.result).toBe('failed');
    expect(buildTimeline(run?.events ?? [], run?.startedAt ?? 0).at(-1)).toMatchObject({
      phase: 'failed',
      message: failure.error.message,
    });
  });
});
