import type { ExportValidation } from '../../../shared/export';

export type ExportIssue = ExportValidation['issues'][number];
export type ExportIssueRow =
  | { readonly kind: 'issue'; readonly issue: ExportIssue }
  | { readonly kind: 'fontWeights'; readonly issues: readonly ExportIssue[] };

/** Group repeated font caveats without hiding errors or discarding their details. */
export function exportIssueRows(issues: readonly ExportIssue[]): readonly ExportIssueRow[] {
  const isFontWeight = (issue: ExportIssue): boolean =>
    issue.severity === 'warning' && issue.code === 'fontWeightApproximation';
  const weights = issues.filter(isFontWeight);
  let addedWeights = false;
  return issues.flatMap<ExportIssueRow>((issue) => {
    if (weights.length > 1 && isFontWeight(issue)) {
      if (addedWeights) return [];
      addedWeights = true;
      return [{ kind: 'fontWeights', issues: weights }];
    }
    return [{ kind: 'issue', issue }];
  });
}
