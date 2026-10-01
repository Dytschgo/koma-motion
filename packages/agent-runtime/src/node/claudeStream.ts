/**
 * Reads the `--output-format stream-json --include-partial-messages` stream
 * of Claude Code while it arrives.
 *
 * Only two things leave this module:
 *
 * - text that Claude writes for the person, from `text_delta` events of text
 *   blocks in the main conversation, and
 * - coarse activity that the stream shows: thinking started (never its
 *   content), the structured answer is being written (its size, never its
 *   content), and API retries (the documented error category only).
 *
 * Thinking and signature deltas, tool inputs, tool results, subagent
 * messages, user messages and unknown events are ignored. A line that is not
 * valid JSON is counted and skipped. The final `result` line is not kept
 * here; the provider reads it from the complete output.
 */

/** Longest line kept for live parsing. Longer lines are skipped; deltas are small. */
export const MAX_STREAM_LINE_LENGTH = 1024 * 1024;

export type ClaudeActivity =
  | { readonly kind: 'thinking' }
  | { readonly kind: 'writing'; readonly characters: number }
  | {
      readonly kind: 'retrying';
      readonly attempt: number;
      readonly maxRetries: number;
      readonly reason: string;
    };

export interface ClaudeStreamHandlers {
  readonly onText: (text: string) => void;
  readonly onActivity: (activity: ClaudeActivity) => void;
}

const RETRY_REASONS: Readonly<Record<string, string>> = {
  authentication_failed: 'sign-in problem',
  oauth_org_not_allowed: 'organisation not allowed',
  account_on_hold: 'account on hold',
  billing_error: 'billing problem',
  rate_limit: 'rate limit',
  overloaded: 'service overloaded',
  invalid_request: 'invalid request',
  model_not_found: 'model not found',
  server_error: 'server error',
  max_output_tokens: 'output limit',
  cloud_credential_error: 'cloud credentials',
};

function record(value: unknown): Readonly<Record<string, unknown>> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? { ...value } : null;
}

function wholeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Removes control characters except line breaks and tabs. */
export function sanitizeStreamText(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, '');
}

export class ClaudeStreamParser {
  readonly #handlers: ClaudeStreamHandlers;
  #buffer = '';
  #skipping = false;
  /** Block type by index, for the message that is streaming now. */
  #blocks = new Map<number, string>();
  #writing = 0;
  #malformed = 0;

  constructor(handlers: ClaudeStreamHandlers) {
    this.#handlers = handlers;
  }

  /** Lines that were not valid JSON. */
  get malformedLines(): number {
    return this.#malformed;
  }

  push(text: string): void {
    let rest = text;
    while (rest !== '') {
      const newline = rest.indexOf('\n');
      if (newline === -1) {
        this.#append(rest);
        return;
      }
      this.#append(rest.slice(0, newline));
      rest = rest.slice(newline + 1);
      this.#endLine();
    }
  }

  /** Reads a last line without a line break. */
  end(): void {
    this.#endLine();
  }

  #append(part: string): void {
    if (this.#skipping) return;
    if (this.#buffer.length + part.length > MAX_STREAM_LINE_LENGTH) {
      this.#buffer = '';
      this.#skipping = true;
      return;
    }
    this.#buffer += part;
  }

  #endLine(): void {
    const line = this.#buffer.trim();
    const skipped = this.#skipping;
    this.#buffer = '';
    this.#skipping = false;
    if (skipped || line === '') return;
    let value: unknown;
    try {
      value = JSON.parse(line);
    } catch {
      this.#malformed += 1;
      return;
    }
    this.#read(record(value));
  }

  #read(message: Readonly<Record<string, unknown>> | null): void {
    if (message === null) return;
    // Subagents are not part of the answer Koma Motion asked for.
    if (message['parent_tool_use_id'] !== null && message['parent_tool_use_id'] !== undefined) {
      return;
    }
    if (message['type'] === 'system' && message['subtype'] === 'api_retry') {
      const category = typeof message['error'] === 'string' ? message['error'] : '';
      this.#handlers.onActivity({
        kind: 'retrying',
        attempt: wholeNumber(message['attempt']),
        maxRetries: wholeNumber(message['max_retries']),
        reason: RETRY_REASONS[category] ?? 'temporary problem',
      });
      return;
    }
    if (message['type'] !== 'stream_event') return;
    const event = record(message['event']);
    if (event === null) return;
    const index = wholeNumber(event['index']);

    switch (event['type']) {
      case 'message_start':
        this.#blocks.clear();
        return;
      case 'content_block_start': {
        const block = record(event['content_block']);
        const type = typeof block?.['type'] === 'string' ? block['type'] : 'unknown';
        this.#blocks.set(index, type);
        if (type === 'thinking' || type === 'redacted_thinking') {
          this.#handlers.onActivity({ kind: 'thinking' });
        } else if (type === 'tool_use' && block?.['name'] === 'StructuredOutput') {
          this.#writing = 0;
          this.#handlers.onActivity({ kind: 'writing', characters: 0 });
        }
        return;
      }
      case 'content_block_delta': {
        const delta = record(event['delta']);
        const blockType = this.#blocks.get(index);
        if (
          delta?.['type'] === 'text_delta' &&
          blockType === 'text' &&
          typeof delta['text'] === 'string'
        ) {
          const text = sanitizeStreamText(delta['text']);
          if (text !== '') this.#handlers.onText(text);
        } else if (
          delta?.['type'] === 'input_json_delta' &&
          blockType === 'tool_use' &&
          typeof delta['partial_json'] === 'string'
        ) {
          this.#writing += delta['partial_json'].length;
          this.#handlers.onActivity({ kind: 'writing', characters: this.#writing });
        }
        return;
      }
      default:
        return;
    }
  }
}

/**
 * The last `result` line of a complete stream-json output, or `null`. The
 * line has the same fields as the envelope of `--output-format json`.
 */
export function findClaudeResultLine(output: string): string | null {
  let end = output.length;
  while (end > 0) {
    const start = output.lastIndexOf('\n', end - 1);
    const line = output.slice(start + 1, end).trim();
    end = start === -1 ? 0 : start;
    if (line === '') continue;
    if (line.startsWith('{') && /"type"\s*:\s*"result"/.test(line)) {
      return line;
    }
  }
  return null;
}
