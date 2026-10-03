// @vitest-environment jsdom
import { buildProject } from '@koma-motion/core/testing';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { applySavedBrandKitToProject } from '../lib/brandKitLibraryActions';
import { useBrandKitLibraryStore } from '../state/brandKitLibraryStore';
import { useProjectStore } from '../state/projectStore';
import { ChatBrandKitPicker } from './ChatBrandKitPicker';

vi.mock('../lib/brandKitLibraryActions', () => ({
  loadBrandKitLibrary: vi.fn(),
  applySavedBrandKitToProject: vi.fn(),
}));

let root: Root;
let container: HTMLDivElement;
let finish: (reject?: boolean) => Promise<void>;
let trigger: HTMLButtonElement;

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const project = buildProject();
  useProjectStore.getState().load(project, null);
  useBrandKitLibraryStore.setState({
    busy: false,
    library: {
      status: 'ready',
      unreadableCount: 0,
      kits: [
        {
          id: 'saved',
          name: 'Saved kit',
          createdAt: '2026-10-01T12:00:00Z',
          updatedAt: '2026-10-01T12:00:00Z',
          brandKit: { ...project.brandKit, logoAssetId: null },
          logo: null,
        },
      ],
    },
  });
  let resolve: () => void;
  let reject: () => void;
  const pending = new Promise<void>((done, fail) => {
    resolve = done;
    reject = () => fail(new Error('Load failed'));
  });
  vi.mocked(applySavedBrandKitToProject).mockImplementation(() => {
    useBrandKitLibraryStore.getState().setBusy(true);
    return pending;
  });
  finish = async (failed = false) => {
    await act(async () => {
      useBrandKitLibraryStore.getState().setBusy(false);
      if (failed) reject();
      else resolve();
      await pending.catch(() => undefined);
    });
  };
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  function Picker() {
    const [open, setOpen] = useState(true);
    return createElement(ChatBrandKitPicker, {
      project,
      open,
      onOpenChange: setOpen,
      disabled: false,
    });
  }
  act(() => root.render(createElement(Picker)));
  trigger = container.querySelector<HTMLButtonElement>('[aria-label="Choose Brand Kit"]')!;
  act(() => container.querySelector<HTMLButtonElement>('[data-kit-choice]')!.click());
  expect(trigger.disabled).toBe(true);
  // Chromium drops focus when the library request disables this button.
  const focusSink = document.createElement('button');
  document.body.append(focusSink);
  act(() => focusSink.focus());
  focusSink.remove();
  expect(document.activeElement).toBe(document.body);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  document.body.replaceChildren();
  useBrandKitLibraryStore.setState({ busy: false, library: { status: 'idle' } });
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it.each([false, true])(
  'returns keyboard focus after an apply settles (rejected: %s)',
  async (failed) => {
    await finish(failed);
    expect(trigger.disabled).toBe(false);
    expect(document.activeElement).toBe(trigger);
  },
);

it('keeps focus on a control chosen while the kit is loading', async () => {
  const other = document.createElement('button');
  document.body.append(other);
  other.focus();
  await finish();
  expect(document.activeElement).toBe(other);
});

it('does not return focus into a replaced project session', async () => {
  act(() => useProjectStore.getState().load(buildProject(), null));
  await finish();
  expect(document.activeElement).toBe(document.body);
});

it('does not focus a picker that unmounted while applying', async () => {
  act(() => root.unmount());
  const other = document.createElement('button');
  document.body.append(other);
  other.focus();
  await finish();
  expect(document.activeElement).toBe(other);
});
