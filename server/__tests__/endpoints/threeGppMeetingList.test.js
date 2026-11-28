jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: jest.fn(),
}));
jest.mock("../../utils/middleware/multiUserProtected", () => ({
  ROLES: { all: "all" },
  flexUserRoleValid: jest.fn(() => "role-middleware"),
}));
jest.mock("../../utils/threeGppCatalog", () => ({
  GROUPS: ["CT4", "SA2"],
  meetings: jest.fn(),
}));
jest.mock("../../utils/globalReferenceCatalog", () => ({
  createCatalog: jest.fn(),
}));
jest.mock("../../utils/threeGppMeetingList", () => ({
  downloadMeetingList: jest.fn(),
}));
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const catalog = require("../../utils/threeGppCatalog");
const { downloadMeetingList } = require("../../utils/threeGppMeetingList");
const { threeGppCatalogEndpoints } = require("../../endpoints/threeGppCatalog");
const routes = {};
threeGppCatalogEndpoints({
  post: jest.fn(),
  get: (path, middleware, handler) => {
    routes[path] = { middleware, handler };
  },
});
function response() {
  return {
    statusCode: 200,
    on: jest.fn(),
    off: jest.fn(),
    set: jest.fn(),
    json: jest.fn(),
    status(code) {
      this.statusCode = code;
      return this;
    },
  };
}
beforeEach(() => jest.clearAllMocks());
test("both download routes require authentication and role validation", () => {
  for (const path of ["/3gpp/meeting-lists", "/3gpp/meeting-list"])
    expect(routes[path].middleware).toEqual([
      validatedRequest,
      "role-middleware",
    ]);
});
test.each([
  { group: "bad" },
  { group: ["CT4"] },
  { group: "CT4", meeting: "https://evil.test" },
  { group: "CT4" },
])("rejects invalid download input %j", async (query) => {
  const res = response();
  await routes["/3gpp/meeting-list"].handler({ query }, res);
  expect(res.statusCode).toBe(400);
  expect(downloadMeetingList).not.toHaveBeenCalled();
});
test("returns live catalog with stale status intact", async () => {
  catalog.meetings.mockResolvedValue({
    meetings: [
      { id: "CT4_138", number: 138, label: "CT4#138", suffix: "", date: null },
    ],
    fetchedAt: "2026-01-01T00:00:00Z",
    stale: true,
  });
  const res = response();
  await routes["/3gpp/meeting-lists"].handler({ query: { group: "CT4" } }, res);
  expect(res.json).toHaveBeenCalledWith({
    meetings: [
      { id: "CT4_138", number: 138, label: "CT4#138", suffix: "", date: null },
    ],
    fetchedAt: "2026-01-01T00:00:00Z",
    stale: true,
    groups: ["CT4", "SA2"],
  });
  expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
  expect(res.off).toHaveBeenCalled();
});
test("returns bounded loader result and a manual fallback on failure", async () => {
  const query = { group: "CT4", meeting: "CT4_138" };
  downloadMeetingList.mockResolvedValue({
    name: "list.xlsx",
    content: "data",
    source: "https://www.3gpp.org/list.xlsx",
    fetchedAt: "2026-01-01T00:00:00Z",
  });
  const ok = response();
  await routes["/3gpp/meeting-list"].handler({ query }, ok);
  expect(ok.json).toHaveBeenCalledWith({
    name: "list.xlsx",
    content: "data",
    source: "https://www.3gpp.org/list.xlsx",
    fetchedAt: "2026-01-01T00:00:00Z",
  });
  downloadMeetingList.mockRejectedValue(new Error("remote error"));
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  const fail = response();
  await routes["/3gpp/meeting-list"].handler({ query }, fail);
  expect(fail.statusCode).toBe(502);
  expect(fail.json).toHaveBeenCalledWith({
    error: expect.stringContaining("手动上传"),
  });
  warn.mockRestore();
});

test("catalog requests return an error after the time limit", async () => {
  jest.useFakeTimers();
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    catalog.meetings.mockImplementation(() => new Promise(() => {}));
    const res = response();
    const pending = routes["/3gpp/meeting-lists"].handler(
      { query: { group: "CT4" } },
      res
    );
    await jest.advanceTimersByTimeAsync(60000);
    await pending;
    expect(res.statusCode).toBe(502);
    expect(res.off).toHaveBeenCalled();
  } finally {
    warn.mockRestore();
    jest.useRealTimers();
  }
});

test.each([
  ["/3gpp/meeting-lists", catalog.meetings, { meetings: [{}] }],
  ["/3gpp/meeting-list", downloadMeetingList, { content: "%%%" }],
])("rejects malformed upstream data at %s", async (path, load, data) => {
  const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
  try {
    load.mockResolvedValue(data);
    const res = response();
    await routes[path].handler(
      { query: { group: "CT4", meeting: "CT4_138" } },
      res
    );
    expect(res.statusCode).toBe(502);
    expect(res.json).toHaveBeenCalledWith({
      error: expect.stringContaining("手动上传"),
    });
  } finally {
    warn.mockRestore();
  }
});
