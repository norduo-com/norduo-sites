// Shared ESLint flat config for every package and site.
// Usage in a package: `export default config({ tsconfigRootDir: import.meta.dirname })`
import js from '@eslint/js'
import prettier from 'eslint-config-prettier'
import jsxA11y from 'eslint-plugin-jsx-a11y'
import reactHooks from 'eslint-plugin-react-hooks'
import simpleImportSort from 'eslint-plugin-simple-import-sort'
import globals from 'globals'
import tseslint from 'typescript-eslint'

import norduo from './spacing-tokens.js'

/**
 * @param {{ tsconfigRootDir: string, ignores?: string[], spacingTokens?: boolean }} options
 *   `spacingTokens`: for sites, whose class names use the spacing and radius tokens.
 */
export function config({ tsconfigRootDir, ignores = [], spacingTokens = false }) {
  return tseslint.config(
    {
      ignores: [
        '**/node_modules/**',
        '**/build/**',
        '**/dist/**',
        '**/coverage/**',
        '**/.react-router/**',
        '**/.wrangler/**',
        '**/playwright-report/**',
        '**/test-results/**',
        '**/worker-configuration.d.ts',
        ...ignores,
      ],
    },
    js.configs.recommended,
    tseslint.configs.strictTypeChecked,
    tseslint.configs.stylisticTypeChecked,
    {
      languageOptions: {
        globals: { ...globals.browser, ...globals.node },
        parserOptions: { projectService: true, tsconfigRootDir },
      },
    },
    reactHooks.configs.flat['recommended-latest'] ?? reactHooks.configs['recommended-latest'],
    jsxA11y.flatConfigs.recommended,
    {
      plugins: { 'simple-import-sort': simpleImportSort },
      rules: {
        'simple-import-sort/imports': 'error',
        'simple-import-sort/exports': 'error',
        '@typescript-eslint/consistent-type-imports': 'error',
        '@typescript-eslint/no-unused-vars': [
          'error',
          { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
        ],
        '@typescript-eslint/restrict-template-expressions': ['error', { allowNumber: true }],
      },
    },
    spacingTokens ? { plugins: { norduo }, rules: { 'norduo/spacing-tokens': 'error' } } : {},
    {
      // Plain JS config files are linted without type information.
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
    },
    prettier,
  )
}
