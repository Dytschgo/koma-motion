import { err, ok, type Result } from '@koma-motion/core';
import { agentError, type AgentError, type ResponseIssue } from '../contract/errors';

/** Largest agent output that is parsed, in characters. */
export const MAX_AGENT_OUTPUT_LENGTH = 512 * 1024;

const EMPTY_RESPONSE = 'The agent returned an empty response.';
const NO_JSON_OBJECT =
  'The agent did not return structured data. Its response could not be read as JSON.';
const UNREADABLE_STRUCTURED = 'The agent returned structured data that could not be read as JSON.';
const MULTIPLE_ANSWERS = 'The response contains more than one possible answer and was not guessed.';
const AMBIGUOUS_OBJECTS = 'The agent returned more than one JSON object, so no answer was guessed.';
const INCONSISTENT_OUTPUT =
  'The text and the structured output are different answers, so neither one was used.';

function outputTooLarge(length: number): AgentError {
  return agentError(
    'outputTooLarge',
    `The agent returned ${String(length)} characters, more than the limit of ${String(MAX_AGENT_OUTPUT_LENGTH)}.`,
  );
}

function tryParse(text: string): Result<unknown, null> {
  try {
    const value: unknown = JSON.parse(text);
    return ok(value);
  } catch {
    return err(null);
  }
}

/** A non-null object that is not an array. */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Own `komas` array. Used only to choose among outermost objects; schema
 * validation still happens afterwards.
 */
function isContractShaped(value: Record<string, unknown>): boolean {
  return Object.hasOwn(value, 'komas') && Array.isArray(value['komas']);
}

interface ObjectSpan {
  readonly start: number;
  readonly end: number;
  /** Id of the enclosing `{`, or null when the span is at the top level. */
  readonly parentId: number | null;
}

/**
 * Balanced `{...}` spans that are not strictly inside another balanced span.
 * An opening brace that never closes does not hide a later object. Braces
 * inside strings are ignored. The recorded spans are disjoint.
 */
function outermostObjectSpans(text: string): ObjectSpan[] {
  const spans: ObjectSpan[] = [];
  const open: { id: number; start: number }[] = [];
  let nextId = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
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
      open.push({ id: nextId, start: index });
      nextId += 1;
    } else if (character === '}') {
      const frame = open.pop();
      if (frame !== undefined) {
        spans.push({
          start: frame.start,
          end: index,
          parentId: open.at(-1)?.id ?? null,
        });
      }
    }
  }

  const unmatched = new Set(open.map((frame) => frame.id));
  return spans.filter((span) => span.parentId === null || unmatched.has(span.parentId));
}

/** JSON values only: no numeric tolerance, and prototype keys are not compared. */
function jsonValuesEqual(left: unknown, right: unknown): boolean {
  if (left === right) {
    return true;
  }
  if (Array.isArray(left) || Array.isArray(right)) {
    if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) {
      return false;
    }
    return left.every((item, index) => jsonValuesEqual(item, right[index]));
  }
  if (!isPlainObject(left) || !isPlainObject(right)) {
    return false;
  }
  const leftKeys = Object.keys(left);
  const rightKeys = Object.keys(right);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  return leftKeys.every(
    (key) => Object.hasOwn(right, key) && jsonValuesEqual(left[key], right[key]),
  );
}

function serialiseStructured(value: unknown): Result<string, AgentError> {
  try {
    const serialised: unknown = JSON.stringify(value);
    if (typeof serialised !== 'string') {
      return err(agentError('noStructuredOutput', UNREADABLE_STRUCTURED));
    }
    return ok(serialised);
  } catch {
    return err(agentError('noStructuredOutput', UNREADABLE_STRUCTURED));
  }
}

function inconsistentOutput(): AgentError {
  const issue: ResponseIssue = {
    code: 'inconsistentOutput',
    path: 'structured',
    message: INCONSISTENT_OUTPUT,
  };
  return agentError('invalidResponse', INCONSISTENT_OUTPUT, [issue]);
}

/**
 * Why text did not yield an answer. `empty` and `noObject` mean the text holds
 * no answer at all. `ambiguous` means it holds more than one, which is never
 * resolved by preferring another source.
 */
