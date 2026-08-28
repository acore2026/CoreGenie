jest.mock("../../../models/workspace", () => ({
  Workspace: {
    get: jest.fn(),
    getWithUser: jest.fn(),
  },
}));
jest.mock("../../../models/workspaceThread", () => ({
  WorkspaceThread: { get: jest.fn() },
}));
jest.mock("../../../utils/http", () => ({
  userFromSession: jest.fn(),
  multiUserMode: (response) => response.locals.multiUserMode,
}));

const { Workspace } = require("../../../models/workspace");
const { WorkspaceThread } = require("../../../models/workspaceThread");
const { userFromSession } = require("../../../utils/http");
const {
  validWorkspaceAndThreadSlug,
  manageWorkspaceThread,
} = require("../../../utils/middleware/validWorkspace");

function mockResponse({ multiUserMode = true, thread = null } = {}) {
  const response = {
    locals: { multiUserMode, ...(thread ? { thread } : {}) },
    status: jest.fn(),
    send: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  return response;
}

describe("workspace thread access", () => {
  beforeEach(() => jest.clearAllMocks());

  it("allows a workspace member to resolve a thread owned by another member", async () => {
    const user = { id: 2, role: "default" };
    const workspace = { id: 10, slug: "shared" };
    const thread = { id: 20, slug: "team-thread", user_id: 1 };
    const request = {
      params: { slug: workspace.slug, threadSlug: thread.slug },
    };
    const response = mockResponse();
    const next = jest.fn();
    userFromSession.mockResolvedValue(user);
    Workspace.getWithUser.mockResolvedValue(workspace);
    WorkspaceThread.get.mockResolvedValue(thread);

    await validWorkspaceAndThreadSlug(request, response, next);

    expect(Workspace.getWithUser).toHaveBeenCalledWith(user, {
      slug: workspace.slug,
    });
    expect(WorkspaceThread.get).toHaveBeenCalledWith({
      slug: thread.slug,
      workspace_id: workspace.id,
    });
    expect(response.locals.thread).toBe(thread);
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("prevents an ordinary member from modifying another member's thread", async () => {
    userFromSession.mockResolvedValue({ id: 2, role: "default" });
    const request = {};
    const response = mockResponse({
      thread: { id: 20, user_id: 1 },
    });
    const next = jest.fn();

    await manageWorkspaceThread(request, response, next);

    expect(next).not.toHaveBeenCalled();
    expect(response.status).toHaveBeenCalledWith(403);
    expect(response.json).toHaveBeenCalledWith({
      error: "You do not have permission to modify this workspace thread.",
    });
  });

  it.each([
    [{ id: 1, role: "default" }, "the owner"],
    [{ id: 2, role: "manager" }, "a manager"],
    [{ id: 3, role: "admin" }, "an admin"],
  ])("allows %s to modify the thread", async (user) => {
    userFromSession.mockResolvedValue(user);
    const response = mockResponse({
      thread: { id: 20, user_id: 1 },
    });
    const next = jest.fn();

    await manageWorkspaceThread({}, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(response.status).not.toHaveBeenCalled();
  });

  it("preserves thread modification in single-user mode", async () => {
    const response = mockResponse({
      multiUserMode: false,
      thread: { id: 20, user_id: null },
    });
    const next = jest.fn();

    await manageWorkspaceThread({}, response, next);

    expect(next).toHaveBeenCalledTimes(1);
    expect(userFromSession).not.toHaveBeenCalled();
  });
});
