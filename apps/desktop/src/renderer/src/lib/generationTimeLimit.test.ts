import { describe, expect, it } from 'vitest';
import { formatTimeLimit, generationTimeLimits } from './generationTimeLimit';

describe('generation time choices', () => {
  it('keeps no limit and the saved exact choice without coercion or duplicates', () => {
    for (const saved of [null, 45, 300, 1500, 7200, 2147483]) {
      const choices = generationTimeLimits(saved);
      expect(choices.filter((choice) => choice.seconds === saved)).toHaveLength(1);
      expect(choices.find((choice) => choice.value === 'none')?.seconds).toBeNull();
      expect(new Set(choices.map((choice) => choice.value)).size).toBe(choices.length);
    }
  });

  it('uses familiar units without rounding away saved seconds', () => {
    expect(formatTimeLimit(null)).toBe('No limit');
    expect(formatTimeLimit(300)).toBe('5 minutes');
    expect(formatTimeLimit(3600)).toBe('1 hour');
    expect(formatTimeLimit(7200)).toBe('2 hours');
    expect(formatTimeLimit(45)).toBe('45 seconds');
    expect(formatTimeLimit(1500)).toBe('25 minutes');
  });
});
