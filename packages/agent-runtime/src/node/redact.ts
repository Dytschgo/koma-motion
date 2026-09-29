const REDACTED = '[redacted]';

/** Patterns of common credentials. Redaction is a safety net, not a guarantee. */
const SECRET_PATTERNS: readonly RegExp[] = [
  // Provider API keys and GitHub tokens.
  /\bsk-[A-Za-z0-9_-]{16,}\b/g,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  // JSON Web Tokens.
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
  // Authorization headers.
  /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{12,}/gi,
];

/** `NAME=value` and `"name": "value"` where the name suggests a credential. */
const ASSIGNMENT_PATTERN =
  /\b([A-Za-z0-9_.-]*(?:api[_-]?key|secret|token|password|passwd|credential)[A-Za-z0-9_.-]*)("?\s*[:=]\s*"?)([^\s"',;]{4,})/gi;

export const MAX_DIAGNOSTIC_LENGTH = 2000;

/**
 * Prepares program output for display: removes what looks like a credential,
 * removes control characters and limits the length.
 */
export function redactDiagnostics(text: string, maxLength = MAX_DIAGNOSTIC_LENGTH): string {
  let redacted = text;
  for (const pattern of SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, REDACTED);
  }
  redacted = redacted.replace(
    ASSIGNMENT_PATTERN,
    (_match, name: string, separator: string) => `${name}${separator}${REDACTED}`,
  );
  // Remove ANSI escape sequences and control characters except tab and line feed.
  redacted = redacted
    // eslint-disable-next-line no-control-regex
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, '')
    .trim();
  return redacted.length > maxLength ? `${redacted.slice(0, maxLength)}\n[truncated]` : redacted;
}
