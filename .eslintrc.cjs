/** @type {import("eslint").Linter.Config} */
module.exports = {
  root: true,
  env: {
    es2022: true,
    node: true,
    browser: true,
    webextensions: true,
  },
  parser: "@typescript-eslint/parser",
  parserOptions: {
    ecmaVersion: 2022,
    sourceType: "module",
    ecmaFeatures: { jsx: true },
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  rules: {
    "@typescript-eslint/no-unused-vars": [
      "error",
      { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
    ],
    "@typescript-eslint/no-explicit-any": "warn",
    "no-console": "off",
  },
  ignorePatterns: [
    "dist",
    "node_modules",
    "*.config.ts",
    "*.config.js",
    "coverage",
    "playwright-report",
    "test-results",
  ],
};
