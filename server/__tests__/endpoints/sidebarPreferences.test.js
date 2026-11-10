/* eslint-env jest, node */
jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: jest.fn(),
}));
jest.mock("../../utils/http", () => ({
  userFromSession: jest.fn(async (_, response) => response.locals.user),
  reqBody: (request) => request.body,
}));
jest.mock("../../models/sidebarPreferences", () => ({
  SidebarPreferences: {
    get: jest.fn(),
    initialize: jest.fn(),
    change: jest.fn(),
  },
}));
const { SidebarPreferences } = require("../../models/sidebarPreferences");
jest.mock("../../models/globalWorkspaceGroups", () => ({
  GlobalWorkspaceGroups: {
    read: jest.fn(async () => ({
      groups: { groups: [], assignments: {}, collapsed: {} },
    })),
    change: jest.fn(),
  },
}));
const { GlobalWorkspaceGroups } = require("../../models/globalWorkspaceGroups");
const {
  sidebarPreferenceEndpoints,
} = require("../../endpoints/sidebarPreferences");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const routes = {};
sidebarPreferenceEndpoints(
  Object.fromEntries(
    ["get", "post", "put"].map((method) => [
      method,
      (path, middleware, handler) => {
        routes[method] = { path, middleware, handler };
      },
    ])
  )
);
const response = (user) => ({
  locals: { multiUserMode: true, user },
  statusCode: 200,
  set: jest.fn(),
  status(code) {
    this.statusCode = code;
    return this;
  },
  json: jest.fn(),
  sendStatus(code) {
    this.statusCode = code;
  },
});
beforeEach(() => jest.clearAllMocks());
it("requires authentication on every method and does not accept a supplied user ID", async () => {
  for (const method of ["get", "post", "put"]) {
    expect(routes[method].middleware).toContain(validatedRequest);
    const res = response({ id: 7 });
    await routes[method].handler(
      { body: { userId: 999 }, query: { userId: 999 } },
      res
    );
    expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
  }
  expect(SidebarPreferences.get).toHaveBeenCalledWith(7);
  expect(SidebarPreferences.initialize).toHaveBeenCalledWith(7, {
    userId: 999,
  });
  expect(SidebarPreferences.change).toHaveBeenCalledWith(7, { userId: 999 });
});
it("never falls back to shared settings for missing multi-user sessions", async () => {
  const res = response(null);
  await routes.get.handler({}, res);
  expect(res.statusCode).toBe(401);
  expect(SidebarPreferences.get).not.toHaveBeenCalled();
});
it("returns a clear error without exposing database internals", async () => {
  SidebarPreferences.change.mockRejectedValueOnce(
    new Error("private database detail")
  );
  const res = response({ id: 7 });
  await routes.put.handler({ body: {} }, res);
  expect(res.statusCode).toBe(400);
  expect(res.json).toHaveBeenCalledWith({
    error: "分组和收藏未能同步，请稍后重试。",
  });
});
it("only lets administrators modify global groups, ignoring a role supplied in the body", async () => {
  const body = {
    type: "global-group",
    action: "create",
    name: "标准",
    scope: "public",
    role: "admin",
  };
  const regular = response({ id: 7, role: "default" });
  await routes.put.handler({ body }, regular);
  expect(regular.statusCode).toBe(403);
  expect(GlobalWorkspaceGroups.change).not.toHaveBeenCalled();
  const admin = response({ id: 1, role: "admin" });
  await routes.put.handler({ body }, admin);
  expect(GlobalWorkspaceGroups.change).toHaveBeenCalledWith(1, body);
});
