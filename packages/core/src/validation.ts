import type { z } from 'zod';

/** A validation problem expressed in terms a person can act on. */
export interface ValidationIssue {
  /** Location of the problem, for example `presentation.komas[1].elements[0].size.width`. */
  readonly path: string;
  readonly message: string;
  readonly code: string;
}

export function formatPath(path: readonly PropertyKey[]): string {
  let formatted = '';
  for (const segment of path) {
    if (typeof segment === 'number') {
      formatted += `[${String(segment)}]`;
    } else {
      const key = String(segment);
      formatted += formatted === '' ? key : `.${key}`;
    }
  }
  return formatted === '' ? '(root)' : formatted;
}

export function toValidationIssues(error: z.ZodError): ValidationIssue[] {
  return error.issues.map((issue) => ({
    path: formatPath(issue.path),
    message: issue.message,
    code: issue.code,
  }));
}

export function describeIssues(issues: readonly ValidationIssue[], limit = 8): string {
  const lines = issues.slice(0, limit).map((issue) => `${issue.path}: ${issue.message}`);
  if (issues.length > limit) {
    lines.push(`... and ${String(issues.length - limit)} more`);
  }
  return lines.join('\n');
}
