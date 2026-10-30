import type { ReactElement } from 'react';
import { exportIssueRows, type ExportIssue } from '../lib/exportIssues';

export function ExportIssues({
  issues,
  label,
}: {
  readonly issues: readonly ExportIssue[];
  readonly label: string;
}): ReactElement | null {
  if (issues.length === 0) return null;
  return (
    <ul aria-label={label} className="flex flex-col gap-2 text-sm">
      {exportIssueRows(issues).map((row, index) =>
        row.kind === 'issue' ? (
          <li
            key={index}
            className={row.issue.severity === 'error' ? 'text-motion' : 'text-signal-warn'}
          >
            {row.issue.message}
          </li>
        ) : (
          <li key={index} className="text-signal-warn">
            <details>
              <summary className="cursor-pointer active:text-ink-100">
                PowerPoint approximates font weights for {row.issues.length} text objects.
              </summary>
              <ul aria-label="Affected text objects" className="mt-2 list-disc space-y-1 ps-5">
                {row.issues.map((issue, detail) => (
                  <li key={detail}>{issue.message}</li>
                ))}
              </ul>
            </details>
          </li>
        ),
      )}
    </ul>
  );
}
