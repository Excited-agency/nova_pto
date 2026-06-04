import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import importX from 'eslint-plugin-import-x'

export default tseslint.config(
  { ignores: ['dist', 'supabase/functions/**'] },

  // JavaScript files
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      'no-unused-vars': ['error', { varsIgnorePattern: '^[A-Z_]' }],
    },
  },

  // TypeScript files
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      'import-x': importX,
    },
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaFeatures: { jsx: true },
      },
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      // TypeScript handles unused vars better
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_', ignoreRestSiblings: true },
      ],
      // Enforce import type for type-only imports (inline style avoids duplicate-import conflicts)
      '@typescript-eslint/consistent-type-imports': [
        'error',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      // Warn on any, don't error (gradual adoption)
      '@typescript-eslint/no-explicit-any': 'warn',
      // No duplicate imports (prefer inline merges type + value from same module)
      'import-x/no-duplicates': ['error', { 'prefer-inline': true }],
      // setState in effects is a real issue but will be fixed in component refactors (steps 4-6)
      'react-hooks/set-state-in-effect': 'warn',
    },
  },

  // Test files — looser unused-var rules for destructured result patterns
  {
    files: ['src/test/**/*.ts', 'e2e/**/*.ts', 'e2e/**/*.spec.ts'],
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { varsIgnorePattern: '^[A-Z_]|^_', argsIgnorePattern: '^_', ignoreRestSiblings: true, destructuredArrayIgnorePattern: '^_' },
      ],
    },
  },
)
