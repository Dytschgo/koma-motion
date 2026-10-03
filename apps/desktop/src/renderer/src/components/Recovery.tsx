import { useEffect, useState, type ReactElement } from 'react';
import type { RecoveryOffer } from '../../../shared/recovery';
import { invoke } from '../lib/api';
import { recoverProject } from '../lib/projectActions';
import { flushRecovery, useRecoveryStatus } from '../lib/recovery';
import { Button, Modal } from './ui';

export function Recovery(): ReactElement {
  const [offer, setOffer] = useState<RecoveryOffer | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useRecoveryStatus();
  useEffect(() => {
    void invoke('koma:recovery:offer', {})
      .then(setOffer)
      .catch(() =>
        setError('Recovery could not be checked. Restart the application to try again.'),
      );
  }, []);
  const decide = async (recover: boolean): Promise<void> => {
    setBusy(true);
    setError('');
    try {
      if (recover) await recoverProject();
      else {
        const response = await invoke('koma:recovery:discard', {});
        if (response.status === 'failed') throw new Error(response.message);
      }
      setOffer({ status: 'none' });
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Recovery failed. Try again.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      {status.message && (
        <div
          role={status.failed ? 'alert' : 'status'}
          className="flex items-center gap-3 border-t border-line bg-surface-2 px-4 py-1 text-xs text-ink-300"
        >
          <span>{status.message}</span>
          {status.failed && (
            <Button
              variant="outline"
              onClick={() => {
                void flushRecovery();
              }}
            >
              Retry recovery snapshot
            </Button>
          )}
        </div>
      )}
      <Modal
        title="Recover interrupted work"
        open={offer?.status !== 'none'}
        onClose={() => undefined}
        footer={
          offer !== null && offer.status !== 'none' ? (
            <>
              <Button
                variant="danger"
                disabled={busy}
                onClick={() => {
                  void decide(false);
                }}
              >
                Discard recovery
              </Button>
              {offer.status === 'available' && (
                <Button
                  autoFocus
                  disabled={busy}
                  onClick={() => {
                    void decide(true);
                  }}
                >
                  Recover unsaved copy
                </Button>
              )}
            </>
          ) : undefined
        }
      >
        {offer === null ? (
          <p>Checking for a recovery snapshot…</p>
        ) : offer.status === 'available' ? (
          <>
            <p className="mb-3">
              {offer.name} has a recovery snapshot from{' '}
              {new Date(offer.capturedAt).toLocaleString()}.
            </p>
            <p>
              Recover committed edits as an unsaved copy. Your original file stays unchanged. Chat,
              attached references and unfinished text drafts are not included.
            </p>
          </>
        ) : offer.status === 'damaged' ? (
          <p>{offer.message}</p>
        ) : null}
        {error && (
          <p role="alert" className="mt-3 text-motion">
            {error}
          </p>
        )}
      </Modal>
    </>
  );
}
