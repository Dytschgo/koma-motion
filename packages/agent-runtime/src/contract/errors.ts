import { z } from 'zod';

export const AGENT_ERROR_CODES = [
  'invalidRequest',
  'providerNotFound',
  'providerUnavailable',
  'executionFailed',
  'timedOut',
  'cancelled',
  'outputTooLarge',
  'noStructuredOutput',
  'invalidResponse',
  'conversionFailed',
  'internalError',
] as const;
export const agentErrorCodeSchema = z.enum(AGENT_ERROR_CODES);
export type AgentErrorCode = z.infer<typeof agentErrorCodeSchema>;

export const RESPONSE_ISSUE_CODES = [
  'schema',
  'duplicateId',
  'invalidReference',
  'unsupportedElementType',
  'unsupportedTransition',
  'missingContent',
  'limitExceeded',
  'inconsistentOutput',
] as const;
export const responseIssueCodeSchema = z.enum(RESPONSE_ISSUE_CODES);
export type ResponseIssueCode = z.infer<typeof responseIssueCodeSchema>;

/** One problem in the structured output of an agent. */
export const responseIssueSchema = z.object({
  code: responseIssueCodeSchema,
  /** For example `komas[1].elements[0].type`. */
  path: z.string(),
  message: z.string(),
});
export type ResponseIssue = z.infer<typeof responseIssueSchema>;

export const agentErrorSchema = z.object({
  code: agentErrorCodeSchema,
  /** A sentence that can be shown to the user as it is. */
  message: z.string(),
  issues: z.array(responseIssueSchema),
});
export type AgentError = z.infer<typeof agentErrorSchema>;

export function agentError(
  code: AgentErrorCode,
  message: string,
  issues: readonly ResponseIssue[] = [],
): AgentError {
  return { code, message, issues: [...issues] };
}

export function describeResponseIssues(issues: readonly ResponseIssue[], limit = 8): string {
  const lines = issues.slice(0, limit).map((issue) => `${issue.path}: ${issue.message}`);
  if (issues.length > limit) {
    lines.push(`... and ${String(issues.length - limit)} more`);
  }
  return lines.join('\n');
}
