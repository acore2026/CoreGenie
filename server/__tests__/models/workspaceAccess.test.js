/* eslint-env jest, node */
const mockWorkspaceUserGet = jest.fn();

jest.mock("../../models/workspaceUsers", () => ({
  WorkspaceUser: {
    get: (...args) => mockWorkspaceUserGet(...args),
  },
}));

const { Workspace } = require("../../models/workspace");

describe("workspace access modes", () => {
  beforeEach(() => jest.clearAllMocks());
  afterEach(() => jest.restoreAllMocks());

  it("keeps explicit members collaborative in a read-only public workspace", async () => {
    mockWorkspaceUserGet.mockResolvedValue({ user_id: 4, workspace_id: 8 });

    await expect(
      Workspace.accessForUser(
        { id: 4, role: "default" },
        { id: 8, accessMode: "public_readonly" }
      )
    ).resolves.toBe("member");
  });

  it.each([
    ["public_readonly", "public_readonly"],
    ["public_collaborative", "public_collaborator"],
    ["private", null],
  ])("maps %s for a non-member", async (accessMode, expected) => {
    mockWorkspaceUserGet.mockResolvedValue(null);

    await expect(
      Workspace.accessForUser(
        { id: 4, role: "default" },
        { id: 8, accessMode }
      )
    ).resolves.toBe(expected);
  });

  it("does not expose workspace document metadata to a read-only visitor", async () => {
    jest.spyOn(Workspace, "get").mockResolvedValue({
      id: 8,
      accessMode: "public_readonly",
      documents: [{ id: 1, filename: "internal.docx" }],
      currentContextTokenCount: 200,
    });
    mockWorkspaceUserGet.mockResolvedValue(null);

    const workspace = await Workspace.getAccessibleWithUser(
      { id: 4, role: "default" },
      { id: 8 }
    );

    expect(workspace).toMatchObject({
      documents: [],
      currentContextTokenCount: 0,
      viewerAccess: "public_readonly",
    });
  });
});
