const REDACTED = '[redacted]';

/**
 * Patterns for common credentials.
 *
 * Pattern redaction cannot guarantee removal of every secret, prompt or
 * environment value from arbitrary stderr.
 */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Provider API keys and GitHub tokens.
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  // AWS access key ids: a 4-letter prefix plus 16 uppercase alphanumerics.
  // ASIA is the temporary (session) prefix; AKIA is the long-lived one.
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // JSON Web Tokens.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];

/** `Authorization:` / `authorization=` followed by Basic or Bearer. */
const AUTHORIZATION_PATTERN =
  /\b(authorization)(\s*[:=]\s*)(bearer|basic)\b(\s*)("[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s"',;]+)/gi;

/**
 * A standalone Bearer token is at least 12 characters and contains a digit or
 * a token symbol, so an English word does not match.
 */
const BEARER_PATTERN = /\b(bearer)(\s+)([A-Za-z0-9._~+/=-]{12,})/gi;
const BEARER_MARKER = /[\d._+/=-]/;

/** A standalone Basic value is base64-shaped, not prose. */
const BASIC_PATTERN = /\b(basic)(\s+)([A-Za-z0-9+/=]{12,})/gi;
const BASIC_MARKER = /[\d+/=]/;

/**
 * `NAME=value` and `"name": "value"`. The value may be quoted and may be cut
 * off at the end of the input. An empty value is not a credential.
 */
const ASSIGNMENT_PATTERN =
  /(?<![A-Za-z0-9])([A-Za-z_][\w.-]*)(["']?\s*[:=]\s*)("[^"]*(?:"|$)|'[^']*(?:'|$)|[^\s"',;]+)/g;

/** Whole segments. A plural (`credentials`) still counts; a prefix (`tokenizer`) does not. */
const CREDENTIAL_SEGMENTS = new Set([
  'apikey',
  'secret',
  'token',
  'password',
  'passwd',
  'credential',
]);

export const MAX_DIAGNOSTIC_LENGTH = 2000;

/**
 * Prepares program output for display.
 *
 * ANSI/OSC/CSI sequences and control characters other than tab and line feed
 * are removed before secrets are matched, so inserting an escape cannot hide
 * a credential. Pattern redaction cannot guarantee removal of every secret,
 * prompt or environment value from arbitrary stderr.
 */
export function redactDiagnostics(text: string, maxLength = MAX_DIAGNOSTIC_LENGTH): string {
  let redacted = stripControls(text);
  for (const pattern of SECRET_PATTERNS) {
    redacted = replaceMatches(redacted, pattern, () => REDACTED);
  }
  redacted = replaceMatches(redacted, AUTHORIZATION_PATTERN, (match) => redactAuthorization(match));
  redacted = replaceMatches(redacted, BEARER_PATTERN, (match) =>
    redactMarked(match, BEARER_MARKER),
  );
  redacted = replaceMatches(redacted, BASIC_PATTERN, (match) => redactMarked(match, BASIC_MARKER));
  redacted = replaceMatches(redacted, ASSIGNMENT_PATTERN, (match) => redactAssignment(match));
  redacted = redacted.trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}\n[truncated]` : redacted;
}

function redactAuthorization(match: RegExpMatchArray): string {
  const header = match[1] ?? '';
  const separator = match[2] ?? '';
  const scheme = match[3] ?? '';
  const space = match[4] ?? '';
  const rest = match[5] ?? '';
  const quoted = redactQuoted(rest);
  if (quoted === null) {
    return match[0];
  }
  return `${header}${separator}${scheme}${space}${quoted}`;
}

function redactMarked(match: RegExpMatchArray, marker: RegExp): string {
  const label = match[1] ?? '';
  const space = match[2] ?? '';
  const value = match[3] ?? '';
  if (!marker.test(value)) {
    return match[0];
  }
  return `${label}${space}${REDACTED}`;
}

function redactAssignment(match: RegExpMatchArray): string {
  const name = match[1] ?? '';
  const separator = match[2] ?? '';
  const rest = match[3] ?? '';
  if (!isCredentialName(name)) {
    return match[0];
  }
  const quoted = redactQuoted(rest);
  if (quoted === null) {
    return match[0];
  }
  return `${name}${separator}${quoted}`;
}

/** Redacts a quoted or bare assignment/header value. Empty values stay as they are. */
function redactQuoted(rest: string): string | null {
  const quote = rest.startsWith('"') || rest.startsWith("'") ? rest.charAt(0) : '';
  if (quote === '') {
    return rest.length === 0 ? null : REDACTED;
  }
  const closed = rest.length > 1 && rest.endsWith(quote);
  const value = closed ? rest.slice(1, -1) : rest.slice(1);
  if (value.length === 0) {
    return null;
  }
  return `${quote}${REDACTED}${closed ? quote : ''}`;
}

/**
 * The credential keyword is a whole segment, not a camelCase or substring
 * prefix. `token` counts in `access_token` but not in a count such as
 * `tokenCount` or `token_count`.
 */
function isCredentialName(name: string): boolean {
  const segments = nameSegments(name);
  const keywords = new Set<string>();
  for (const segment of segments) {
    const keyword = keywordOf(segment);
    if (keyword !== null) {
      keywords.add(keyword);
    }
  }
  for (let index = 0; index < segments.length - 1; index += 1) {
    const current = segments[index]?.toLowerCase() ?? '';
    const following = segments[index + 1]?.toLowerCase() ?? '';
    if (current === 'api' && (following === 'key' || following === 'keys')) {
      keywords.add('apikey');
    }
  }
  if (keywords.size === 0) {
    return false;
  }
  const lower = segments.map((segment) => segment.toLowerCase());
  return !(keywords.size === 1 && keywords.has('token') && lower.includes('count'));
}

function keywordOf(segment: string): string | null {
  const lower = segment.toLowerCase();
  if (CREDENTIAL_SEGMENTS.has(lower)) {
    return lower;
  }
  if (lower.length > 1 && lower.endsWith('s')) {
    const singular = lower.slice(0, -1);
    if (CREDENTIAL_SEGMENTS.has(singular)) {
      return singular;
    }
  }
  return null;
}

function nameSegments(name: string): readonly string[] {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .split(/[^A-Za-z0-9]+/)
    .filter((segment) => segment.length > 0);
}

function replaceMatches(
  text: string,
  pattern: RegExp,
  replacer: (match: RegExpMatchArray) => string,
): string {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const expression = new RegExp(pattern.source, flags);
  let result = '';
  let cursor = 0;
  for (const match of text.matchAll(expression)) {
    const start = match.index;
    if (start === undefined || start < cursor) {
      continue;
    }
    result += text.slice(cursor, start);
    result += replacer(match);
    cursor = start + Math.max(match[0].length, 1);
  }
  return result + text.slice(cursor);
}

/** Drops ANSI/OSC/CSI sequences and C0/C1 controls. Tab and line feed stay. */
function stripControls(text: string): string {
  const kept: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code === 0x09 || code === 0x0a) {
      kept.push(text.charAt(index));
      continue;
    }
    if (code === 0x1b) {
      index = consumeEscape(text, index);
      continue;
    }
    // 8-bit CSI, and the 8-bit string introducers DCS, SOS, OSC, PM and APC.
    if (code === 0x9b) {
      index = Math.max(index, consumeCsi(text, index + 1));
      continue;
    }
    if (code === 0x90 || code === 0x98 || code === 0x9d || code === 0x9e || code === 0x9f) {
      index = Math.max(index, consumeTerminated(text, index + 1));
      continue;
    }
    if (isDroppedControl(code)) {
      continue;
    }
    kept.push(text.charAt(index));
  }
  return kept.join('');
}

function isDroppedControl(code: number): boolean {
  return code <= 0x1f || code === 0x7f || (code >= 0x80 && code <= 0x9f);
}

/** Last index consumed by an ESC sequence. A bare ESC does not eat the next character. */
function consumeEscape(text: string, escIndex: number): number {
  const next = escIndex + 1 < text.length ? text.charCodeAt(escIndex + 1) : undefined;
  if (next === undefined) {
    return escIndex;
  }
  if (next === 0x5b) {
    return Math.max(escIndex, consumeCsi(text, escIndex + 2));
  }
  // OSC, DCS, SOS, PM, APC. Terminated by BEL or ST.
  if (next === 0x5d || next === 0x50 || next === 0x58 || next === 0x5e || next === 0x5f) {
    return Math.max(escIndex, consumeTerminated(text, escIndex + 2));
  }
  if (next >= 0x20 && next <= 0x2f) {
    return Math.max(escIndex, consumeIntermediates(text, escIndex + 1));
  }
  return escIndex;
}

function consumeCsi(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0x40 && code <= 0x7e) {
      return index;
    }
    if (code >= 0x20 && code <= 0x3f) {
      index += 1;
      continue;
    }
    return index - 1;
  }
  return text.length - 1;
}

function consumeTerminated(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    const next = index + 1 < text.length ? text.charCodeAt(index + 1) : undefined;
    if (code === 0x1b && next === 0x5c) {
      return index + 1;
    }
    if (code === 0x07 || code === 0x9c) {
      return index;
    }
    index += 1;
  }
  return text.length - 1;
}

function consumeIntermediates(text: string, start: number): number {
  let index = start;
  while (index < text.length) {
    const code = text.charCodeAt(index);
    if (code >= 0x20 && code <= 0x2f) {
      index += 1;
      continue;
    }
    if (code >= 0x30 && code <= 0x7e) {
      return index;
    }
    return index - 1;
  }
  return text.length - 1;
}
