import { err, formatPath, ok, type Result } from '@koma-motion/core';
import {
  agentError,
  describeResponseIssues,
  type AgentError,
  type ResponseIssue,
} from '../contract/errors';
import {
  agentTransitionSettingsSchema,
  type AgentTransitionSettings,
  type TransitionRegenerationRequest,
} from '../contract/transition';

export interface ValidatedTransitionResponse {
  readonly settings: AgentTransitionSettings;
  /** Sentences that can be shown to the user as they are. */
  readonly warnings: readonly string[];
}

function asRecord(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null;
}

/**
 * Validates untrusted output for one transition against the response
 * contract and the values the request allows. Unknown strategies and easings
 * are named, so a repair attempt knows what to change.
 */
export function validateTransitionResponse(
  output: unknown,
  request: TransitionRegenerationRequest,
): Result<ValidatedTransitionResponse, AgentError> {
  const fail = (
    issues: readonly ResponseIssue[],
  ): Result<ValidatedTransitionResponse, AgentError> =>
    err(
      agentError(
        'invalidResponse',
        `The response of the agent does not follow the required structure:\n${describeResponseIssues(issues)}`,
        issues,
      ),
    );

  const record = asRecord(output);
  const unsupported: ResponseIssue[] = [];
  const strategy = record?.['strategy'];
  if (
    typeof strategy === 'string' &&
    !request.allowedTransitionStrategies.some((allowed) => allowed === strategy)
  ) {
    unsupported.push({
      code: 'unsupportedTransition',
      path: 'strategy',
      message: `The transition strategy "${strategy}" is not supported. Supported strategies: ${request.allowedTransitionStrategies.join(', ')}.`,
    });
  }
  const easing = record?.['easing'];
  if (typeof easing === 'string' && !request.allowedEasings.some((allowed) => allowed === easing)) {
    unsupported.push({
      code: 'unsupportedTransition',
      path: 'easing',
      message: `The easing "${easing}" is not supported. Supported easings: ${request.allowedEasings.join(', ')}.`,
    });
  }
  if (unsupported.length > 0) {
    return fail(unsupported);
  }

  const parsed = agentTransitionSettingsSchema.safeParse(output);
  if (!parsed.success) {
    return fail(
      parsed.error.issues.map((issue) => ({
        code: 'schema',
        path: formatPath(issue.path),
        message: issue.message,
      })),
    );
  }
  return ok({ settings: parsed.data, warnings: [] });
}
