import { err, ok, type Result } from '@koma-motion/core';
import { agentError, type AgentError } from '../contract/errors';

/** Largest agent output that is parsed, in characters. */
export const MAX_AGENT_OUTPUT_LENGTH = 512 * 1024;

function tryParse(text: string): Result<unknown, null> {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch {
    return err(null);
  }
}

/**
 * Finds the end of the JSON object that starts at `start`, or -1. Braces
 * inside strings are ignored.
 */
function findObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }
  return -1;
}

function isObject(value: unknown): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Extracts the structured response from the raw text of an agent.
 *
 * The text is treated as data only. Accepted forms are a JSON object, a JSON
 * object inside a Markdown code fence, and a JSON object surrounded by prose.
 * Nothing in the text is ever evaluated or executed.
 */
export function extractStructuredOutput(rawText: string): Result<unknown, AgentError> {
  if (rawText.length > MAX_AGENT_OUTPUT_LENGTH) {
    return err(
      agentError(
        'outputTooLarge',
        `The agent returned ${String(rawText.length)} characters, more than the limit of ${String(MAX_AGENT_OUTPUT_LENGTH)}.`,
      ),
    );
  }

  const text = rawText.trim();
  if (text === '') {
    return err(agentError('noStructuredOutput', 'The agent returned an empty response.'));
  }

  const direct = tryParse(text);
  if (direct.ok && isObject(direct.value)) {
    return ok(direct.value);
  }

  for (let start = text.indexOf('{'); start !== -1; start = text.indexOf('{', start + 1)) {
    const end = findObjectEnd(text, start);
    if (end === -1) {
      break;
    }
    const candidate = tryParse(text.slice(start, end + 1));
    if (candidate.ok && isObject(candidate.value)) {
      return ok(candidate.value);
    }
  }

  return err(
    agentError(
      'noStructuredOutput',
      'The agent did not return structured data. Its response could not be read as JSON.',
    ),
  );
}
