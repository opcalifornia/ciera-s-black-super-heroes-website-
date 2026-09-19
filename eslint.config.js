const js = require("@eslint/js");
const globals = require("globals");
const prettierConfig = require("eslint-config-prettier");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": ["warn", { argsIgnorePattern: "^_", args: "none" }],
      // A handful of intentional "best-effort, ignore failure" catches
      // (e.g. localStorage in a private-browsing context).
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    files: ["public/**/*.js"],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ["tests/**/*.js"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { ...globals.node },
    },
  },
  {
    ignores: ["node_modules/**", "data/**", "uploads/**", "coverage/**"],
  },
  prettierConfig,
];
