export type MotionIssueCode =
  | 'duplicatePersistentId'
  | 'invalidKoma'
  | 'missingSourceKoma'
  | 'missingTargetKoma'
  | 'nonAdjacentKomas'
  | 'invalidElementReference'
  | 'unsupportedOperation'
  | 'staleTransition'
  | 'ambiguousState'
  | 'settingAdjusted';

/** A problem found by the motion engine, phrased so that it can be shown to the user. */
export interface MotionIssue {
  readonly code: MotionIssueCode;
  readonly message: string;
  /** The object the issue is about, when it concerns a single object. */
  readonly persistentId: string | null;
}

export function motionIssue(
  code: MotionIssueCode,
  message: string,
  persistentId: string | null = null,
): MotionIssue {
  return { code, message, persistentId };
}
