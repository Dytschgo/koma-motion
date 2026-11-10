import { useEffect, useId, useRef, type ReactElement, type ReactNode } from 'react';
import { join } from './internal';

export interface ModalFrameProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Id of the element that names the dialog. */
  readonly labelledBy: string;
  /** Selector inside the dialog to focus after it opens. Other dialogs use native focus. */
  readonly initialFocus?: string | undefined;
  readonly className?: string;
  readonly children: ReactNode;
}

/**
 * The native modal dialog without a layout. Focus stays inside it, Escape
 * closes it and focus returns to the control that opened it.
 */
export function ModalFrame({
  open,
  onClose,
  labelledBy,
  initialFocus,
  className,
  children,
}: ModalFrameProps): ReactElement {
  const reference = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = reference.current;
    if (dialog === null) {
      return;
    }
    if (open && !dialog.open) {
      dialog.showModal();
      if (initialFocus !== undefined) dialog.querySelector<HTMLElement>(initialFocus)?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocus]);

  return (
    <dialog
      ref={reference}
      aria-labelledby={labelledBy}
      className={join(
        'm-auto max-h-[85vh] max-w-[calc(100vw-2rem)] rounded-dialog border border-line-strong bg-surface-2 p-0 text-ink-100 shadow-dialog',
        className,
      )}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      {open && children}
    </dialog>
  );
}

export interface ModalProps {
  readonly title: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly children: ReactNode;
  readonly footer?: ReactNode;
  readonly width?: 'narrow' | 'wide';
  readonly initialFocus?: string | undefined;
}

/** A modal dialog with a title, a scrolling body and a footer. */
export function Modal({
  title,
  open,
  onClose,
  children,
  footer,
  width = 'narrow',
  initialFocus,
}: ModalProps): ReactElement {
  const titleId = useId();

  return (
    <ModalFrame
      open={open}
      onClose={onClose}
      labelledBy={titleId}
      initialFocus={initialFocus}
      className={width === 'narrow' ? 'w-[440px]' : 'w-[640px]'}
    >
      <div className="flex max-h-[85vh] flex-col">
        <h2
          id={titleId}
          className="border-b border-line px-6 pt-5 pb-4 text-lg font-semibold tracking-tight"
        >
          {title}
        </h2>
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{children}</div>
        {footer !== undefined && (
          <div className="flex justify-end gap-2 border-t border-line px-6 py-3">{footer}</div>
        )}
      </div>
    </ModalFrame>
  );
}
