import js from "@eslint/js";
import tsPlugin from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import reactPlugin from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";

export default [
  {
    ignores: ["dist", "node_modules", "coverage", "playwright-report", "test-results", "dev-server/cert", "public/wasm"],
  },
  js.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2022,
        sourceType: "module",
        ecmaFeatures: { jsx: true },
      },
      globals: {
        window: "readonly",
        document: "readonly",
        navigator: "readonly",
        fetch: "readonly",
        console: "readonly",
        URL: "readonly",
        URLSearchParams: "readonly",
        FileReader: "readonly",
        Blob: "readonly",
        File: "readonly",
        AbortController: "readonly",
        setTimeout: "readonly",
        clearTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        TextEncoder: "readonly",
        TextDecoder: "readonly",
        Worker: "readonly",
        self: "readonly",
        postMessage: "readonly",
        addEventListener: "readonly",
        removeEventListener: "readonly",
        crypto: "readonly",
        localStorage: "readonly",
        sessionStorage: "readonly",
        process: "readonly",
        Buffer: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        global: "readonly",
        queueMicrotask: "readonly",
      },
    },
    plugins: {
      "@typescript-eslint": tsPlugin,
      react: reactPlugin,
      "react-hooks": reactHooks,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      "react/jsx-uses-react": "off",
      "react/react-in-jsx-scope": "off",
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/consistent-type-imports": ["error", { prefer: "type-imports" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // TypeScript already checks these — no-undef double-reports JSX, DOM
      // types, etc., causing false positives.
      "no-undef": "off",
    },
    settings: {
      react: { version: "18.3" },
    },
  },
  {
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: { console: "readonly", process: "readonly", Buffer: "readonly", __dirname: "readonly", __filename: "readonly" },
    },
  },
  {
    // dev-server is a Node CLI; console.log is the right tool for startup banners.
    files: ["dev-server/**/*.ts", "scripts/**/*.{js,mjs,cjs,ts}"],
    rules: { "no-console": "off" },
  },
];
