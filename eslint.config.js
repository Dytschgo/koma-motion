import js from '@eslint/js';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import { architectureBoundaries } from './scripts/architecture-boundaries.mjs';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/out/**',
      '**/dist/**',
      '**/coverage/**',
      '**/test-results/**',
      '**/playwright-report/**',
    ],
  },
  js.configs.recommended,
  {
    files: [
      'packages/**/*.{ts,tsx,js,mjs,cjs}',
      'apps/desktop/src/renderer/**/*.{ts,tsx,js,mjs,cjs}',
    ],
    plugins: { architecture: { rules: { boundaries: architectureBoundaries } } },
    rules: { 'architecture/boundaries': 'error' },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      'no-eval': 'error',
      'no-implied-eval': 'off',
      '@typescript-eslint/no-implied-eval': 'error',
      'no-new-func': 'error',
    },
  },
  {
    files: ['**/*.tsx', 'apps/desktop/src/renderer/**/*.ts', 'packages/renderer/src/**/*.ts'],
    plugins: { 'react-hooks': reactHooks },
    languageOptions: { globals: globals.browser },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
);
