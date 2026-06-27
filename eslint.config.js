// ESLint flat config (CommonJS — package.json has "type": "commonjs").
// The app is loaded as classic browser globals (no ES modules yet), so the
// cross-file classes are declared as globals here. When we migrate to ES
// modules, drop those globals and switch `sourceType` to "module".
const js = require('@eslint/js');
const globals = require('globals');
const prettier = require('eslint-config-prettier');

// Classes defined in one file and consumed in another via window globals.
const appGlobals = {
  d3: 'readonly',
  VCardUtils: 'readonly',
  ContactRecord: 'readonly',
  VCFParser: 'readonly',
  VCardAdapter: 'readonly',
  MarkdownAdapter: 'readonly',
  RelationshipBuilder: 'readonly',
  ContactGraph: 'readonly',
  ContactRelationshipApp: 'writable',
  app: 'writable',
};

module.exports = [
  {
    // Never lint the vendored D3 build or dependencies.
    ignores: ['contacts-graph/js/vendor/**', 'node_modules/**'],
  },
  js.configs.recommended,
  {
    // Browser application source.
    files: ['contacts-graph/js/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: { ...globals.browser, ...appGlobals },
    },
    rules: {
      // First-pass posture: surface issues without turning lint into a wall.
      // Tighten these to "error" as we clean up and modularize.
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // The cross-file classes above are declared as globals (classic-script
      // loading) AND defined via `class X {}` in their own file. Don't treat
      // that intentional pattern as a redeclaration. Drops away once we move
      // to ES modules.
      'no-redeclare': ['error', { builtinGlobals: false }],
    },
  },
  {
    // Node-side files: tests, helpers, and tooling config.
    files: ['contacts-graph/test/**/*.{js,cjs}', '*.config.js', '*.cjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'commonjs',
      globals: { ...globals.node },
    },
    rules: {
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_' }],
    },
  },
  // Disable stylistic rules that conflict with Prettier (Prettier owns formatting).
  prettier,
];
