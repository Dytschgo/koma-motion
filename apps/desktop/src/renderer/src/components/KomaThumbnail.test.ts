// @vitest-environment jsdom
import { buildKoma, buildText } from '@koma-motion/core/testing';
import { createAssetResolver } from '@koma-motion/renderer';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { KomaThumbnail } from './KomaThumbnail';

let root: Root;
let container: HTMLDivElement;
let notify: (entries: { isIntersecting: boolean }[]) => void;
const disconnect = vi.fn();

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: typeof notify) {
        notify = callback;
      }
      observe() {
        /* Visibility is driven explicitly by the test. */
      }
      disconnect = disconnect;
    },
  );
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  expect(disconnect).toHaveBeenCalledOnce();
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('draws only nearby Komas and shows the latest edit when an offscreen thumbnail returns', () => {
  const props = {
    koma: buildKoma({ elements: [buildText({ content: { text: 'Before the edit' } })] }),
    aspectRatio: '16:9' as const,
    resolveAsset: createAssetResolver([]),
    width: 184,
    scrollRoot: { current: container },
  };
  act(() => root.render(createElement(KomaThumbnail, props)));
  const placeholder = container.querySelector('[data-koma-thumbnail]');
  expect(placeholder).not.toBeNull();
  expect(container.querySelector('[data-koma-stage]')).toBeNull();
  act(() => notify([{ isIntersecting: true }]));
  expect(container.textContent).toContain('Before the edit');
  act(() => notify([{ isIntersecting: false }]));
  expect(container.querySelector('[data-koma-stage]')).toBeNull();
  expect(container.querySelector('[data-koma-thumbnail]')).toBe(placeholder);

  const edited = buildKoma({ elements: [buildText({ content: { text: 'After the edit' } })] });
  act(() => root.render(createElement(KomaThumbnail, { ...props, koma: edited })));
  expect(container.querySelector('[data-koma-stage]')).toBeNull();
  act(() => notify([{ isIntersecting: true }]));
  expect(container.textContent).toContain('After the edit');
  expect(container.textContent).not.toContain('Before the edit');
  expect(container.querySelector('[data-koma-thumbnail]')).toBe(placeholder);

  const visibleEdit = buildKoma({
    elements: [buildText({ content: { text: 'Edited while visible' } })],
  });
  act(() => root.render(createElement(KomaThumbnail, { ...props, koma: visibleEdit })));
  expect(container.textContent).toContain('Edited while visible');
  expect(container.textContent).not.toContain('After the edit');
});
