/** @type {import('jest').Config} */
module.exports = {
  transform: {
    "^.+\\.mts$": "<rootDir>/server/scripts/jest-native-types.cjs",
    "^.+\\.[jt]sx?$": "babel-jest",
  },
  testPathIgnorePatterns: ["/node_modules/"],
};
