import js from "@eslint/js";
import globals from "globals";
import { defineConfig } from "eslint/config";
import tsParser from "@typescript-eslint/parser";
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
  { ignores: ["__tests__/**", "**/syncStaticLists.mjs"] },
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
    plugins: { js, prettier: pluginPrettier, "unused-imports": unusedImports },
    extends: ["js/recommended"],
    languageOptions: {
      parser: tsParser,
      globals: { ...globals.node, ...globals.browser },
    },
    rules: {
      ...sharedRules,
      "no-undef": "off",
      "no-redeclare": "off",
      "unused-imports/no-unused-vars": "off",
    },
  },
]);
