import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  acceptedFrames,
  errorName,
  rendererReportSchema,
  stackFrames,
} from '../../shared/diagnostics';
import { describeError, describeFailedResponse } from './describe';

describe('describeError', () => {
  it('keeps name, message, code and stack of an error', () => {
    const error = Object.assign(new TypeError('No such file'), { code: 'ENOENT' });
    const described = describeError(error);
    expect(described).toMatchObject({
      error: 'TypeError',
      message: 'No such file',
      code: 'ENOENT',
    });
    expect(described['stack']).toContain('TypeError: No such file');
    expect(describeError(new Error('x'.repeat(5000)))['message']).toHaveLength(500);
  });

  it('reduces a schema error to where it failed, without the input', () => {
    const result = z
      .object({ title: z.string(), kind: z.enum(['a', 'b']) })
      .safeParse({ title: 42, kind: 'Confidential plan' });
    const described = describeError(result.error);
    expect(described).toEqual({
      error: 'ZodError',
      message: 'invalid_type at title; invalid_value at kind',
    });
    expect(JSON.stringify(described)).not.toContain('Confidential');
  });

  it('never throws, whatever the error holds', () => {
    const odd = Object.assign(new Error('x'), { message: 42, stack: null, name: undefined });
    expect(describeError(odd)).toEqual({ error: 'Error', message: '', stack: '' });
    const hostile = new Error('x');
    Object.defineProperty(hostile, 'message', {
      get: () => {
        throw new Error('The message cannot be read.');
      },
    });
    expect(describeError(hostile)).toEqual({ error: 'UnreadableError' });
  });

  it('describes a value that is not an error by its type', () => {
    expect(describeError('plain text')).toEqual({ error: 'NonError', message: 'plain text' });
    expect(describeError({ prompt: 'secret' })).toEqual({ error: 'NonError', message: 'object' });
    expect(describeError(undefined)).toEqual({ error: 'NonError', message: 'undefined' });
  });
});

describe('describeFailedResponse', () => {
  const diagnostics = {
    providerId: 'claude-code',
    startedAt: '2026-11-09T10:00:00.000Z',
    finishedAt: '2026-11-09T10:00:04.000Z',
    durationMs: 4000.4,
    promptTemplate: 'The prompt that was sent',
    attempts: [
      {
        attempt: 1,
        kind: 'generation',
        durationMs: 3999.6,
        exitCode: 1,
        outputLength: 120,
        errorOutput: 'stderr that may quote the request',
        outcome: 'failed',
      },
    ],
  };

  it('keeps provider, code and attempt exits of a failed run, and none of its text', () => {
    const failure = describeFailedResponse('koma:providers:execute', {
      status: 'failed',
      error: {
        code: 'executionFailed',
        message: 'The provider said: user request text',
        issues: [],
      },
      historyEntry: { userRequest: 'user request text' },
      diagnostics,
    });
    expect(failure).toEqual({
      event: 'provider.run-failed',
      data: {
        channel: 'koma:providers:execute',
        status: 'failed',
        providerId: 'claude-code',
        code: 'executionFailed',
        durationMs: 4000,
        attempts: [
          {
            kind: 'generation',
            outcome: 'failed',
            exitCode: 1,
            durationMs: 4000,
            outputLength: 120,
          },
        ],
      },
    });
    expect(JSON.stringify(failure)).not.toMatch(/request|stderr|prompt/i);
  });

  it('records a timed-out run and ignores success and cancellation', () => {
    const run = { error: { code: 'timedOut', message: '', issues: [] }, diagnostics };
    expect(
      describeFailedResponse('koma:providers:execute', { ...run, status: 'timedOut' }),
    ).toMatchObject({ event: 'provider.run-failed', data: { status: 'timedOut' } });
    expect(
      describeFailedResponse('koma:providers:execute', { ...run, status: 'cancelled' }),
    ).toBeNull();
    expect(describeFailedResponse('koma:providers:execute', { status: 'succeeded' })).toBeNull();
  });

  it('records only channel and status of any other failed response', () => {
    expect(
      describeFailedResponse('koma:project:save', {
        status: 'failed',
        message: 'Merger plan.koma could not be saved.',
      }),
    ).toEqual({
      event: 'ipc.returned-failure',
      data: { channel: 'koma:project:save', status: 'failed' },
    });
    for (const response of [undefined, null, 'failed', {}, { status: 'done' }, { status: 7 }]) {
      expect(describeFailedResponse('koma:app:get-info', response)).toBeNull();
    }
  });
});

describe('reports of the window', () => {
  it('keeps call sites and drops the message, however many lines it has', () => {
    const stack = [
      'Error: Could not place "Confidential title"',
      'at first sight this line of the message looks like a call site',
      '    at placeElement (koma://app/assets/main-abc.js:10:5)',
      '    at KomaStrip (koma://app/assets/main-abc.js:20:9)',
      `    at ${'x'.repeat(400)}`,
    ].join('\n');
    const frames = [
      'at placeElement (koma://app/assets/main-abc.js:10:5)',
      'at KomaStrip (koma://app/assets/main-abc.js:20:9)',
    ].join('\n');
    expect(stackFrames(stack)).toBe(frames);
    // The main process filters again, and bounds what an untrusted window sent.
    expect(acceptedFrames(frames)).toBe(frames);
    expect(acceptedFrames(`Error: message\n${frames}\nnot a frame`)).toBe(frames);
    const many = Array.from({ length: 99 }, () => 'at x').join('\n');
    expect(acceptedFrames(many).split('\n')).toHaveLength(40);
    expect(stackFrames('Error: only a message\nsecond line')).toBe('');
    expect(stackFrames(undefined)).toBe('');
    const long = Array.from(
      { length: 500 },
      (_, index) => `    at frame${String(index)} (x.js:1:1)`,
    );
    expect(stackFrames(long.join('\n')).split('\n')).toHaveLength(40);
  });

  it('accepts only a plain identifier as the name of an error', () => {
    expect(errorName('TypeError')).toBe('TypeError');
    expect(errorName('My title: secret')).toBe('Error');
    expect(errorName(undefined)).toBe('Error');
  });

  it('has a schema without room for a message, a path or long text', () => {
    const report = { kind: 'render', name: 'TypeError', stack: '', componentStack: '' };
    expect(rendererReportSchema.safeParse(report).success).toBe(true);
    for (const invalid of [
      { ...report, message: 'text' },
      { ...report, path: 'C:/anywhere' },
      { ...report, kind: 'other' },
      { ...report, name: 'x'.repeat(65) },
      { ...report, stack: 'x'.repeat(4001) },
      { ...report, componentStack: 'x'.repeat(4001) },
      { kind: 'render' },
    ]) {
      expect(rendererReportSchema.safeParse(invalid).success).toBe(false);
    }
  });
});
