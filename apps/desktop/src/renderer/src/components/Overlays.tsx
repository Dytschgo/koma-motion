import { useEffect, type ReactElement } from 'react';
import { useUiStore, type Notice } from '../state/uiStore';
import { CloseIcon } from './icons';
import { Button, IconButton, Modal } from './ui';

const NOTICE_DURATION_MS = 5000;

export function ConfirmDialog(): ReactElement {
  const confirmation = useUiStore((state) => state.confirmation);
  const answer = useUiStore((state) => state.answerConfirmation);
  return (
    <Modal
      title={confirmation?.title ?? ''}
      open={confirmation !== null}
      onClose={() => {
        answer(false);
      }}
      footer={
        confirmation !== null && (
          <>
            <Button
              variant="outline"
              autoFocus
              onClick={() => {
                answer(false);
              }}
            >
              {confirmation.cancelLabel}
            </Button>
            <Button
              variant={confirmation.destructive ? 'danger' : 'primary'}
              onClick={() => {
                answer(true);
              }}
            >
              {confirmation.confirmLabel}
            </Button>
          </>
        )
      }
    >
      <p className="text-ink-300">{confirmation?.message}</p>
    </Modal>
  );
}

function NoticeItem({ notice }: { readonly notice: Notice }): ReactElement {
  const dismiss = useUiStore((state) => state.dismissNotice);
  const isError = notice.kind === 'error';

  useEffect(() => {
    // Errors stay until they are dismissed.
    if (isError) {
      return;
    }
    const timer = setTimeout(() => {
      dismiss(notice.id);
    }, NOTICE_DURATION_MS);
    return () => {
      clearTimeout(timer);
    };
  }, [dismiss, isError, notice.id]);

  return (
    <li
      role={isError ? 'alert' : 'status'}
      className={`flex w-96 items-start gap-2 rounded-card border border-l-[3px] bg-surface-3 py-2 pr-1 pl-3 shadow-popover ${
        isError ? 'border-motion/60 border-l-motion' : 'border-line-strong border-l-accent'
      }`}
    >
      <p className="min-w-0 flex-1 py-1 whitespace-pre-wrap select-text">
        {isError && <span className="font-semibold text-motion">Error: </span>}
        {notice.message}
      </p>
      <IconButton
        label="Dismiss"
        onClick={() => {
          dismiss(notice.id);
        }}
      >
        <CloseIcon />
      </IconButton>
    </li>
  );
}

export function Notices(): ReactElement {
  const notices = useUiStore((state) => state.notices);
  return (
    <ul aria-label="Messages" className="fixed top-13 right-3 z-50 flex flex-col gap-2">
      {notices.map((notice) => (
        <NoticeItem key={notice.id} notice={notice} />
      ))}
    </ul>
  );
}
