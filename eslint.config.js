import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist', 'dev-dist', 'node_modules', 'playwright-report', 'test-results'] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ['**/*.{ts,tsx}'],
    languageOptions: { ecmaVersion: 2022, globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      // RTL rule from CLAUDE.md: only logical Tailwind classes (ms/me/ps/pe/start/end).
      'no-restricted-syntax': [
        'error',
        {
          selector: 'Literal[value=/(^|\\s)-?(ml|mr|pl|pr|left|right)-[0-9a-z[]/]',
          message: 'Use logical Tailwind classes (ms-/me-/ps-/pe-/start-/end-) for RTL.',
        },
      ],
    },
  },
);
