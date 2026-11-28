import tseslint from "typescript-eslint"
import js from "@eslint/js"
import globals from "globals"
import pluginReact from "eslint-plugin-react"
import pluginReactHooks from "eslint-plugin-react-hooks"
import pluginPrettier from "eslint-plugin-prettier"
import configPrettier from "eslint-config-prettier"
import unusedImports from "eslint-plugin-unused-imports"

export default [
  { ignores: ["src/media/**/*"] },
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
      globals: globals.browser,
    },
    plugins: {
      "@typescript-eslint": tseslint.plugin,
      react: pluginReact,
      "react-hooks": pluginReactHooks,
      "unused-imports": unusedImports,
      prettier: pluginPrettier,
    },
    settings: { react: { version: "detect" } },
    rules: {
      ...js.configs.recommended.rules,
      ...pluginReact.configs.flat.recommended.rules,
      ...pluginReactHooks.configs.recommended.rules,
      ...configPrettier.rules,
      "prettier/prettier": "error",
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/await-thenable": "warn",
      "unused-imports/no-unused-imports": "error",
      "react/react-in-jsx-scope": "off",
      "react-hooks/exhaustive-deps": "off",
      "react/prop-types": "off",
      "react-hooks/set-state-in-effect": "off",
      "react-hooks/refs": "off",
      "react/jsx-no-target-blank": "error",
      "react/no-unescaped-entities": "off",
      "react/display-name": "off",
      "react-hooks/immutability": "off",
      "react-hooks/preserve-manual-memoization": "off",
      "no-extra-boolean-cast": "off",
      "no-prototype-builtins": "off",
      "no-empty": "off",
      "no-useless-escape": "off",
      "no-unsafe-optional-chaining": "off",
      "no-constant-binary-expression": "off",
      // The compiler checks names, overloads, and unused declarations.
      "no-undef": "off",
      "no-redeclare": "off",
      "no-unused-vars": "off",
    },
  },
]
