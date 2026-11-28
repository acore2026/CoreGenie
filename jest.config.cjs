/** @type {import('jest').Config} */
module.exports = {
  transform: {
    "^.+\\.[cm]?tsx?$": "<rootDir>/server/scripts/jest-native-types.cjs",
    "^.+\\.jsx?$": "babel-jest",
  },
  moduleFileExtensions: ["js", "mjs", "cjs", "ts", "mts", "cts", "json"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/.codex-tmp/",
    "/__tests__/helpers/",
  ],
};
