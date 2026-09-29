import type { AssetReference, GenerationHistoryEntry, Presentation } from '@koma-motion/core';
import { buildPresentation, buildProject, FIXTURE_TIMESTAMP } from '@koma-motion/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useAgentStore } from '../state/agentStore';
import { renameProject } from '../state/commands';
import { selectHasUnsavedChanges, selectProject, useProjectStore } from '../state/projectStore';
import { useUiStore } from '../state/uiStore';
import { generate } from './agentActions';
import { invoke } from './api';
import { chooseProjectLogo, createNewProject, saveAndClose, saveProject } from './projectActions';

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
});

function succeeded(presentation: Presentation): unknown {
  return {
    status: 'succeeded',
    presentation,
    historyEntry: generationEntry,
    warnings: [],
  };
}
