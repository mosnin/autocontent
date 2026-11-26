// eslint.config.js: `pnpm lint` (CI runs it on every push). ESLint recommended + typescript-eslint
// recommended for src/, test/, web/, scripts/ and voice-agent/src. Type-aware rules stay off to keep lint
// fast; `pnpm typecheck` (and `pnpm typecheck:web`) is the type gate.
import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  globalIgnores([
    "dist/",
    "coverage/",
    ".wrangler/",
    ".flue-vite/",
    ".promptfoo/",
    ".agents/",
    ".claude/",
    "vendor/",
    "voice-agent/dist/",
    "voice-agent/vendor/",
    "**/*.generated.ts",
  ]),
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    rules: {
      // `_name` marks an intentionally unused binding (handler signatures, destructured omissions).
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none", ignoreRestSiblings: true }],
      // Sanitizers deliberately match control characters (header/log/prompt injection defenses).
      "no-control-regex": "off",
    },
  },
  {
    // Plain JS: Node scripts (seed, DLQ replay, golden VM, builds) and this config.
    files: ["**/*.{js,mjs,cjs}"],
    languageOptions: { globals: globals.node },
  },
);
