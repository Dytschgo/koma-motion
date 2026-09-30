// @vitest-environment jsdom
import { MAX_ELEMENT_TEXT_LENGTH, type KomaElement } from '@koma-motion/core';
import { buildKoma, buildText } from '@koma-motion/core/testing';
import { komaToFrame } from '@koma-motion/motion-engine';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KomaStage, type KomaStageProps } from './KomaStage';
import { commitTextDraft } from './textEditing';

const original = buildText({ content: { text: '  Original\ncopy  ' } });
let host: HTMLDivElement;
let root: Root;
let props: KomaStageProps;
let commits: KomaElement[];
function render(patch: Partial<KomaStageProps> = {}): void {
  props = { ...props, ...patch };
  act(() => root.render(createElement(KomaStage, props)));
}
function element(): HTMLElement {
  const target = host.querySelector<HTMLElement>('[data-element-id]');
  if (!target) throw new Error('Missing element');
  return target;
}
function editor(): HTMLTextAreaElement {
  const target = host.querySelector('textarea');
  if (!target) throw new Error('Missing text editor');
  return target;
}
function key(target: HTMLElement, value: string, options: KeyboardEventInit = {}): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    key: value,
    bubbles: true,
    cancelable: true,
    ...options,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event;
}
function enter(): void {
  key(element(), 'Enter');
}
function fill(value: string): void {
  const target = editor();
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set?.call(
      target,
      value,
    );
    target.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  commits = [];
  props = {
    frame: komaToFrame(buildKoma({ elements: [original] })),
    canvasSize: { width: 1920, height: 1080 },
    scale: 0.5,
    resolveAsset: () => ({ status: 'missing', reason: 'No assets' }),
    label: 'Canvas',
    selectedElementId: original.id,
    onSelectElement: vi.fn(),
    onCommitElement: (item) => {
      commits.push(item);
    },
  };
  render();
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe('direct text editing', () => {
  it.each(['ctrlKey', 'metaKey'] as const)(
    'commits once with %s+Enter and restores keyboard focus',
    (modifier) => {
      enter();
      expect(document.activeElement).toBe(editor());
      expect(editor().selectionStart).toBe(original.content.text.length);
      expect(editor().selectionEnd).toBe(original.content.text.length);
      fill('First line\nSecond line');
      key(editor(), 'Enter', { [modifier]: true });
      expect(commits).toEqual([{ ...original, content: { text: 'First line\nSecond line' } }]);
      expect(host.querySelector('textarea')).toBeNull();
      expect(document.activeElement).toBe(element());
    },
  );

  it('leaves Enter, selection and caret keys native and ignores IME confirmation/cancellation', () => {
    enter();
    const bubble = vi.fn();
    window.addEventListener('keydown', bubble);
    for (const value of ['Enter', 'ArrowLeft', 'ArrowRight', 'Home', 'End']) {
      expect(key(editor(), value).defaultPrevented).toBe(false);
    }
    key(editor(), 'Enter', { ctrlKey: true, isComposing: true });
    key(editor(), 'Escape', { isComposing: true });
    expect(commits).toEqual([]);
    expect(host.querySelectorAll('textarea')).toHaveLength(1);
    expect(bubble).not.toHaveBeenCalled();
    window.removeEventListener('keydown', bubble);
  });

  it('cancels exact whitespace/newlines without a document command', () => {
    enter();
    fill('Discard');
    key(editor(), 'Escape');
    expect(commits).toEqual([]);
    expect(element().textContent).toBe(original.content.text);
    enter();
    expect(editor().value).toBe(original.content.text);
  });

  it('commits on focus exit without stealing the destination focus', () => {
    enter();
    fill('Focus exit');
    const outside = document.createElement('button');
    document.body.append(outside);
    act(() => outside.focus());
    expect(commits[0]?.content).toEqual({ text: 'Focus exit' });
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('commits before forwarding Save and blocks Save for an invalid draft', () => {
    const saved = vi.fn(() => commits.at(-1));
    window.addEventListener('keydown', saved);
    enter();
    fill('Save this');
    key(editor(), 's', { ctrlKey: true });
    expect(saved).toHaveReturnedWith({ ...original, content: { text: 'Save this' } });
    enter();
    fill('x'.repeat(MAX_ELEMENT_TEXT_LENGTH + 1));
    saved.mockClear();
    expect(key(editor(), 's', { ctrlKey: true }).defaultPrevented).toBe(true);
    expect(saved).not.toHaveBeenCalled();
    expect(editor().value).toHaveLength(MAX_ELEMENT_TEXT_LENGTH + 1);
    window.removeEventListener('keydown', saved);
  });

  it('retains an invalid draft and blocks outside actions until correction or Escape', () => {
    enter();
    fill('x'.repeat(MAX_ELEMENT_TEXT_LENGTH + 1));
    const outside = document.createElement('button');
    const action = vi.fn();
    outside.addEventListener('pointerdown', action);
    document.body.append(outside);
    act(() => {
      outside.dispatchEvent(new Event('pointerdown', { bubbles: true, cancelable: true }));
    });
    expect(action).not.toHaveBeenCalled();
    outside.addEventListener('click', action);
    act(() => {
      outside.click();
    });
    expect(action).not.toHaveBeenCalled();
    expect(commits).toEqual([]);
    expect(editor().value).toHaveLength(MAX_ELEMENT_TEXT_LENGTH + 1);
    expect(document.activeElement).toBe(host.querySelector('[role="alert"]'));
    act(() => editor().focus());
    fill('Recovered');
    key(editor(), 'Enter', { ctrlKey: true });
    expect(commits[0]?.content).toEqual({ text: 'Recovered' });
    outside.remove();
  });

  it('keeps a host command failure recoverable and allows cancellation from the error', () => {
    render({
      onCommitElement: () => {
        throw new Error('Document is unavailable');
      },
    });
    enter();
    fill('Keep this');
    key(editor(), 'Enter', { ctrlKey: true });
    expect(editor().value).toBe('Keep this');
    const error = host.querySelector<HTMLElement>('[role="alert"]');
    expect(error?.textContent).toContain('Document is unavailable');
    if (!error) throw new Error('Missing error');
    key(error, 'Escape');
    expect(host.querySelector('textarea')).toBeNull();
    expect(element().textContent).toBe(original.content.text);
  });

  it('preserves draft and caret across zoom and removes resize controls only during editing', () => {
    expect(host.querySelectorAll('[aria-label^="Resize"]')).toHaveLength(4);
    enter();
    fill('Zoom draft');
    editor().setSelectionRange(2, 5);
    render({ scale: 0.8 });
    expect(editor().value).toBe('Zoom draft');
    expect(editor().selectionStart).toBe(2);
    expect(editor().selectionEnd).toBe(5);
    expect(host.querySelectorAll('[aria-label^="Resize"]')).toHaveLength(0);
    key(editor(), 'Escape');
    expect(host.querySelectorAll('[aria-label^="Resize"]')).toHaveLength(4);
  });

  it.each(['selection', 'frame', 'preview', 'project'] as const)(
    'discards a session on %s changes without reviving it later',
    (change) => {
      enter();
      fill('Stale draft');
      const previous = props;
      if (change === 'selection') render({ selectedElementId: null });
      if (change === 'frame') render({ frame: komaToFrame(buildKoma({ elements: [original] })) });
      if (change === 'preview') render({ onSelectElement: undefined, onCommitElement: undefined });
      if (change === 'project')
        act(() => root.render(createElement(KomaStage, { ...props, key: 'new-project' })));
      expect(host.querySelector('textarea')).toBeNull();
      render(previous);
      expect(host.querySelector('textarea')).toBeNull();
      expect(commits).toEqual([]);
    },
  );
});

it('does not create undo steps for unchanged text and permits empty text', () => {
  const commit = vi.fn();
  expect(commitTextDraft(original, original.content.text, commit)).toBeNull();
  expect(commit).not.toHaveBeenCalled();
  expect(commitTextDraft(original, '', commit)).toBeNull();
  expect(commit).toHaveBeenCalledWith({ ...original, content: { text: '' } });
});
