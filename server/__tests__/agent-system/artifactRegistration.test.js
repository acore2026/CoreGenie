/* eslint-env jest, node */
const mockArtifact = {
  forRun: jest.fn(),
  registerWorkspaceOutput: jest.fn(),
};

jest.mock("fs/promises", () => ({ stat: jest.fn(), readFile: jest.fn() }));
jest.mock("../../models/agentRunArtifact", () => ({
  AgentRunArtifact: mockArtifact,
}));

const fs = require("fs/promises");
const {
  completeInlineDatasetResponse,
  referencedWorkspacePaths,
  registerReferencedArtifacts,
  registerWorkspaceOutputs,
  toolOutputReferences,
  collectRunOutputs,
  outputRelativePath,
} = require("../../agent-system/artifactRegistration");

describe("Agent artifact registration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockArtifact.forRun.mockResolvedValue([]);
    mockArtifact.registerWorkspaceOutput.mockImplementation(
      async (artifact) => ({
        id: `artifact-${artifact.title}`,
        ...artifact,
      })
    );
    fs.stat.mockResolvedValue({ isFile: () => true, size: 321 });
    fs.readFile.mockResolvedValue("");
  });

  it("extracts concrete workspace paths but ignores globs", () => {
    expect(
      referencedWorkspacePaths(
        "`/workspace/results/S2 001.docx` and /workspace/results/a.json， not /workspace/results/*.docx"
      )
    ).toEqual(["/workspace/results/S2 001.docx", "/workspace/results/a.json"]);
  });

  it("registers existing files explicitly reported by write tasks", async () => {
    const workspaceManager = {
      validatePath: jest.fn((relative) => `/storage/workspace-2/${relative}`),
    };
    const artifacts = await registerReferencedArtifacts({
      runId: "run-1",
      tasks: [
        {
          id: "download",
          writeIntent: true,
          resultSummary:
            "Saved /workspace/docs/S2-001.docx and /workspace/docs/S2-002.docx",
        },
        {
          id: "read",
          writeIntent: false,
          resultSummary: "Read /workspace/private/input.docx",
        },
      ],
      finalResponse: "Files are in /workspace/docs/S2-001.docx",
      workspaceManager,
    });

    expect(mockArtifact.registerWorkspaceOutput).toHaveBeenCalledTimes(2);
    expect(mockArtifact.registerWorkspaceOutput).toHaveBeenCalledWith(
      expect.objectContaining({
        runId: "run-1",
        taskId: "download",
        storagePath: "docs/S2-001.docx",
        mimeType:
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        byteSize: 321,
      })
    );
    expect(artifacts).toHaveLength(2);
  });

  it("attaches a final referenced file even without write tasks in the default runtime", async () => {
    const result = await registerReferencedArtifacts({
      runId: "run-1",
      tasks: [{ id: "read", writeIntent: false }],
      finalResponse: "/workspace/input.docx",
      workspaceManager: { validatePath: async (value) => value },
    });
    expect(result).toHaveLength(1);
    expect(result[0].storagePath).toBe("input.docx");
  });

  it("attaches batch folders as ZIP downloads and keeps images together", async () => {
    const paths = toolOutputReferences(
      "3gpp.download",
      {},
      {
        ok: false,
        data: {
          outputs: [
            {
              directory: "/workspace/3gpp/KI21",
              files: [],
              fileCount: 120,
              filesTruncated: true,
            },
          ],
        },
      }
    );
    expect(paths).toEqual(["/workspace/3gpp/KI21"]);
    const workspaceManager = { validatePath: async (value) => value };
    fs.stat.mockResolvedValue({ isFile: () => false, isDirectory: () => true });
    const artifacts = await registerWorkspaceOutputs({
      runId: "r",
      references: paths.map((storagePath) => ({ storagePath })),
      workspaceManager,
    });
    expect(artifacts[0]).toMatchObject({
      kind: "workspaceDirectory",
      title: "KI21.zip",
    });
    expect(
      await collectRunOutputs({
        workspace: { slug: "demo" },
        workspaceManager,
        artifacts,
      })
    ).toEqual([
      {
        type: "workspaceFile",
        payload: {
          workspaceSlug: "demo",
          path: "3gpp/KI21",
          filename: "KI21.zip",
          archive: true,
          artifactId: artifacts[0].id,
        },
      },
    ]);
  });

  it("captures relative writes and sandbox reported results, never read tool inputs", () => {
    expect(
      toolOutputReferences(
        "filesystem.write",
        { path: "reports/总结.md" },
        { ok: true }
      )
    ).toEqual(["reports/总结.md"]);
    expect(
      toolOutputReferences(
        "filesystem.write",
        { path: "reports/总结.md" },
        { ok: false }
      )
    ).toEqual([]);
    expect(
      toolOutputReferences(
        "bash",
        { code: "cat /workspace/input.md" },
        { data: "Saved `/workspace/results/结果 表.csv`" }
      )
    ).toEqual(["/workspace/results/结果 表.csv"]);
    expect(
      toolOutputReferences(
        "filesystem.read",
        { path: "/workspace/input.md" },
        { ok: true, data: "/workspace/input.md" }
      )
    ).toEqual([]);
  });

  it.each([
    "/workspace",
    "/workspace/",
    "../secret",
    "/workspace/../secret",
    "/workspace/_meta/tasks/a.json",
    "/workspace/.env",
    "/workspace/_tmp/a.md",
    "/workspace/tmp/script.py",
    "/workspace/proposal/S2-123.assets/embedded/ole.bin",
  ])("excludes unsafe or internal output %s", (value) => {
    expect(outputRelativePath(value)).toBeNull();
  });

  it("deduplicates repeated file appends and omits missing files", async () => {
    const existing = {
      id: "a",
      kind: "workspaceFile",
      storagePath: "result.md",
    };
    mockArtifact.forRun.mockResolvedValue([existing]);
    const result = await registerWorkspaceOutputs({
      runId: "r",
      references: [
        { storagePath: "result.md" },
        { storagePath: "/workspace/result.md" },
      ],
      workspaceManager: { validatePath: async (v) => v },
    });
    expect(result).toEqual([existing]);
    expect(mockArtifact.registerWorkspaceOutput).not.toHaveBeenCalled();
    fs.stat.mockRejectedValue({ code: "ENOENT" });
    expect(
      await collectRunOutputs({
        runId: "r",
        workspace: { slug: "demo" },
        workspaceManager: { validatePath: async (v) => v },
      })
    ).toEqual([]);
  });

  it("appends a more complete text report for an explicitly requested list", async () => {
    const report = [
      "| # | 编号 | 标题 |",
      "|---|---|---|",
      "| 1 | A | Alpha |",
      "| 2 | B | Beta |",
      "| 3 | C | Gamma |",
    ].join("\n");
    fs.stat.mockResolvedValue({ isFile: () => true, size: report.length });
    fs.readFile.mockResolvedValue(report);
    const workspaceManager = {
      validatePath: jest.fn((relative) => `/storage/workspace-2/${relative}`),
    };

    const completed = await completeInlineDatasetResponse({
      request: "列出每个文档的编号和标题",
      responseText: "已生成 3 条记录。",
      artifacts: [{ storagePath: "reports/result.md" }],
      workspaceManager,
    });

    expect(completed.addition).toContain("工作区报告中的完整清单");
    expect(completed.text).toContain("| 3 | C | Gamma |");
  });

  it("does not duplicate a report when the response already has its rows", async () => {
    const report = "| # | 编号 |\n|---|---|\n| 1 | A |";
    fs.stat.mockResolvedValue({ isFile: () => true, size: report.length });
    fs.readFile.mockResolvedValue(report);

    await expect(
      completeInlineDatasetResponse({
        request: "list each document",
        responseText: report,
        artifacts: [{ storagePath: "reports/result.md" }],
        workspaceManager: { validatePath: jest.fn((value) => value) },
      })
    ).resolves.toEqual({ text: report, addition: "" });
  });
});
