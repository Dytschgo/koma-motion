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
