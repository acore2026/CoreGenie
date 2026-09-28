/* eslint-env jest, node */
const fs = require("fs/promises");
const path = require("path");
const filesystem = require("../../utils/agents/aibitat/plugins/filesystem/lib");
const {
  apiWorkspaceFileEndpoints,
  loadApiWorkspace,
  registerWorkspaceFileRoutes,
  safeWorkspaceEntryName,
} = require("../../endpoints/workspaceFiles");
const { Workspace } = require("../../models/workspace");

describe("developer workspace file API", () => {
  afterEach(() => jest.restoreAllMocks());

  it("registers API-key upload, file-manager, preview, download, archive, and delete routes", () => {
    const routes = [];
    const app = {
      get: jest.fn((path) => routes.push(["GET", path])),
      post: jest.fn((path) => routes.push(["POST", path])),
      patch: jest.fn((path) => routes.push(["PATCH", path])),
      delete: jest.fn((path) => routes.push(["DELETE", path])),
    };
    apiWorkspaceFileEndpoints(app);
    expect(routes).toEqual(
      expect.arrayContaining([
        ["POST", "/v1/workspace/:slug/files/upload"],
        ["GET", "/v1/workspace/:slug/files"],
        ["GET", "/v1/workspace/:slug/files/preview"],
        ["GET", "/v1/workspace/:slug/files/download"],
        ["GET", "/v1/workspace/:slug/files/archive"],
        ["PATCH", "/v1/workspace/:slug/files"],
        ["DELETE", "/v1/workspace/:slug/files"],
      ])
    );
  });

  it("loads the workspace without exposing an arbitrary filesystem root", async () => {
    jest
      .spyOn(Workspace, "get")
      .mockResolvedValue({ id: 7, slug: "eval-space" });
    const next = jest.fn();
    const response = { locals: {}, status: jest.fn() };
    await loadApiWorkspace({ params: { slug: "eval-space" } }, response, next);
    expect(response.locals.workspace).toEqual({ id: 7, slug: "eval-space" });
    expect(next).toHaveBeenCalledTimes(1);
  });

  it("accepts a plain Chinese entry name and rejects paths as names", () => {
    expect(safeWorkspaceEntryName("会议结论.md")).toBe("会议结论.md");
    expect(safeWorkspaceEntryName("../会议结论.md")).toBeNull();
    expect(safeWorkspaceEntryName("资料/会议结论.md")).toBeNull();
  });

  it("renames an entry inside the authenticated workspace root", async () => {
    const routes = new Map();
    const app = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn((route, _middleware, handler) =>
        routes.set(`PATCH ${route}`, handler)
      ),
      delete: jest.fn(),
    };
    registerWorkspaceFileRoutes(app, {
      prefix: "/workspace/:slug/files",
      middleware: [],
    });

    const root = path.resolve("/tmp/coregenie-workspace-files-test");
    const manager = {
      ensureInitialized: jest.fn(),
      getAllowedDirectories: jest.fn(() => [root]),
      validatePath: jest.fn(async (target) => path.resolve(target)),
    };
    jest.spyOn(filesystem, "forWorkspace").mockReturnValue(manager);
    jest.spyOn(fs, "access").mockRejectedValue(
      Object.assign(new Error("missing"), { code: "ENOENT" })
    );
    jest.spyOn(fs, "rename").mockResolvedValue();
    jest.spyOn(fs, "stat").mockResolvedValue({
      isDirectory: () => false,
      size: 12,
      mtime: new Date("2026-09-20T00:00:00.000Z"),
    });

    const response = mockResponse({ id: 7 });
    await routes.get("PATCH /workspace/:slug/files")(
      {
        body: { path: "研究资料/旧名称.md", name: "新名称.md" },
      },
      response
    );

    expect(fs.rename).toHaveBeenCalledWith(
      path.join(root, "研究资料/旧名称.md"),
      path.join(root, "研究资料/新名称.md")
    );
    expect(response.status).toHaveBeenCalledWith(200);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: true,
        entry: expect.objectContaining({
          name: "新名称.md",
          path: "研究资料/新名称.md",
        }),
      })
    );
  });

  it("recursively deletes a directory but never the workspace root", async () => {
    const routes = new Map();
    const app = {
      get: jest.fn(),
      post: jest.fn(),
      patch: jest.fn(),
      delete: jest.fn((route, _middleware, handler) =>
        routes.set(`DELETE ${route}`, handler)
      ),
    };
    registerWorkspaceFileRoutes(app, {
      prefix: "/workspace/:slug/files",
      middleware: [],
    });

    const root = path.resolve("/tmp/coregenie-workspace-files-test");
    const manager = {
      ensureInitialized: jest.fn(),
      getAllowedDirectories: jest.fn(() => [root]),
      validatePath: jest.fn(async (target) => path.resolve(target)),
    };
    jest.spyOn(filesystem, "forWorkspace").mockReturnValue(manager);
    jest.spyOn(fs, "lstat").mockResolvedValue({ isDirectory: () => true });
    jest.spyOn(fs, "rm").mockResolvedValue();

    const response = mockResponse({ id: 7 });
    await routes.get("DELETE /workspace/:slug/files")(
      { query: { path: "研究资料" } },
      response
    );

    expect(fs.rm).toHaveBeenCalledWith(path.join(root, "研究资料"), {
      recursive: true,
    });
    expect(response.status).toHaveBeenCalledWith(200);

    const rootResponse = mockResponse({ id: 7 });
    await routes.get("DELETE /workspace/:slug/files")(
      { query: { path: "." } },
      rootResponse
    );
    expect(rootResponse.status).toHaveBeenCalledWith(400);
    expect(fs.rm).toHaveBeenCalledTimes(1);
  });
});

function mockResponse(workspace) {
  const response = {
    locals: { workspace },
    status: jest.fn(),
    json: jest.fn(),
  };
  response.status.mockReturnValue(response);
  response.json.mockReturnValue(response);
  return response;
}
