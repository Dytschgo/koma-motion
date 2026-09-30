import { describe, expect, it } from 'vitest';
import {
  ClaudeStreamParser,
  findClaudeResultLine,
  MAX_STREAM_LINE_LENGTH,
  sanitizeStreamText,
  type ClaudeActivity,
} from './claudeStream';

/** Events in the shape Claude Code 2.1.285 printed with stream-json and partial messages. */
const event = (value: Record<string, unknown>): string =>
  JSON.stringify({ type: 'stream_event', parent_tool_use_id: null, event: value });

const STREAM = [
  JSON.stringify({ type: 'system', subtype: 'init', model: 'claude-haiku', tools: [] }),
  event({ type: 'message_start', message: { id: 'm1' } }),
  event({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
  event({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'SECRET PLAN' },
  }),
  event({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'signature_delta', signature: 'sig' },
  }),
  event({ type: 'content_block_stop', index: 0 }),
  JSON.stringify({
    type: 'assistant',
    parent_tool_use_id: null,
    message: { content: [{ type: 'thinking', thinking: 'SECRET PLAN' }] },
  }),
  event({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
  event({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'I will ' } }),
  event({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'text_delta', text: 'create three Komas.' },
  }),
  event({
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'tool_use', name: 'StructuredOutput', input: {} },
  }),
  event({
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'input_json_delta', partial_json: '{"komas":[{"title":"TOOL INPUT"' },
  }),
  JSON.stringify({
    type: 'user',
    parent_tool_use_id: null,
    message: { content: [{ type: 'tool_result', content: 'TOOL RESULT' }] },
  }),
  JSON.stringify({
    type: 'stream_event',
    parent_tool_use_id: 'tool-1',
    event: {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'text_delta', text: 'SUBAGENT' },
    },
  }),
  JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: '{"a":1}',
    structured_output: { a: 1 },
  }),
].join('\n');

function collect(): {
  readonly parser: ClaudeStreamParser;
  readonly text: string[];
  readonly activity: ClaudeActivity[];
} {
  const text: string[] = [];
  const activity: ClaudeActivity[] = [];
  const parser = new ClaudeStreamParser({
    onText: (piece) => text.push(piece),
    onActivity: (item) => activity.push(item),
  });
  return { parser, text, activity };
}

describe('Claude stream parser', () => {
  it('forwards visible text only, never thinking, tool input, tool results or subagents', () => {
    const { parser, text, activity } = collect();
    parser.push(`${STREAM}\n`);
    parser.end();
    expect(text.join('')).toBe('I will create three Komas.');
    const everything = JSON.stringify({ text, activity });
    for (const hidden of ['SECRET PLAN', 'TOOL INPUT', 'TOOL RESULT', 'SUBAGENT', 'sig']) {
      expect(everything).not.toContain(hidden);
    }
    expect(activity).toEqual([
      { kind: 'thinking' },
      { kind: 'writing', characters: 0 },
      { kind: 'writing', characters: '{"komas":[{"title":"TOOL INPUT"'.length },
    ]);
  });

  it('reads events split at any point, including inside a line', () => {
    const whole = collect();
    whole.parser.push(STREAM);
    whole.parser.end();
    for (const size of [1, 3, 17, 64]) {
      const pieces = collect();
      for (let start = 0; start < STREAM.length; start += size) {
        pieces.parser.push(STREAM.slice(start, start + size));
      }
      pieces.parser.end();
      expect(pieces.text).toEqual(whole.text);
      expect(pieces.activity).toEqual(whole.activity);
    }
  });

  it('skips malformed and overlong lines and keeps reading', () => {
    const { parser, text } = collect();
    parser.push('not json\n{"broken":\n');
    parser.push(`${'x'.repeat(MAX_STREAM_LINE_LENGTH + 10)}\n`);
    parser.push(
      `${event({ type: 'content_block_start', index: 0, content_block: { type: 'text' } })}\n`,
    );
    parser.push(
      `${event({ type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'still here' } })}\n`,
    );
    expect(parser.malformedLines).toBe(2);
    expect(text).toEqual(['still here']);
  });

  it('reports API retries with the documented category only', () => {
    const { parser, activity } = collect();
    parser.push(
      `${JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 2, max_retries: 5, retry_delay_ms: 1000, error_status: 529, error: 'overloaded' })}\n`,
    );
    parser.push(
      `${JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1, max_retries: 3, error: 'token=abc' })}\n`,
    );
    expect(activity).toEqual([
      { kind: 'retrying', attempt: 2, maxRetries: 5, reason: 'service overloaded' },
      { kind: 'retrying', attempt: 1, maxRetries: 3, reason: 'temporary problem' },
    ]);
  });

  it('removes control characters from visible text', () => {
    expect(sanitizeStreamText('a\u001b[31mb\r\nc\td\u0007')).toBe('a[31mb\nc\td');
  });

  it('finds the result line at the end of the stream', () => {
    const line = findClaudeResultLine(`${STREAM}\n\n`);
    expect(line).not.toBeNull();
    expect(JSON.parse(line ?? '{}')).toMatchObject({ type: 'result', structured_output: { a: 1 } });
    expect(findClaudeResultLine(STREAM.split('\n').slice(0, -1).join('\n'))).toBeNull();
  });
});
