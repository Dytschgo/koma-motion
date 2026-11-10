import type { AgentError } from '@koma-motion/agent-runtime';

/** Keep implementation vocabulary in diagnostics, with a useful next step in chat. */
export function generationFailureSummary(error: AgentError): string {
  switch (error.code) {
    case 'noStructuredOutput':
    case 'invalidResponse':
    case 'conversionFailed':
      return 'The generated Komas could not be used. Recheck to try again.';
    case 'outputTooLarge':
      return 'The response was too large. Try a new request with fewer Komas.';
    case 'internalError':
      return 'Koma Motion could not finish this request. Recheck to try again.';
    default:
      // Provider messages can contain necessary connection or sign-in instructions.
      return error.message.split('\n')[0]?.replace(/:$/, '.') ?? error.message;
  }
}

/** The one line shown where the request was made. The document is never changed by a failure. */
export function describeFailure(status: 'failed' | 'cancelled' | 'timedOut'): string {
  switch (status) {
    case 'failed':
      return 'Couldn’t use the result. Nothing changed.';
    case 'timedOut':
      return 'Generation took too long. Nothing changed.';
    case 'cancelled':
      return 'Generation stopped';
  }
}

/**
 * A second line only when it tells the person something they must do, such
 * as signing in or asking for fewer Komas. Invalid output needs no more than
 * the headline and Recheck.
 */
export function failureDetail(error: AgentError): string | undefined {
  switch (error.code) {
    case 'noStructuredOutput':
    case 'invalidResponse':
    case 'conversionFailed':
    case 'internalError':
      return undefined;
    default:
      return generationFailureSummary(error);
  }
}
