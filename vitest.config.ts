import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.{ts,tsx}', 'apps/*/src/**/*.test.{ts,tsx}'],
    environment: 'node',
    restoreMocks: true,
    coverage: {
      provider: 'v8',
      // Every source file counts, including files no test imports.
      include: ['packages/*/src/**/*.{ts,tsx}', 'apps/desktop/src/**/*.{ts,tsx}'],
      exclude: ['**/*.test.{ts,tsx}', '**/*.fixture.ts', '**/testing/**', '**/*.d.ts'],
      reportsDirectory: 'coverage',
      reporter: ['text', 'json-summary', 'html'],
      // About three points below the baseline measured on Windows and macOS
      // (63.6 % statements, 56.9 % branches, 56.7 % functions, 65.5 % lines),
      // so coverage cannot fall unnoticed. Raise them when the baseline rises.
      thresholds: {
        statements: 60,
        branches: 53,
        functions: 53,
        lines: 62,
      },
    },
  },
});
