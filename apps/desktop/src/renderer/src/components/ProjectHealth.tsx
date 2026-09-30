import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import { repairAsset, repairIsLocked, type RepairResult } from '../lib/assetRepairs';
import { collectHealthIssues, type HealthIssue } from '../lib/projectHealth';
import { openProject, saveProject, saveProjectCopy } from '../lib/projectActions';
import { selectProject, useProjectStore } from '../state/projectStore';
import { useHealthStore } from '../state/healthStore';
import { useUiStore } from '../state/uiStore';
import { Button, Modal } from './ui';

function HealthContents(): ReactElement {
  const project = useProjectStore(selectProject);
  const loadWarnings = useProjectStore((state) => state.loadWarnings);
  const migratedFrom = useProjectStore((state) => state.migratedFrom);
  const sessionId = useProjectStore((state) => state.sessionId);
  const failure = useHealthStore((state) => state.failure);
  const issues = useMemo(
    () => collectHealthIssues(project, loadWarnings, migratedFrom),
    [project, loadWarnings, migratedFrom],
  );
  const [hidden, setHidden] = useState<readonly string[]>([]);
  const [feedback, setFeedback] = useState<Record<string, RepairResult>>({});
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  const heading = useRef<HTMLParagraphElement>(null);

  async function run(id: string, action: () => Promise<RepairResult>): Promise<void> {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const result = await action();
      if (useProjectStore.getState().sessionId === sessionId) {
        setFeedback((previous) => ({ ...previous, [id]: result }));
        if (result.status === 'fixed') heading.current?.focus();
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  async function save(copy: boolean): Promise<RepairResult> {
    const before = useProjectStore.getState().appliedSaveSerial;
    const failure: { message: string | null } = { message: null };
    const onFailure = (message: string): void => {
      failure.message = message;
    };
    const saved = await (copy ? saveProjectCopy(onFailure) : saveProject(onFailure));
    const state = useProjectStore.getState();
    if (saved) return { status: 'fixed', message: 'Project saved in the current format.' };
    if (
      state.sessionId === sessionId &&
      state.appliedSaveSerial > before &&
      state.migratedFrom === null
    )
      return {
        status: 'fixed',
        message: 'Current format saved. Newer edits are still unsaved; save again to keep them.',
      };
    return {
      status: failure.message === null ? 'cancelled' : 'failed',
      message:
        failure.message === null
          ? 'Save cancelled. The upgraded project and your edits are kept in memory.'
          : `Save did not complete. ${failure.message} Your edits are kept; try again or save a copy.`,
    };
  }
  const visible = issues.filter((issue) => !hidden.includes(issue.id));
  const resolved = Object.entries(feedback).filter(
    ([id, result]) => result.status === 'fixed' && !issues.some((issue) => issue.id === id),
  );

  function row(issue: HealthIssue): ReactElement {
    const locked =
      project !== null && issue.repair !== undefined && repairIsLocked(project, issue.repair);
    const result = feedback[issue.id];
    const descriptionId = `health-message-${String(issues.indexOf(issue))}`;
    return (
      <li key={issue.id} className="min-w-0 rounded-lg border border-desk-600 p-3">
        <p id={descriptionId} className="wrap-anywhere whitespace-pre-wrap select-text">
          {issue.message}
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          {issue.id === 'migration' && (
            <>
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => void run(issue.id, () => save(false))}
              >
                Save current format
              </Button>
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void run(issue.id, () => save(true))}
              >
                Save a copy
              </Button>
            </>
          )}
          {issue.repair && (
            <>
              {issue.repair.target.kind !== 'asset' && (
                <Button
                  variant="outline"
                  aria-describedby={descriptionId}
                  disabled={busy || locked}
                  onClick={() => void run(issue.id, () => repairAsset(issue.repair!, 'replace'))}
                >
                  {issue.repair.target.kind === 'logo' ? 'Replace logo' : 'Replace image'}
                </Button>
              )}
              <Button
                variant="outline"
                aria-describedby={descriptionId}
                disabled={busy || locked}
                onClick={() => void run(issue.id, () => repairAsset(issue.repair!, 'remove'))}
              >
                {issue.repair.target.kind === 'logo'
                  ? 'Clear logo'
                  : issue.repair.target.kind === 'asset'
                    ? 'Remove unused asset'
                    : 'Remove image'}
              </Button>
              {issue.repair.target.kind === 'image' && (
                <Button
                  disabled={busy}
                  onClick={() => {
                    const target = issue.repair!.target;
                    if (target.kind !== 'image') return;
                    useUiStore.getState().selectKoma(target.komaId);
                    const parent = project?.presentation.komas
                      .find((koma) => koma.id === target.komaId)
                      ?.elements.find(
                        (element) =>
                          element.type === 'group' &&
                          element.content.children.some((child) => child.id === target.elementId),
                      );
                    useUiStore.getState().selectElement(parent?.id ?? target.elementId);
                    useUiStore.getState().setAgentPanelOpen(false);
                    useHealthStore.getState().setOpen(false);
                  }}
                >
                  Show object
                </Button>
              )}
            </>
          )}
          <Button
            disabled={busy}
            aria-label={`Hide notification: ${issue.message}`}
            onClick={() => {
              setHidden((previous) => [...previous, issue.id]);
              heading.current?.focus();
            }}
          >
            Hide notification
          </Button>
        </div>
        {locked && (
          <p className="mt-2 text-sm text-ink-300">
            This image or its group is locked. Unlock it before repairing it.
          </p>
        )}
        {result && result.status !== 'fixed' && (
          <p role="status" className="mt-2 text-sm text-signal-warn">
            {result.message}
          </p>
        )}
      </li>
    );
  }
  return (
    <div className="flex min-w-0 flex-col gap-4">
      <p ref={heading} tabIndex={-1} className="text-sm text-ink-300">
        {failure
          ? 'Review recovery options below.'
          : issues.length === 0
            ? 'No project issues found.'
            : `${String(issues.length)} project status items.`}{' '}
        Hiding a notification does not fix the issue. Unresolved issues return when you reopen the
        project.
      </p>
      {failure && (
        <section aria-label="Open recovery" className="rounded-lg border border-pencil-red p-3">
          <h3 className="font-semibold text-pencil-red">Opening blocked</h3>
          <p className="mt-2">{failure.message}</p>
          {project && (
            <p className="mt-2 text-sm text-ink-300">
              Your current project and its edits remain available.
            </p>
          )}
          <Button
            className="mt-2"
            variant="outline"
            disabled={busy}
            onClick={() => void openProject()}
          >
            Try opening again
          </Button>
          <details className="mt-2">
            <summary className="cursor-pointer">Inspect diagnostics</summary>
            <pre className="mt-2 max-h-48 overflow-y-auto text-sm wrap-anywhere whitespace-pre-wrap select-text">
              {failure.diagnostics}
            </pre>
          </details>
        </section>
      )}
      {hidden.length > 0 && (
        <Button variant="outline" onClick={() => setHidden([])}>
          Show hidden notifications
        </Button>
      )}
      {(['blocked', 'problem', 'info'] as const).map((severity) => {
        const group = visible.filter((issue) => issue.severity === severity);
        if (group.length === 0) return null;
        const title =
          severity === 'blocked'
            ? 'Blocking interpolation'
            : severity === 'problem'
              ? 'Needs attention'
              : 'Information';
        return (
          <section key={severity} aria-label={title}>
            <h3
              className={`mb-2 font-semibold ${severity === 'info' ? 'text-pencil-blue' : 'text-signal-warn'}`}
            >
              {title} ({group.length})
            </h3>
            <ul className="flex flex-col gap-2">{group.map(row)}</ul>
          </section>
        );
      })}
      <div role="status" aria-live="polite" aria-atomic="true" className="text-sm text-pencil-blue">
        {resolved.map(([id, result]) => (
          <p key={id} className="mb-2">
            {result.message}
          </p>
        ))}
        {busy && <p>Working…</p>}
      </div>
    </div>
  );
}

