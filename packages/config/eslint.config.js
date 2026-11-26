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
      // Playwright matches a text string as any substring, ignoring case: 'Mynd 1' also finds
      // "Hleður upp mynd 1 af 1…". getByLabel and getByRole's `name` match the same way but
      // aren't checked: a required field's label is "Heiti *", so `exact` breaks them, and
      // CODING_STANDARDS.md covers form fields.
      files: ['**/e2e/**/*.ts'],
      rules: {
        'no-restricted-syntax': [
          'error',
          {
            selector:
              "CallExpression[callee.property.name='getByText']:not([arguments.0.regex]):not([arguments.0.callee.name='RegExp']):not(:has(Property[key.name='exact'][value.value=true]))",
            message: 'Pass getByText { exact: true }, or a RegExp to match part of the text.',
          },
          {
            selector:
              "Property[key.name='hasText']:matches([value.type='TemplateLiteral'], [value.type='Literal']:not([value.regex]))",
            message: 'A hasText string matches any substring, ignoring case. Pass a RegExp.',
          },
        ],
      },
    },
    {
      // Plain JS config files are linted without type information.
      files: ['**/*.{js,mjs,cjs}'],
      extends: [tseslint.configs.disableTypeChecked],
    },
    prettier,
  )
}
