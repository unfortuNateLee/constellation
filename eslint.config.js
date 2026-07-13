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
    ignores: ['js/vendor/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    // Browser application source (ES modules).
    files: ['js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, d3: 'readonly' },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-empty': ['error', { allowEmptyCatch: true }],
    },
  },
  {
    // Node-side files: tests, helpers, and tooling config (also ES modules).
    // The e2e specs also get browser globals: page.evaluate / waitForFunction
    // callbacks execute in the page, so they legitimately reference window.
    files: [
      'test/**/*.js',
      'e2e/**/*.js',
      'scripts/**/*.js',
      'eslint.config.js',
      'playwright.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    // CommonJS tooling scripts (the physics-parity d3 ground-truth dumper must
    // be `.cjs` to `require` the vendored UMD d3 build). ESLint auto-detects the
    // CommonJS source type for `.cjs`, but Node-only globals (__dirname etc.)
    // still need to be declared.
    files: ['scripts/**/*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Disable stylistic rules that conflict with Prettier (Prettier owns formatting).
  prettier,
];
