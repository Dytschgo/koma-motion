export function formatTimeLimit(seconds: number | null): string {
  if (seconds === null) return 'No limit';
  if (seconds % 3600 === 0)
    return `${String(seconds / 3600)} ${seconds === 3600 ? 'hour' : 'hours'}`;
  if (seconds % 60 === 0) return `${String(seconds / 60)} ${seconds === 60 ? 'minute' : 'minutes'}`;
  return `${String(seconds)} ${seconds === 1 ? 'second' : 'seconds'}`;
}

/** Existing exact limits remain selectable until the user deliberately chooses another. */
export function generationTimeLimits(current: number | null) {
  const values: (number | null)[] = [null, 300, 600, 900, 1800, 3600, 7200];
  if (!values.includes(current)) values.push(current);
  return values.map((seconds) => ({
    value: seconds === null ? 'none' : String(seconds),
    seconds,
    label: formatTimeLimit(seconds),
  }));
}