export function ProjectHealth(): ReactElement {
  const open = useHealthStore((state) => state.open);
  const session = useProjectStore((state) => state.sessionId);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (wasOpen.current && !open) document.getElementById('project-health-trigger')?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <Modal
      title="Project health"
      open={open}
      onClose={() => useHealthStore.getState().setOpen(false)}
      width="wide"
      footer={
        <Button variant="outline" onClick={() => useHealthStore.getState().setOpen(false)}>
          Close
        </Button>
      }
    >
      <HealthContents key={session} />
    </Modal>
  );
}

export function ProjectHealthButton(): ReactElement {
  const project = useProjectStore(selectProject);
  const warnings = useProjectStore((state) => state.loadWarnings);
  const migratedFrom = useProjectStore((state) => state.migratedFrom);
  const failure = useHealthStore((state) => state.failure);
  const count = useMemo(
    () => collectHealthIssues(project, warnings, migratedFrom).length + (failure ? 1 : 0),
    [project, warnings, migratedFrom, failure],
  );
  return (
    <Button
      id="project-health-trigger"
      variant="outline"
      aria-haspopup="dialog"
      onClick={() => useHealthStore.getState().setOpen(true)}
    >
      Project health{count > 0 ? ` (${String(count)})` : ''}
    </Button>
  );
}
