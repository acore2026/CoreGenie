/* eslint-env jest, node */
const previousStorage = process.env.STORAGE_DIR;
process.env.STORAGE_DIR = "/tmp/workspace-creation-route-test";
afterAll(() => {
  if (previousStorage === undefined) delete process.env.STORAGE_DIR;
  else process.env.STORAGE_DIR = previousStorage;
});
jest.mock("../../utils/prisma", () => ({}));
jest.mock("../../models/workspace", () => ({
  Workspace: {
    VALID_ACCESS_MODES: ["private", "public_readonly", "public_collaborative"],
    new: jest.fn(),
  },
}));
jest.mock("../../models/workspaceCreation", () => ({
  creationMembers: jest.fn(),
}));
jest.mock("../../models/eventLogs", () => ({
  EventLogs: { logEvent: jest.fn() },
}));
jest.mock("../../utils/http", () => ({
  reqBody: (request) => request.body,
  userFromSession: async (_, response) => response.locals.user,
  multiUserMode: (response) => response.locals.multiUserMode,
  safeJsonParse: (value, fallback) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  },
}));
jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: jest.fn(),
}));
const { Workspace } = require("../../models/workspace");
const { creationMembers } = require("../../models/workspaceCreation");
const { workspaceEndpoints } = require("../../endpoints/workspaces");
const { validatedRequest } = require("../../utils/middleware/validatedRequest");
const routes = {};
workspaceEndpoints(
  new Proxy(
    {},
    {
      get: (_, method) => (url, middleware, handler) => {
        routes[`${method}:${url}`] = { middleware, handler };
      },
    }
  )
);
const response = (user = { id: 1, role: "default" }, multiUserMode = true) => ({
  locals: { user, multiUserMode },
  statusCode: 200,
  set: jest.fn(),
  status(code) {
    this.statusCode = code;
    return this;
  },
  json: jest.fn(),
  end: jest.fn(),
  sendStatus(code) {
    this.statusCode = code;
    return this;
  },
});
beforeEach(() => jest.clearAllMocks());
it("authenticates both routes and never accepts a caller-supplied creator ID", async () => {
  for (const key of ["post:/workspace/new", "get:/workspace/new/members"]) {
    const route = routes[key];
    expect(route.middleware).toContain(validatedRequest);
    const res = response(null);
    await route.handler({ body: { name: "研究", userId: 999 } }, res);
    expect(res.statusCode).toBe(401);
  }
  expect(Workspace.new).not.toHaveBeenCalled();
  expect(creationMembers).not.toHaveBeenCalled();
});
it("passes access, members and personal group to one creation call using the signed-in creator", async () => {
  Workspace.new.mockResolvedValue({
    workspace: { id: 20, name: "研究" },
    message: null,
  });
  const res = response();
  await routes["post:/workspace/new"].handler(
    {
      body: {
        name: " 研究 ",
        accessMode: "public_readonly",
        memberIds: [2],
        groupName: "标准",
        userId: 999,
        agentModel: "override",
      },
    },
    res
  );
  expect(Workspace.new).toHaveBeenCalledWith(
    "研究",
    1,
    { accessMode: "public_readonly" },
    { memberIds: [2], groupId: "", groupName: "标准", groupGlobal: false }
  );
  expect(res.json).toHaveBeenCalledWith({
    workspace: { id: 20, name: "研究", viewerRelation: "creator" },
    message: null,
  });
});
it.each([
  { name: " " },
  { name: "研究", accessMode: "invalid" },
  { name: 123 },
])("rejects invalid names and access modes: %j", async (body) => {
  const res = response();
  await routes["post:/workspace/new"].handler({ body }, res);
  expect(res.statusCode).toBe(400);
  expect(Workspace.new).not.toHaveBeenCalled();
});
it("returns setup errors without claiming the workspace was created", async () => {
  Workspace.new.mockResolvedValue({
    workspace: null,
    message: "部分成员已停用或不存在，请重新选择。",
  });
  const res = response();
  await routes["post:/workspace/new"].handler(
    { body: { name: "研究", memberIds: [99] } },
    res
  );
  expect(res.statusCode).toBe(400);
  expect(res.json).toHaveBeenCalledWith({
    workspace: null,
    message: "部分成员已停用或不存在，请重新选择。",
  });
});
it("offers the colleague directory to ordinary users and uses their session ID", async () => {
  creationMembers.mockResolvedValue([{ id: 2, username: "colleague" }]);
  const res = response();
  await routes["get:/workspace/new/members"].handler(
    { query: { userId: 999 } },
    res
  );
  expect(creationMembers).toHaveBeenCalledWith(1);
  expect(res.set).toHaveBeenCalledWith("Cache-Control", "no-store");
  expect(res.json).toHaveBeenCalledWith({
    users: [{ id: 2, username: "colleague" }],
  });
});
it("rejects global group creation for ordinary users before creating a workspace", async () => {
  const res = response();
  await routes["post:/workspace/new"].handler(
    {
      body: {
        name: "研究",
        groupName: "全局",
        groupGlobal: true,
        role: "admin",
      },
    },
    res
  );
  expect(res.statusCode).toBe(403);
  expect(Workspace.new).not.toHaveBeenCalled();
});
it("does not expose the directory in single-user mode", async () => {
  const res = response(null, false);
  await routes["get:/workspace/new/members"].handler({}, res);
  expect(creationMembers).not.toHaveBeenCalled();
  expect(res.json).toHaveBeenCalledWith({ users: [] });
});
