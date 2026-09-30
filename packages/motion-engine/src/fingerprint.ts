import { hashString, type Koma } from '@koma-motion/core';

/** JSON with sorted object keys, so equal content always gives the same text. */
function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(',')}]`;
  }
  if (typeof value === 'object' && value !== null) {
    const record: Readonly<Record<string, unknown>> = { ...value };
    const entries = Object.keys(record)
      .sort()
      .filter((key) => record[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

/** Fingerprints by identity. Documents are immutable, so an object keeps its fingerprint. */
const fingerprints = new WeakMap<Koma, string>();

/**
 * A fingerprint of everything in a Koma. Two Komas with the same content have
 * the same fingerprint, whatever the order of their keys. It tells whether an
 * endpoint of a transition changed while the transition was being regenerated.
 */
export function fingerprintKoma(koma: Koma): string {
  const known = fingerprints.get(koma);
  if (known !== undefined) {
    return known;
  }
  const fingerprint = hashString(canonicalJson(koma));
  fingerprints.set(koma, fingerprint);
  return fingerprint;
}
