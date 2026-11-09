import {
  Component,
  useId,
  useState,
  type ErrorInfo,
  type ReactElement,
  type ReactNode,
} from 'react';
import { preserveWork, reloadWindow, reportError } from '../lib/diagnostics';
import { DiagnosticsActions } from './Diagnostics';
import { Button } from './ui';

/** Shown instead of the interface after an error it could not handle. */
function FailureScreen(): ReactElement {
  const [reloading, setReloading] = useState(false);
  const titleId = useId();
  return (
    <main
      aria-labelledby={titleId}
      className="grid h-full place-items-center overflow-y-auto bg-surface-1 p-6"
    >
      <div className="flex w-[min(34rem,100%)] flex-col gap-4 rounded-dialog border border-line-strong bg-surface-2 p-6 shadow-dialog">
        <h1 id={titleId} className="text-xl font-semibold tracking-tight">
          Something went wrong
        </h1>
        <p role="alert">
          Koma Motion ran into an error and cannot show this window. Reload the window to continue.
        </p>
        <p className="text-ink-300">
          If your project has unsaved changes, Koma Motion offers to recover them as an unsaved copy
          after the reload. Changes from the last moments may be missing. Your project file has not
          been changed.
        </p>
        <div>
          <Button
            variant="primary"
            autoFocus
            disabled={reloading}
            onClick={() => {
              setReloading(true);
              void reloadWindow();
            }}
          >
            {reloading ? 'Reloading…' : 'Reload window'}
          </Button>
        </div>
        <div className="border-t border-line pt-4">
          <p className="mb-2 text-sm text-ink-400">
            The diagnostics log describes this error without your project. You can attach it to a
            report.
          </p>
          <DiagnosticsActions />
        </div>
      </div>
    </main>
  );
}

/**
 * Catches errors of rendering below it. React removes the failed interface;
 * this shows a screen that explains what happened and how to continue.
 */
export class ErrorBoundary extends Component<
  { readonly children: ReactNode },
  { readonly failed: boolean }
> {
  override state = { failed: false };

  static getDerivedStateFromError(): { readonly failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: unknown, info: ErrorInfo): void {
    reportError('render', error, info.componentStack ?? '');
    void preserveWork();
  }

  override render(): ReactNode {
    return this.state.failed ? <FailureScreen /> : this.props.children;
  }
}
