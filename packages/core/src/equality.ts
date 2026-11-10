function isPlainObject(value: object): value is Readonly<Record<string, unknown>> {
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

/**
 * Whether two values of the document model have the same content.
 *
 * Use it to detect a change. It replaces comparing `JSON.stringify` output,
 * which depends on the order of keys and serialises embedded assets only to
 * compare them. Values are JSON-shaped: plain objects, arrays, strings,
 * numbers, booleans, `null` and `undefined`.
 *
 * - The same reference is equal without being read, so an unchanged subtree
 *   or an embedded asset costs nothing.
 * - Objects are equal when they have the same keys with equal values. The
 *   order of keys does not matter.
 * - A property whose value is `undefined` equals a missing property, as it
 *   does in a saved project.
 * - Arrays are equal when they have the same length and equal items in the
 *   same order. An array never equals an object.
 * - Primitives compare with `===`, so `0` equals `-0`. `NaN` equals `NaN`.
 * - Numbers are exact. To compare geometry with a tolerance, use the motion
 *   engine.
 *
 * It is stricter than `JSON.stringify` where that maps different values to
 * the same text: `NaN`, an infinity and `null` differ from each other, and
 * `undefined` in an array differs from `null`. Validated documents contain
 * none of these.
 *
 * Symbol keys and properties that are not enumerable are ignored. Other
 * objects, such as a `Date`, a `Map` or a class instance, are equal only to
 * themselves, and `toJSON` is not called. Values must not contain cycles.
 */
export function isStructurallyEqual(a: unknown, b: unknown): boolean {
  if (a === b) {
    return true;
  }
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    return typeof a === 'number' && typeof b === 'number' && Number.isNaN(a) && Number.isNaN(b);
  }
  if (Array.isArray(a) || Array.isArray(b)) {
    return (
      Array.isArray(a) &&
      Array.isArray(b) &&
      a.length === b.length &&
      a.every((item, index) => isStructurallyEqual(item, b[index]))
    );
  }
  if (!isPlainObject(a) || !isPlainObject(b)) {
    return false;
  }
  let defined = 0;
  for (const key of Object.keys(a)) {
    const value = a[key];
    if (value === undefined) {
      continue;
    }
    defined += 1;
    if (!Object.hasOwn(b, key) || !isStructurallyEqual(value, b[key])) {
      return false;
    }
  }
  // Every defined property of `a` matched, so equal counts mean `b` has no other.
  return defined === Object.keys(b).filter((key) => b[key] !== undefined).length;
}
