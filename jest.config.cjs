/** @type {import('jest').Config} */
module.exports = {
  transform: {
    "^.+\\.[cm]?tsx?$": "<rootDir>/server/scripts/jest-native-types.cjs",
    "^.+\\.jsx?$": "babel-jest",
  },
  moduleFileExtensions: ["js", "mjs", "cjs", "ts", "mts", "cts", "json"],
  testPathIgnorePatterns: [
    "/node_modules/",
    "<rootDir>/collector/",
    "<rootDir>/frontend/",
    "<rootDir>/packages/contracts/",
    "/.codex-tmp/",
    "/__tests__/helpers/",
  ],
};
