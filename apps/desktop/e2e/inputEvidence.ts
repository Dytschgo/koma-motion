import type { Page } from '@playwright/test';

/** Input provenance for intermittent native failures. Never records field values. */
export async function recordInputEvidence(window: Page): Promise<() => readonly unknown[]> {
  const events: unknown[] = [];
  await window.exposeFunction('recordKomaTestInput', (entry: unknown) => events.push(entry));
  await window.evaluate(() => {
    const record = (
      globalThis as unknown as { recordKomaTestInput: (entry: unknown) => Promise<void> }
    ).recordKomaTestInput;
    for (const type of ['keydown', 'keyup', 'input', 'click', 'cancel']) {
      document.addEventListener(
        type,
        (event) => {
          const target = event.target;
          const field = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
          void record({
            at: Date.now(),
            type,
            trusted: event.isTrusted,
            target:
              target instanceof Element
                ? (target.getAttribute('aria-label') ?? target.tagName)
                : null,
            length: field ? target.value.length : null,
            selection: field ? [target.selectionStart, target.selectionEnd] : null,
            ...(event instanceof KeyboardEvent
              ? {
                  key: event.key.length === 1 ? 'character' : event.key,
                  ctrl: event.ctrlKey,
                  meta: event.metaKey,
                  shift: event.shiftKey,
                  alt: event.altKey,
                }
              : {}),
          });
        },
        true,
      );
    }
  });
  return () => events;
}
