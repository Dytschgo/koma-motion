import js from '@eslint/js';
import jsxA11y from 'eslint-plugin-jsx-a11y';
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
    // Static accessibility checks for JSX. This is not a screen-reader test.
    files: ['**/*.tsx'],
    plugins: { 'jsx-a11y': jsxA11y },
    settings: {
      'jsx-a11y': {
        // The elements that the controls in `components/ui.tsx` and
        // `components/Menu.tsx` render, so the rules check them like native ones.
        components: {
          Button: 'button',
          IconButton: 'button',
          MenuButton: 'button',
          NumberInput: 'input',
          SearchField: 'input',
          Select: 'select',
          Switch: 'input',
          TextArea: 'textarea',
          TextInput: 'input',
        },
      },
    },
    rules: jsxA11y.flatConfigs.recommended.rules,
  },
  {
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: { globals: globals.node },
  },
);
