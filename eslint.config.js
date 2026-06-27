// ESLint flat config (ESM — package.json has "type": "module").
// The app is now native ES modules; cross-file classes are imported, not
// globals. The only remaining browser global is the vendored D3 build, loaded
// as a classic script before the app module.
import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  {
    // Never lint the vendored D3 build or dependencies.
    ignores: ['contacts-graph/js/vendor/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    // Browser application source (ES modules).
    files: ['contacts-graph/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, d3: 'readonly' },
    },
    rules: {
      // First-pass posture: surface issues without turning lint into a wall.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
    },
  },
  {
    // Node-side files: tests, helpers, and tooling config (also ES modules).
    files: ['contacts-graph/test/**/*.js', 'eslint.config.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  // Disable stylistic rules that conflict with Prettier (Prettier owns formatting).
  prettier,
];
