/* eslint-env jest, node */
const {
  getDefaultFilename,
  isDefaultFilename,
  validFilename,
} = require("../../../utils/files/logo");

describe("default product logos", () => {
  it("selects the CoreGenie wordmark for each theme", () => {
    expect(getDefaultFilename(true)).toBe("coregenie.svg");
    expect(getDefaultFilename(false)).toBe("coregenie-dark.svg");
  });

  it("keeps legacy built-in logos from being treated as uploads", () => {
    for (const filename of [
      "coregenie.svg",
      "coregenie-dark.svg",
      "anything-llm.png",
      "anything-llm-dark.png",
      "anything-llm-invert.png",
    ]) {
      expect(isDefaultFilename(filename)).toBe(true);
      expect(validFilename(filename)).toBe(false);
    }
  });
});
