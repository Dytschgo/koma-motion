/**
 * Turns errors and failed responses into the technical facts the diagnostics
 * log keeps. Pure functions: what they leave out is what the log never holds.
 */
import { z } from 'zod';
import type { DiagnosticData } from './log';

const MAX_MESSAGE_LENGTH = 500;
const MAX_STACK_LENGTH = 4000;

/**
 * Name, message, code and stack of an error of the main process. The log
 * scrubs paths and credentials from them when it writes.
 *
 * A schema error is reduced to where it failed. Its message can quote input.
 */
export function describeError(error: unknown): DiagnosticData {
  if (error instanceof z.ZodError) {
    return {
      error: 'ZodError',
      message: error.issues
        .slice(0, 10)
        .map((issue) => `${issue.code} at ${issue.path.map(String).join('.') || '(root)'}`)
        .join('; '),
    };
  }
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : undefined;
    return {
      error: error.name,
      message: error.message.slice(0, MAX_MESSAGE_LENGTH),
      ...(code === undefined ? {} : { code: code.slice(0, 40) }),
      stack: (error.stack ?? '').slice(0, MAX_STACK_LENGTH),
    };
  }
  return {
    error: 'NonError',
    message: (typeof error === 'string' ? error : typeof error).slice(0, MAX_MESSAGE_LENGTH),
  };
}

/** Unknown properties are dropped: the error output and the message of a run stay out. */
const failedRun = z.object({
  status: z.enum(['failed', 'timedOut']),
  error: z.object({ code: z.string().max(40) }),
  diagnostics: z.object({
    providerId: z.string().max(80),
    durationMs: z.number(),
    attempts: z.array(
      z.object({
        kind: z.string().max(20),
        outcome: z.string().max(20),
        exitCode: z.number().nullable(),
        durationMs: z.number(),
        outputLength: z.number(),
      }),
    ),
  }),
});
const failedResponse = z.object({ status: z.enum(['failed', 'timedOut']) });

export interface FailedResponse {
  readonly event: 'provider.run-failed' | 'ipc.returned-failure';
  readonly data: DiagnosticData;
}

/**
 * What the log keeps about a response that reports a failure: the channel and
 * the status, and for a provider run the provider, the error code and the
 * exit of each attempt. The sentence for the user, the request and what the
 * provider wrote are not kept. A cancelled run is a choice, not a failure.
 */
export function describeFailedResponse(channel: string, response: unknown): FailedResponse | null {
  const run = failedRun.safeParse(response);
  if (run.success) {
    const { status, error, diagnostics } = run.data;
    return {
      event: 'provider.run-failed',
      data: {
        channel,
        status,
        providerId: diagnostics.providerId,
        code: error.code,
        durationMs: Math.round(diagnostics.durationMs),
        attempts: diagnostics.attempts.slice(0, 8).map((attempt) => ({
          kind: attempt.kind,
          outcome: attempt.outcome,
          exitCode: attempt.exitCode,
          durationMs: Math.round(attempt.durationMs),
          outputLength: attempt.outputLength,
        })),
      },
    };
  }
  const failed = failedResponse.safeParse(response);
  return failed.success
    ? { event: 'ipc.returned-failure', data: { channel, status: failed.data.status } }
    : null;
}
