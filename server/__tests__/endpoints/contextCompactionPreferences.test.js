jest.mock("../../utils/http", () => ({
  ...jest.requireActual("../../utils/http"),
  userFromSession: jest.fn(),
  reqBody: (request) => request.body,
}));
const { userFromSession } = require("../../utils/http");
const { SystemSettings } = require("../../models/systemSettings");
const { adminEndpoints } = require("../../endpoints/admin");
const key = "agent_context_compaction_enabled";
const routes = new Map();
const register =
  (method) =>
  (path, ...handlers) =>
    routes.set(method + " " + path, handlers.at(-1));
adminEndpoints({
  get: register("GET"),
  post: register("POST"),
  delete: register("DELETE"),
  put: register("PUT"),
});
function response() {
  const res = {
    status: jest.fn(),
    json: jest.fn(),
    sendStatus: jest.fn(),
    end: jest.fn(),
  };
  res.status.mockReturnValue(res);
  res.sendStatus.mockReturnValue(res);
  return res;
}
afterEach(() => jest.restoreAllMocks());

it("defaults the absent setting to true", async () => {
  const get = jest
    .spyOn(SystemSettings, "getValueOrFallback")
    .mockResolvedValue("true");
  expect(await SystemSettings.agentContextCompactionEnabled()).toBe(true);
  expect(get).toHaveBeenCalledWith({ label: key }, "true");
});
it.each([
  ["true", true],
  ["false", false],
  ["1", false],
  [null, false],
])(
  "only the explicit true value enables compaction (%s)",
  async (value, enabled) => {
    jest.spyOn(SystemSettings, "getValueOrFallback").mockResolvedValue(value);
    expect(await SystemSettings.agentContextCompactionEnabled()).toBe(enabled);
  }
);
it("registers and normalizes the setting", () => {
  expect(SystemSettings.supportedFields).toContain(key);
  expect(SystemSettings.publicFields).toContain(key);
  expect(SystemSettings.validations[key](true)).toBe("true");
  expect(SystemSettings.validations[key]("false")).toBe("false");
  expect(SystemSettings.validations[key]("yes")).toBe("false");
});
it("returns true to an administrator before any setting is saved", async () => {
  userFromSession.mockResolvedValue({ role: "admin" });
  jest.spyOn(SystemSettings, "get").mockResolvedValue(null);
  const res = response();
  await routes.get("GET /admin/system-preferences-for")(
    { query: { labels: key } },
    res
  );
  expect(res.json).toHaveBeenCalledWith({ settings: { [key]: "true" } });
});
it("allows an administrator to save the switch", async () => {
  userFromSession.mockResolvedValue({ role: "admin" });
  const update = jest
    .spyOn(SystemSettings, "updateSettings")
    .mockResolvedValue({ success: true, error: null });
  await routes.get("POST /admin/system-preferences")(
    { body: { [key]: "true" } },
    response()
  );
  expect(update).toHaveBeenCalledWith({ [key]: "true" });
});
it("does not allow a manager to change global compaction", async () => {
  userFromSession.mockResolvedValue({ role: "manager" });
  const update = jest
    .spyOn(SystemSettings, "updateSettings")
    .mockResolvedValue({ success: true, error: null });
  await routes.get("POST /admin/system-preferences")(
    { body: { [key]: "true" } },
    response()
  );
  expect(update).toHaveBeenCalledWith({});
});
