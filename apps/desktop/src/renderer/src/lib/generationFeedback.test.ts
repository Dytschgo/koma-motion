import { agentError } from '@koma-motion/agent-runtime';
import { describe, expect, it } from 'vitest';
import { generationFailureSummary } from './generationFeedback';

describe('chat recovery messages', () => {
  it.each(['invalidResponse', 'noStructuredOutput', 'conversionFailed'] as const)(
    'gives a recovery step for %s while leaving the original diagnostics intact',
    (code) => {
      const error = agentError(
        code,
        'Invalid structured output:\npresentation.komas: expected array',
      );
      expect(generationFailureSummary(error)).toBe(
        'The generated Komas could not be used. Recheck to try again.',
      );
      expect(error.message).toContain('presentation.komas: expected array');
    },
  );

  it('retains useful provider sign-in instructions in the summary', () => {
    const error = agentError('providerUnavailable', 'Sign in to Claude Code, then try again.');
    expect(generationFailureSummary(error)).toBe(error.message);
  });

  it('does not promise that rechecking the same oversized request will fix it', () => {
    expect(generationFailureSummary(agentError('outputTooLarge', 'Output buffer exceeded.'))).toBe(
      'The response was too large. Try a new request with fewer Komas.',
    );
  });
});
