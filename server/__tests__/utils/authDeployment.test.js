jest.mock("node:fs", () => ({ readFileSync: jest.fn() }));
const fs = require("node:fs");
const { oauthOnly, getConfig } = require("../../utils/idaas/config");

describe("authentication deployment isolation", () => {
  const originalMode = process.env.COREGENIE_AUTH_MODE;
  const originalFile = process.env.COREGENIE_IDAAS_CONFIG_FILE;
  afterEach(() => {
    for (const [key, value] of Object.entries({
      COREGENIE_AUTH_MODE: originalMode,
      COREGENIE_IDAAS_CONFIG_FILE: originalFile,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    jest.clearAllMocks();
  });
  test.each([undefined, "local"])(
    "mode %s never opens an IDaaS secret file",
    (mode) => {
      if (mode === undefined) delete process.env.COREGENIE_AUTH_MODE;
      else process.env.COREGENIE_AUTH_MODE = mode;
      process.env.COREGENIE_IDAAS_CONFIG_FILE = "/remote-only/config.json";
      expect(oauthOnly()).toBe(false);
      expect(getConfig()).toBeNull();
      expect(fs.readFileSync).not.toHaveBeenCalled();
    }
  );
  test("IDaaS requires its own configuration instead of falling back to local login", () => {
    process.env.COREGENIE_AUTH_MODE = "idaas";
    fs.readFileSync.mockImplementation(() => { throw new Error("missing config"); });
    expect(oauthOnly()).toBe(true);
    expect(() => getConfig()).toThrow("missing config");
  });
});
