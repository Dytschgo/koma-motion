import { describe, expect, it } from 'vitest';
import { exportIssueRows, type ExportIssue } from './exportIssues';

const weight: ExportIssue = {
  severity: 'warning',
  code: 'fontWeightApproximation',
  message: 'Text "Heading" uses weight 600; PowerPoint export approximates it as regular or bold.',
};

describe('export compatibility notes', () => {
  it('groups repeated font caveats while retaining every original detail and its order', () => {
    const otherWeight = {
      ...weight,
      message:
        'Text "Caption" uses weight 500; PowerPoint export approximates it as regular or bold.',
    };
    const error: ExportIssue = {
      severity: 'error',
      code: 'invalidAsset',
      message: 'Image "Logo" is missing.',
    };
    const warning: ExportIssue = {
      severity: 'warning',
      code: 'groupFlattened',
      message: 'The diagram group will be flattened.',
    };
    expect(exportIssueRows([error, weight, warning, otherWeight, weight])).toEqual([
      { kind: 'issue', issue: error },
      { kind: 'fontWeights', issues: [weight, otherWeight, weight] },
      { kind: 'issue', issue: warning },
    ]);
  });

  it('keeps single caveats, unknown warnings and all errors directly visible', () => {
    const error = { ...weight, severity: 'error' as const };
    const unknown = { ...weight, code: 'futureWarning' };
    expect(exportIssueRows([weight, error, unknown])).toEqual([
      { kind: 'issue', issue: weight },
      { kind: 'issue', issue: error },
      { kind: 'issue', issue: unknown },
    ]);
    expect(exportIssueRows([])).toEqual([]);
  });
});
