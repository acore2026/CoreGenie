import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import pluginPrettier from "eslint-plugin-prettier";
import configPrettier from "eslint-config-prettier";
import unusedImports from "eslint-plugin-unused-imports";

const sharedRules = {
  ...configPrettier.rules,
  "prettier/prettier": "error",
  "no-case-declarations": "off",
  "no-prototype-builtins": "off",
  "no-async-promise-executor": "off",
  "no-extra-boolean-cast": "off",
  "no-empty": "off",
  "no-unused-private-class-members": "warn",
  "no-unused-vars": "off",
  "unused-imports/no-unused-imports": "error",
  "unused-imports/no-unused-vars": [
    "error",
    {
      vars: "all",
      varsIgnorePattern: "^_",
      args: "after-used",
      argsIgnorePattern: "^_",
    },
  ],
};

export default defineConfig([
  { ignores: ["dist/**", "__tests__/**", "**/syncStaticLists.mjs"] },
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: { js, prettier: pluginPrettier, "unused-imports": unusedImports },
    extends: ["js/recommended"],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    rules: sharedRules,
  },
  { files: ["**/*.js"], languageOptions: { sourceType: "commonjs" } },
  {
    files: ["**/*.{ts,mts,cts}"],
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      js,
      prettier: pluginPrettier,
      "unused-imports": unusedImports,
    },
    extends: ["js/recommended"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...sharedRules,
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/await-thenable": "warn",
      "no-undef": "off",
      "no-redeclare": "off",
      "unused-imports/no-unused-vars": "off",
    },
  },
]);
