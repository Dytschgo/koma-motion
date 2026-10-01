import type { ReactElement } from 'react';
import { attachReferences } from '../lib/referenceActions';
import { useProjectStore } from '../state/projectStore';
import { useReferenceStore } from '../state/referenceStore';
import { Button } from './ui';
import { PlusIcon } from './icons';

export function ReferenceAttachmentButton({
  disabled,
}: {
  readonly disabled: boolean;
}): ReactElement {
  const selecting = useReferenceStore((state) => state.selecting);
  return (
    <button
      type="button"
      aria-label={selecting ? 'Reading references…' : 'Attach references'}
      title="Attach references"
      disabled={disabled || selecting}
      onClick={() => void attachReferences()}
      className="flex size-9 items-center justify-center rounded-control text-ink-300 hover:bg-surface-3 disabled:opacity-50"
    >
      <PlusIcon size={16} />
    </button>
  );
}

export function ReferenceFiles({
  disabled,
  showButton = true,
}: {
  readonly disabled: boolean;
  readonly showButton?: boolean;
}): ReactElement {
  const sessionId = useProjectStore((state) => state.sessionId);
  const state = useReferenceStore();
  const references = state.sessionId === sessionId ? state.references : [];
  if (!showButton && references.length === 0 && state.error === null && !state.selecting)
    return <></>;
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <div className="flex items-center gap-2">
        {showButton && (
          <Button
            compact
            variant="outline"
            disabled={disabled || state.selecting}
            onClick={() => void attachReferences()}
          >
            {state.selecting ? 'Reading references…' : 'Attach references'}
          </Button>
        )}
        {!showButton && state.selecting && (
          <span role="status" className="text-xs text-ink-300">
            Reading references…
          </span>
        )}
        {references.length > 0 && (
          <span className="text-xs text-ink-400">{references.length} attached · session only</span>
        )}
      </div>
      {references.length > 0 && (
        <div className="max-h-32 overflow-y-auto rounded-control border border-line p-2">
          <ul aria-label="Attached references" className="flex flex-col gap-2 text-sm">
            {references.map((reference) => (
              <li key={reference.id}>
                <div className="flex items-start gap-2">
                  <details className="min-w-0 flex-1">
                    <summary className="cursor-pointer break-words">
                      {reference.name} · {reference.text.length.toLocaleString()} characters
                    </summary>
                    <p className="mt-1 whitespace-pre-wrap break-words text-xs text-ink-300">
                      {reference.text}
                    </p>
                  </details>
                  <Button
                    compact
                    variant="outline"
                    disabled={disabled}
                    aria-label={`Remove ${reference.name}`}
                    onClick={() =>
                      state.setReferences(
                        sessionId,
                        references.filter((item) => item.id !== reference.id),
                      )
                    }
                  >
                    Remove
                  </Button>
                </div>
                {reference.truncated && (
                  <p className="text-signal-warn">
                    Only part of this file was extracted. Review the text before generating.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {state.error !== null && (
        <p role="alert" className="text-sm text-motion">
          {state.error}
        </p>
      )}
      {references.length > 0 && (
        <p className="text-xs text-ink-400">
          Only the extracted text shown above is sent. Images, original files, and file paths are
          not sent. References are not saved in the .koma project.
        </p>
      )}
    </div>
  );
}
