jest.mock("../../utils/http", () => ({
  reqBody: (request) => request.body,
  multiUserMode: (response) => response.locals.multiUserMode,
  userFromSession: async (_request, response) => response.locals.user,
}));
jest.mock("../../models/workspaceThread", () => ({
  WorkspaceThread: { get: jest.fn() },
}));
jest.mock("../../models/workspaceParsedFiles", () => ({
  WorkspaceParsedFiles: {
    getContextMetadataAndLimits: jest.fn().mockResolvedValue({ files: [] }),
    create: jest.fn(),
  },
}));
jest.mock("../../models/threadLifecycle", () => ({
  ...jest.requireActual("../../models/threadLifecycle"),
  retainThreadDraft: jest.fn(),
}));
jest.mock("../../utils/collectorApi", () => ({ CollectorApi: jest.fn() }));
jest.mock("../../utils/files/multer", () => ({ handleFileUpload: jest.fn() }));
jest.mock("../../utils/middleware/validatedRequest", () => ({
  validatedRequest: jest.fn(),
}));
jest.mock("../../utils/middleware/validWorkspace", () => ({
  validWorkspaceSlug: jest.fn(),
}));
jest.mock("../../utils/middleware/multiUserProtected", () => ({
  flexUserRoleValid: jest.fn(),
  ROLES: {},
}));
jest.mock("../../models/eventLogs", () => ({
  EventLogs: { logEvent: jest.fn() },
}));

const {
  workspaceParsedFilesEndpoints,
} = require("../../endpoints/workspacesParsedFiles");
const { WorkspaceThread } = require("../../models/workspaceThread");
const { WorkspaceParsedFiles } = require("../../models/workspaceParsedFiles");
const { retainThreadDraft } = require("../../models/threadLifecycle");
const { CollectorApi } = require("../../utils/collectorApi");

describe("thread file privacy", () => {
  let routes;
  const online = jest.fn();
  const parseDocument = jest.fn();
  const response = (userId = 2) => {
    const res = {
      locals: {
        workspace: { id: 10 },
        user: { id: userId },
        multiUserMode: true,
      },
      status: jest.fn(),
      sendStatus: jest.fn(),
      json: jest.fn(),
      end: jest.fn(),
    };
    res.status.mockReturnValue(res);
    res.sendStatus.mockReturnValue(res);
    return res;
  };
  beforeEach(() => {
    jest.clearAllMocks();
    routes = {};
    const register = (path, _middleware, handler) => {
      routes[path] = handler;
    };
    workspaceParsedFilesEndpoints({
      get: register,
      post: register,
      delete: register,
    });
    WorkspaceThread.get.mockResolvedValue({
      id: 20,
      user_id: 1,
      submittedAt: null,
    });
    CollectorApi.mockImplementation(() => ({ online, parseDocument }));
    online.mockResolvedValue(false);
  });
  it("rejects another user's draft file listing and scopes lookup to the workspace", async () => {
    const res = response();
    await routes["/workspace/:slug/parsed-files"](
      { query: { threadSlug: "draft" } },
      res
    );
    expect(WorkspaceThread.get).toHaveBeenCalledWith({
      slug: "draft",
      workspace_id: 10,
    });
    expect(res.sendStatus).toHaveBeenCalledWith(404);
    expect(
      WorkspaceParsedFiles.getContextMetadataAndLimits
    ).not.toHaveBeenCalled();
  });
  it("rejects parsing into someone else's draft before contacting the collector", async () => {
    const res = response();
    await routes["/workspace/:slug/parse"](
      { body: { threadSlug: "draft" }, file: { originalname: "test.pdf" } },
      res
    );
    expect(res.sendStatus).toHaveBeenCalledWith(404);
    expect(retainThreadDraft).not.toHaveBeenCalled();
    expect(online).not.toHaveBeenCalled();
  });
  it("protects the creator's upload before parsing, including failed uploads", async () => {
    online.mockImplementation(async () => {
      expect(retainThreadDraft).toHaveBeenCalledWith(20);
      return false;
    });
    const res = response(1);
    await routes["/workspace/:slug/parse"](
      { body: { threadSlug: "draft" }, file: { originalname: "test.pdf" } },
      res
    );
    expect(res.status).toHaveBeenCalledWith(500);
  });
  it("allows the creator and preserves default conversation listings", async () => {
    await routes["/workspace/:slug/parsed-files"](
      { query: { threadSlug: "draft" } },
      response(1)
    );
    expect(
      WorkspaceParsedFiles.getContextMetadataAndLimits
    ).toHaveBeenCalledTimes(1);
    await routes["/workspace/:slug/parsed-files"]({ query: {} }, response());
    expect(
      WorkspaceParsedFiles.getContextMetadataAndLimits
    ).toHaveBeenCalledTimes(2);
  });
});
