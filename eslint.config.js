import js from '@eslint/js';
import globals from 'globals';

export default [
  js.configs.recommended,
  { ignores: ['node_modules/', 'data/', 'dist/'] },
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      eqeqeq: 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', caughtErrors: 'none' }],
      'prefer-const': 'error',
    },
  },
  {
    files: ['src/app/ui/**/*.js', 'src/cloud/ui/**/*.js'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
];
