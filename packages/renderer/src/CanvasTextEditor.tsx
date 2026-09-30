import type { Size, TextElement } from '@koma-motion/core';
import {
  useCallback,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactElement,
} from 'react';
import { textEditorBox } from './layout';
import { commitTextDraft } from './textEditing';

/** A disposable session: only a successful commit changes the document. */
export function CanvasTextEditor({
  element,
  canvasSize,
  scale,
  background,
  onCommit,
  onClose,
}: {
  readonly element: TextElement;
  readonly canvasSize: Size;
  readonly scale: number;
  readonly background: string;
  readonly onCommit: (element: TextElement) => void;
  readonly onClose: (restoreFocus: boolean) => void;
}): ReactElement {
  const surface = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const alert = useRef<HTMLDivElement>(null);
  const measure = useRef<HTMLDivElement>(null);
  const ended = useRef(false);
  const [text, setText] = useState(element.content.text);
  const [error, setError] = useState<{ message: string } | null>(null);
  const hintId = useId();
  const errorId = useId();
  const box = textEditorBox(element, canvasSize, scale);
  const typography: CSSProperties = {
    fontFamily: `${element.style.fontFamily}, system-ui, sans-serif`,
    fontSize: element.style.fontSize * scale,
    fontWeight: element.style.fontWeight,
    lineHeight: element.style.lineHeight,
    textAlign: element.style.textAlign,
    whiteSpace: 'pre-wrap',
    overflowWrap: 'break-word',
  };
  const finish = useCallback(
    (restoreFocus: boolean): boolean => {
      if (ended.current) return true;
      const message = commitTextDraft(element, text, onCommit);
      if (message !== null) {
        setError({ message });
        return false;
      }
      ended.current = true;
      onClose(restoreFocus);
      return true;
    },
    [element, text, onCommit, onClose],
  );

  useLayoutEffect(() => {
    const editor = input.current;
    if (editor) {
      editor.focus({ preventScroll: true });
      editor.setSelectionRange(editor.value.length, editor.value.length);
    }
  }, []);
  useLayoutEffect(() => {
    if (error) alert.current?.focus({ preventScroll: true });
  }, [error]);
  useLayoutEffect(() => {
    if (!input.current || !measure.current) return;
    const space = Math.max(0, box.height - measure.current.getBoundingClientRect().height);
    const align = element.style.verticalAlign;
    input.current.style.paddingTop = `${String(align === 'bottom' ? space : align === 'middle' ? space / 2 : 0)}px`;
  }, [box.height, box.width, element.style, scale, text]);
  useLayoutEffect(() => {
    // Commit before outside selection/preview handlers can unmount the draft.
    const outside = (event: Event): void => {
      if (event.target instanceof Node && !surface.current?.contains(event.target)) {
        if (!finish(false)) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }
    };
    document.addEventListener('pointerdown', outside, true);
    // Cancelling pointerdown does not cancel the later click (or an AT-generated click).
    document.addEventListener('click', outside, true);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('click', outside, true);
    };
  }, [finish]);

  return (
    <div
      ref={surface}
      role="group"
      aria-label="Canvas text editing"
      onPointerDown={(event) => event.stopPropagation()}
      onPointerCancel={(event) => event.stopPropagation()}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) finish(false);
      }}
      onKeyDown={(event) => {
        // Keep native caret, selection, newlines and local text undo isolated from the canvas.
        if ((event.ctrlKey || event.metaKey) && ['s', 'o', 'n'].includes(event.key.toLowerCase())) {
          if (event.key.toLowerCase() !== 's' || finish(false)) return;
          event.preventDefault();
        }
        event.stopPropagation();
        if (event.nativeEvent.isComposing) return;
        if (event.key === 'Escape') {
          event.preventDefault();
          ended.current = true;
          onClose(true);
        } else if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
          event.preventDefault();
          finish(true);
        }
      }}
      style={{ position: 'absolute', inset: 0, zIndex: 20002, pointerEvents: 'none' }}
    >
      <div
        ref={measure}
        aria-hidden="true"
        style={{
          ...typography,
          position: 'absolute',
          width: box.width,
          visibility: 'hidden',
          pointerEvents: 'none',
        }}
      >
        {text + '\u200b'}
      </div>
      <textarea
        ref={input}
        aria-label={`Edit text: ${element.name}`}
        aria-describedby={error ? `${hintId} ${errorId}` : hintId}
        aria-invalid={error !== null}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        style={{
          position: 'absolute',
          ...box,
          transform: `rotate(${String(element.rotation)}deg)`,
          boxSizing: 'border-box',
          resize: 'none',
          pointerEvents: 'auto',
          background,
          color: element.style.colour,
          ...typography,
          border: 0,
          borderRadius: 0,
          outline: '2px solid #FF5A36',
          outlineOffset: -2,
          padding: 0,
          margin: 0,
          userSelect: 'text',
          touchAction: 'auto',
        }}
      />
      <div
        style={{
          position: 'absolute',
          left: Math.max(8, Math.min(box.left, canvasSize.width * scale - 368)),
          top: Math.max(
            8,
            Math.min(box.top + box.height + 8, canvasSize.height * scale - (error ? 140 : 56)),
          ),
          maxWidth: 'min(360px, calc(100% - 16px))',
          maxHeight: 'calc(100% - 16px)',
          overflow: 'auto',
          background: '#182230',
          color: '#fff',
          borderRadius: 4,
          padding: '4px 8px',
          font: '12px system-ui',
          pointerEvents: 'auto',
        }}
      >
        <span id={hintId}>Editing text · Ctrl/⌘+Enter to finish · Esc to cancel</span>
        {error && (
          <>
            <div ref={alert} id={errorId} role="alert" tabIndex={-1} style={{ marginTop: 4 }}>
              {error.message} Your draft is kept. Edit it or press Esc to cancel.
            </div>
            <button
              type="button"
              onClick={() => input.current?.focus()}
              style={{ marginTop: 4, textDecoration: 'underline', cursor: 'pointer' }}
            >
              Return to text
            </button>
          </>
        )}
      </div>
    </div>
  );
}
