import { PROJECT_TOO_LARGE_MESSAGE, type ValidationIssue } from '@koma-motion/core';

export type ProjectFormatErrorCode =
  | 'invalidJson'
  | 'notAProject'
  | 'newerSchemaVersion'
  | 'unsupportedSchemaVersion'
  | 'invalidProject'
  | 'tooLarge'
  | 'fileNotReadable'
  | 'fileNotWritable'
  | 'uninspectableTarget'
  | 'fileChangedExternally'
  | 'wouldOverwriteNewerProject';

export interface ProjectFormatError {
  readonly code: ProjectFormatErrorCode;
  /** A sentence that can be shown to the user as it is. */
  readonly message: string;
  readonly issues: readonly ValidationIssue[];
}

export function isProjectTooLarge(issues: readonly ValidationIssue[]): boolean {
  return issues.some((issue) => issue.message === PROJECT_TOO_LARGE_MESSAGE);
}

export function projectFormatError(
  code: ProjectFormatErrorCode,
  message: string,
  issues: readonly ValidationIssue[] = [],
): ProjectFormatError {
  return { code, message, issues };
}
