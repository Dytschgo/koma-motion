import { useEffect, type ReactElement } from 'react';
import { subscribe } from '../lib/api';
import { attachBrandMaterial, discardBrandMaterial } from '../lib/brandProfileActions';
import { useBrandProfileStore } from '../state/brandProfileStore';
import { useProjectStore } from '../state/projectStore';
import { BrandProfileDialog } from './BrandProfileDialog';
import { Button } from './ui';

/**
 * Brand material attached in the chat: images, PDFs and decks from which a
 * Brand Kit and project instructions can be created. It is separate from
 * reference text, which is sent with a generation request.
 */
export function BrandMaterial({ disabled }: { readonly disabled: boolean }): ReactElement {
  const sessionId = useProjectStore((state) => state.sessionId);
  const state = useBrandProfileStore();
  const mine = state.projectSession === sessionId;
  const { draftId } = state;

  useEffect(() => {
    if (draftId === null) return;
    return subscribe('koma:brand-profile:progress', (event) => {
      if (event.sessionId === draftId) useBrandProfileStore.getState().setProgress(event);
    });
  }, [draftId]);

  if (!mine || (state.material === null && !state.attaching && state.error === null)) return <></>;
  const { material } = state;
  return (
    <div className="flex min-w-0 flex-col gap-1.5 rounded-control border border-line p-2">
      <div className="flex items-center gap-2 text-xs text-ink-400">
        <span className="font-medium text-ink-300">Brand material</span>
        {material !== null && (
          <span>
            {material.files.length === 1 ? '1 file' : `${String(material.files.length)} files`} ·
            session only
          </span>
        )}
      </div>
      {state.attaching && (
        <div className="flex items-center gap-2">
          <p role="status" className="min-w-0 flex-1 text-xs text-ink-300">
            {state.progress?.message ?? 'Preparing brand material…'}
          </p>
          <Button compact variant="outline" onClick={() => void discardBrandMaterial()}>
            Cancel
          </Button>
        </div>
      )}
      {material !== null && (
        <>
          <ul
            aria-label="Attached brand material"
            className="flex max-h-24 flex-col gap-0.5 overflow-y-auto text-sm"
          >
            {material.files.map((file) => (
              <li key={file.file} className="break-words">
                {file.name}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-1.5">
            <Button
              compact
              variant="primary"
              disabled={state.attaching}
              onClick={() => state.setDialogOpen(true)}
            >
              Create Brand Kit and instructions
            </Button>
            <Button
              compact
              variant="outline"
              disabled={disabled || state.attaching}
              onClick={() => void attachBrandMaterial()}
            >
              Choose other files
            </Button>
            <Button
              compact
              variant="outline"
              disabled={state.attaching}
              aria-label="Remove brand material"
              onClick={() => void discardBrandMaterial()}
            >
              Remove
            </Button>
          </div>
          <p className="text-xs text-ink-400">
            Nothing is sent until you confirm in the next step. These files are not sent with a
            generation request and are not saved in the .koma project.
          </p>
        </>
      )}
      {state.error !== null && (
        <p role="alert" className="text-sm text-motion">
          {state.error}
        </p>
      )}
      {material === null && !state.attaching && (
        <div className="flex gap-1.5">
          <Button
            compact
            variant="outline"
            disabled={disabled}
            onClick={() => void attachBrandMaterial()}
          >
            Choose files again
          </Button>
          <Button compact variant="outline" onClick={() => void discardBrandMaterial()}>
            Dismiss
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * The disclosure and review dialog. It is rendered outside the chat form, so
 * Enter in one of its fields can never send the chat request.
 */
export function BrandProfileDialogHost(): ReactElement | null {
  const sessionId = useProjectStore((state) => state.sessionId);
  const projectSession = useBrandProfileStore((state) => state.projectSession);
  const material = useBrandProfileStore((state) => state.material);
  const open = useBrandProfileStore((state) => state.dialogOpen);
  if (material === null || !open || projectSession !== sessionId) return null;
  return (
    <BrandProfileDialog
      key={material.sessionId}
      material={material}
      projectSession={sessionId}
      onClose={() => useBrandProfileStore.getState().setDialogOpen(false)}
      onFinished={() => useBrandProfileStore.getState().clear()}
    />
  );
}
