/* eslint-env jest, node */
const {
  apiWorkspaceFileEndpoints,
  loadApiWorkspace,
} = require("../../endpoints/workspaceFiles");
const { Workspace } = require("../../models/workspace");

describe("developer workspace file API", () => {
  afterEach(() => jest.restoreAllMocks());

  it("registers API-key upload, file-manager, preview, download, archive, and delete routes", () => {
    const routes = [];
    const app = {
      get: jest.fn((path) => routes.push(["GET", path])),
      post: jest.fn((path) => routes.push(["POST", path])),
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
});
