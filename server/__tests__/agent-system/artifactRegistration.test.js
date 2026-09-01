/* eslint-env jest, node */
const mockArtifact = {
  forRun: jest.fn(),
  create: jest.fn(),
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
} = require("../../agent-system/artifactRegistration");

describe("Agent artifact registration", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockArtifact.forRun.mockResolvedValue([]);
    mockArtifact.create.mockImplementation(async (artifact) => ({
      id: `artifact-${artifact.title}`,
      ...artifact,
    }));
    fs.stat.mockResolvedValue({ isFile: () => true, size: 321 });
    fs.readFile.mockResolvedValue("");
  });

  it("extracts concrete workspace paths but ignores globs", () => {
    expect(
      referencedWorkspacePaths(
        "`/workspace/results/S2 001.docx` and /workspace/results/a.json， not /workspace/results/*.docx"
      )
    ).toEqual([
      "/workspace/results/S2 001.docx",
      "/workspace/results/a.json",
    ]);
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

    expect(mockArtifact.create).toHaveBeenCalledTimes(2);
    expect(mockArtifact.create).toHaveBeenCalledWith(
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

  it("does not register outputs for a read-only run", async () => {
    await expect(
      registerReferencedArtifacts({
        runId: "run-1",
        tasks: [{ id: "read", writeIntent: false }],
        finalResponse: "/workspace/input.docx",
        workspaceManager: {},
      })
    ).resolves.toEqual([]);
    expect(mockArtifact.forRun).not.toHaveBeenCalled();
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
