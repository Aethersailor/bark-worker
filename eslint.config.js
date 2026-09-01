import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["coverage/**", "dist/**", "node_modules/**", "worker-configuration.d.ts"],
  },
  eslint.configs.recommended,
  {
    files: ["scripts/**/*.mjs", "*.config.js", "*.config.ts"],
    languageOptions: {
      globals: {
        ...globals.node,
        AbortSignal: "readonly",
        fetch: "readonly",
      },
    },
  },
  ...tseslint.configs.recommended,
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-floating-promises": "error",
    },
  },
);