type ExtractionFailure = 'tooLarge' | 'empty' | 'noObject' | 'ambiguous';

type Extraction =
  | { readonly ok: true; readonly value: unknown }
  | { readonly ok: false; readonly reason: ExtractionFailure; readonly error: AgentError };

function failed(reason: ExtractionFailure, error: AgentError): Extraction {
  return { ok: false, reason, error };
}

function selectParsedObject(objects: readonly Record<string, unknown>[]): Extraction {
  const contractShaped = objects.filter(isContractShaped);
  if (contractShaped.length > 1) {
    return failed('ambiguous', agentError('noStructuredOutput', MULTIPLE_ANSWERS));
  }
  const preferred = contractShaped.length === 1 ? contractShaped[0] : objects[0];
  if (objects.length > 1 && contractShaped.length === 0) {
    return failed('ambiguous', agentError('noStructuredOutput', AMBIGUOUS_OBJECTS));
  }
  if (preferred !== undefined) {
    return { ok: true, value: preferred };
  }
  return failed('noObject', agentError('noStructuredOutput', NO_JSON_OBJECT));
}

function extract(rawText: string): Extraction {
  if (rawText.length > MAX_AGENT_OUTPUT_LENGTH) {
    return failed('tooLarge', outputTooLarge(rawText.length));
  }

  const text = rawText.trim();
  if (text === '') {
    return failed('empty', agentError('noStructuredOutput', EMPTY_RESPONSE));
  }

  const direct = tryParse(text);
  if (direct.ok && isPlainObject(direct.value)) {
    return { ok: true, value: direct.value };
  }

  const objects: Record<string, unknown>[] = [];
  for (const span of outermostObjectSpans(text)) {
    const candidate = tryParse(text.slice(span.start, span.end + 1));
    if (candidate.ok && isPlainObject(candidate.value)) {
      objects.push(candidate.value);
    }
  }
  return selectParsedObject(objects);
}

/**
 * Extracts the structured response from the raw text of an agent.
 *
 * The text is treated as data only and is never evaluated. A single JSON
 * object is returned as it is. Otherwise the only outermost balanced objects
 * are considered: one contract-shaped object wins over an example, and more
 * than one possible answer is rejected instead of guessed.
 */
export function extractStructuredOutput(rawText: string): Result<unknown, AgentError> {
  const extraction = extract(rawText);
  return extraction.ok ? ok(extraction.value) : err(extraction.error);
}

/**
 * Chooses the value to validate from provider output.
 *
 * The size limit applies to the raw text and, when present, to the JSON
 * serialisation of structured output before either body is preferred. A plain
 * object envelope is kept when the text is empty, contains no JSON object, or
 * is the same JSON value. A different object is rejected rather than guessed,
 * and so is text that contains more than one possible answer.
 */
export function resolveProviderOutput(output: {
  readonly rawText: string;
  readonly structured?: unknown;
}): Result<unknown, AgentError> {
  if (output.rawText.length > MAX_AGENT_OUTPUT_LENGTH) {
    return err(outputTooLarge(output.rawText.length));
  }

  const { structured } = output;
  let serialised: string | null = null;
  if (structured !== undefined) {
    const encoded = serialiseStructured(structured);
    if (!encoded.ok) {
      return encoded;
    }
    if (encoded.value.length > MAX_AGENT_OUTPUT_LENGTH) {
      return err(outputTooLarge(encoded.value.length));
    }
    serialised = encoded.value;
  }

  if (structured !== undefined && serialised !== null && isPlainObject(structured)) {
    if (output.rawText.trim() === '') {
      return ok(structured);
    }
    const extracted = extract(output.rawText);
    if (!extracted.ok) {
      // Only text without any answer lets the envelope stand in for it. Text
      // with several answers stays a rejection, whatever the envelope says.
      return extracted.reason === 'empty' || extracted.reason === 'noObject'
        ? ok(structured)
        : err(extracted.error);
    }
    const normalised = tryParse(serialised);
    if (normalised.ok && jsonValuesEqual(extracted.value, normalised.value)) {
      return ok(structured);
    }
    return err(inconsistentOutput());
  }

  return extractStructuredOutput(output.rawText);
}
