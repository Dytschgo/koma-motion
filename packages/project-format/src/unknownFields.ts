function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Lists the paths of properties that exist in `input` but not in `output`.
 * Validation removes properties it does not know; this makes the removal
 * visible instead of silent.
 */
export function findDroppedFields(input: unknown, output: unknown, path = ''): string[] {
  if (Array.isArray(input) && Array.isArray(output)) {
    return input.flatMap((item, index) =>
      findDroppedFields(item, output[index], `${path}[${String(index)}]`),
    );
  }
  if (isPlainObject(input) && isPlainObject(output)) {
    return Object.keys(input).flatMap((key) => {
      const childPath = path === '' ? key : `${path}.${key}`;
      if (!Object.hasOwn(output, key)) {
        return [childPath];
      }
      return findDroppedFields(input[key], output[key], childPath);
    });
  }
  return [];
}
