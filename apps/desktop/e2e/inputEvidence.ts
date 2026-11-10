import type { ElectronApplication, Page } from '@playwright/test';

interface PointerEvidence {
  readonly at: number;
  readonly source: 'main' | 'page';
  readonly what: string;
}

const POINTER_EVIDENCE_LIMIT = 400;

function isPointerEvidence(value: unknown): value is PointerEvidence[] {
  return (
    Array.isArray(value) &&
    value.every(
      (entry: unknown) =>
        typeof entry === 'object' &&
        entry !== null &&
        'at' in entry &&
        typeof entry.at === 'number' &&
        'what' in entry &&
        typeof entry.what === 'string',
    )
  );
}

/**
 * Pointer provenance for a drag that loses its pointer capture (issue #108).
 *
 * A test drives the pointer through the debugger. Any other pointer move that
 * reaches the page with no button held ends the capture, and the page cancels
 * the drag. Each side keeps its last 400 entries: the mouse input the window
 * forwarded to the page, with the position of the real pointer in the same
 * coordinates, the window's focus and geometry events, and the pointer events
 * the page saw. An entry of the main process at the real pointer's position
 * that the test did not send names the source.
 */
export async function recordPointerEvidence(
  application: ElectronApplication,
  window: Page,
): Promise<() => Promise<readonly PointerEvidence[]>> {
  await application.evaluate(({ BrowserWindow, screen }, limit) => {
    const target = BrowserWindow.getAllWindows()[0];
    if (!target) throw new Error('Expected the test window');
    const log: { at: number; source: 'main'; what: string }[] = [];
    Reflect.set(globalThis, '__komaPointerEvidence', log);
    const record = (what: string): void => {
      const point = screen.getCursorScreenPoint();
      const content = target.getContentBounds();
      log.push({
        at: Date.now(),
        source: 'main',
        what: `${what} realPointer=${String(point.x - content.x)},${String(point.y - content.y)} focused=${String(target.isFocused())}`,
      });
      if (log.length > limit) log.shift();
    };
    record('recording');
    target.on('focus', () => record('window focus'));
    target.on('blur', () => record('window blur'));
    target.on('resize', () => record('window resize'));
    target.on('move', () => record('window move'));
    target.webContents.on('input-event', (_event, input) => {
      if (!input.type.startsWith('mouse')) return;
      const position =
        'x' in input && 'y' in input ? `${String(input.x)},${String(input.y)}` : 'unknown';
      const button = 'button' in input ? String(input.button) : 'unknown';
      record(`input ${input.type} at=${position} button=${button}`);
    });
  }, POINTER_EVIDENCE_LIMIT);
  await window.evaluate((limit) => {
    const log: { at: number; source: 'page'; what: string }[] = [];
    Reflect.set(window, '__komaPointerEvidence', log);
    for (const type of [
      'pointerdown',
      'pointermove',
      'pointerup',
      'pointercancel',
      'gotpointercapture',
      'lostpointercapture',
    ]) {
      document.addEventListener(
        type,
        (event) => {
          if (!(event instanceof PointerEvent)) return;
          log.push({
            at: Date.now(),
            source: 'page',
            what: `${type} at=${String(event.clientX)},${String(event.clientY)} buttons=${String(event.buttons)} pointerType=${event.pointerType} trusted=${String(event.isTrusted)}`,
          });
          if (log.length > limit) log.shift();
        },
        true,
      );
    }
  }, POINTER_EVIDENCE_LIMIT);
  return async () => {
    const main = await application.evaluate((): unknown =>
      Reflect.get(globalThis, '__komaPointerEvidence'),
    );
    const page = await window.evaluate((): unknown => Reflect.get(window, '__komaPointerEvidence'));
    return [
      ...(isPointerEvidence(main) ? main : []),
      ...(isPointerEvidence(page) ? page : []),
    ].sort((left, right) => left.at - right.at);
  };
}

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
