export type MotionIssueCode =
  | 'duplicatePersistentId'
  | 'invalidKoma'
  | 'missingSourceKoma'
  | 'missingTargetKoma'
  | 'nonAdjacentKomas'
  | 'invalidElementReference'
  | 'unsupportedOperation'
  | 'staleTransition'
  | 'duplicateOperation'
  | 'conflictingOperations'
  | 'ambiguousState'
  | 'settingAdjusted';

/** A problem found by the motion engine, phrased so that it can be shown to the user. */
export interface MotionIssue {
  readonly code: MotionIssueCode;
  readonly message: string;
  /** The object the issue is about, when it concerns a single object. */
  readonly persistentId: string | null;
}

/**
 * What can be done about an issue of a stored transition:
 *
 * - `regenerate`: rebuilding the transition from its Komas fixes it.
 * - `editKoma`: a Koma has to be corrected by hand first.
 * - `futureVersion`: a later version of Koma Motion is needed. Nothing here fixes it.
 * - `none`: the issue cannot occur for a transition shown in the application,
 *   or there is nothing to fix.
 */
export type MotionIssueRemedy = 'regenerate' | 'editKoma' | 'futureVersion' | 'none';

export function getMotionIssueRemedy(code: MotionIssueCode): MotionIssueRemedy {
  switch (code) {
    case 'staleTransition':
    case 'invalidElementReference':
    case 'duplicateOperation':
    case 'conflictingOperations':
      return 'regenerate';
    case 'duplicatePersistentId':
    case 'invalidKoma':
      return 'editKoma';
    case 'unsupportedOperation':
      return 'futureVersion';
    case 'missingSourceKoma':
    case 'missingTargetKoma':
    case 'nonAdjacentKomas':
    case 'ambiguousState':
    case 'settingAdjusted':
      return 'none';
  }
}

export function motionIssue(
  code: MotionIssueCode,
  message: string,
  persistentId: string | null = null,
): MotionIssue {
  return { code, message, persistentId };
}
