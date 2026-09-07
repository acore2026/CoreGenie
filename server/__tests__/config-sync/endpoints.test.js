const mockAuth = jest.fn();
const mockRole = jest.fn();
jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: mockAuth,
}));
jest.mock("../../utils/middleware/multiUserProtected", () => ({
  ROLES: { admin: "admin" },
  flexUserRoleValid: jest.fn(() => mockRole),
}));
jest.mock("../../config-sync", () => ({
  enabled: () => true,
  status: jest.fn(),
  detail: jest.fn(),
  reconcile: jest.fn(),
}));
const sync = require("../../config-sync");
const {
  flexUserRoleValid,
} = require("../../utils/middleware/multiUserProtected");
const { configSyncEndpoints } = require("../../endpoints/configSync");

describe("configuration sync admin endpoints", () => {
  let routes, response;
  beforeEach(() => {
    jest.clearAllMocks();
    routes = new Map();
    const register = (path, middleware, handler) =>
      routes.set(path, { middleware, handler });
    configSyncEndpoints({ get: register, post: register });
    response = { json: jest.fn(), status: jest.fn() };
    response.status.mockReturnValue(response);
  });
  it("requires authentication and administrator role on every endpoint", () => {
    expect(flexUserRoleValid).toHaveBeenCalledWith(["admin"]);
    for (const { middleware } of routes.values())
      expect(middleware).toEqual([mockAuth, mockRole]);
  });
  it("passes both comparison hashes to resolution and reports stale content", async () => {
    sync.reconcile.mockResolvedValue({
      items: [{ key: "agents/sample", status: "error", error: "内容已变化" }],
    });
    const body = {
      key: "agents/sample",
      side: "file",
      fileHash: "old",
      databaseHash: "current",
    };
    await routes.get("/admin/config-sync/resolve").handler({ body }, response);
    expect(sync.reconcile).toHaveBeenCalledWith(body);
    expect(response.status).toHaveBeenCalledWith(409);
  });
  it("rejects invalid paths and choices without attempting a sync", async () => {
    await routes
      .get("/admin/config-sync/resolve")
      .handler({ body: { key: "../../outside", side: "file" } }, response);
    expect(response.status).toHaveBeenCalledWith(400);
    expect(sync.reconcile).not.toHaveBeenCalled();
  });
});
