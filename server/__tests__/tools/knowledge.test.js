/* eslint-env jest, node */
const mockManager = {
  validatePath: jest.fn(),
  getAllowedDirectories: jest.fn(() => ["/storage/workspace-2"]),
};

jest.mock("../../models/agentToolExecution", () => ({
  AgentToolExecution: {},
}));

jest.mock("fs/promises", () => ({
  stat: jest.fn(),
  readFile: jest.fn(),
  mkdir: jest.fn(),
  writeFile: jest.fn(),
  rename: jest.fn(),
}));
jest.mock("../../utils/agents/aibitat/plugins/filesystem/lib", () => ({
  forWorkspace: jest.fn(() => mockManager),
}));
jest.mock("../../models/documents", () => ({
  Document: { get: jest.fn(), addDocuments: jest.fn() },
}));
jest.mock("../../models/agentReportPublication", () => ({
  AgentReportPublication: {
    get: jest.fn(),
    begin: jest.fn(),
    complete: jest.fn(),
    fail: jest.fn(),
    forRun: jest.fn(),
  },
}));
jest.mock("../../utils/files", () => ({
  documentsPath: "/storage/documents",
}));
jest.mock("../../utils/helpers/chat/LLMPerformanceMonitor", () => ({
  LLMPerformanceMonitor: { countTokens: jest.fn(() => 100) },
}));

const fs = require("fs/promises");
const { Document } = require("../../models/documents");
const {
  AgentReportPublication,
} = require("../../models/agentReportPublication");
const { publishReport } = require("../../tools/knowledge");

function context() {
  return {
    workspace: { id: 2, slug: "3gpp", name: "3GPP" },
    run: { id: "run-publish" },
    agent: { id: 7, name: "3GPP 提案分析助手（Skill）" },
    user: { id: 1 },
    emit: jest.fn(),
  };
}

const args = {
  path: "3gpp-review/reports/SA2-175/KI22/report.md",
  title: "SA2#175 KI#22 提案分析",
  meeting: "SA2#175",
  ki: "KI#22",
  tdocIds: ["S2-2606085"],
};

describe("knowledge.publish", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockManager.validatePath.mockResolvedValue(
      "/storage/workspace-2/3gpp-review/reports/SA2-175/KI22/report.md"
    );
    fs.stat.mockResolvedValue({ isFile: () => true, size: 2048 });
    fs.readFile.mockResolvedValue("# Report\n\nS2-2606085 evidence.");
    AgentReportPublication.get.mockResolvedValue(null);
    AgentReportPublication.forRun.mockResolvedValue([]);
    AgentReportPublication.begin.mockImplementation(async (value) => ({
      ...value,
      status: "publishing",
    }));
    AgentReportPublication.complete.mockImplementation(async (id, value) => ({
      id,
      run_id: "run-publish",
      sourcePath: args.path,
      title: args.title,
      status: "published",
      ...value,
    }));
    AgentReportPublication.fail.mockResolvedValue({ status: "failed" });
    Document.get.mockResolvedValueOnce(null).mockResolvedValueOnce({ id: 42 });
    Document.addDocuments.mockResolvedValue({
      failedToEmbed: [],
      errors: [],
      embedded: ["agent-reports/3gpp/run-publish/report.json"],
    });
  });

  it("embeds a report and returns a workspace download output", async () => {
    const ctx = context();
    const result = await publishReport.execute(args, ctx);

    expect(result).toMatchObject({
      ok: true,
      code: "REPORT_PUBLISHED",
      data: {
        output: {
          type: "workspaceFile",
          payload: { workspaceSlug: "3gpp", path: args.path },
        },
      },
    });
    expect(Document.addDocuments).toHaveBeenCalledWith(
      ctx.workspace,
      ["agent-reports/3gpp/run-publish/report.json"],
      1
    );
    const writtenDocument = JSON.parse(fs.writeFile.mock.calls[0][1]);
    expect(typeof writtenDocument.agentPublication).toBe("string");
    expect(JSON.parse(writtenDocument.agentPublication)).toMatchObject({
      meeting: "SA2#175",
      ki: "KI#22",
      tdocIds: ["S2-2606085"],
      runId: "run-publish",
      agentId: 7,
    });
    expect(ctx.emit).toHaveBeenCalledWith(
      "knowledge.published",
      expect.objectContaining({ documentId: 42, tdocCount: 1 })
    );
  });

  it("is idempotent for an already published identical report", async () => {
    const crypto = require("crypto");
    const content = "# Report\n\nS2-2606085 evidence.";
    AgentReportPublication.get.mockResolvedValue({
      id: "publication-1",
      status: "published",
      sourcePath: args.path,
      title: args.title,
      contentHash: crypto.createHash("sha256").update(content).digest("hex"),
    });
    const result = await publishReport.execute(args, context());
    expect(result.code).toBe("ALREADY_PUBLISHED");
    expect(Document.addDocuments).not.toHaveBeenCalled();
  });

  it("rejects changed content at an immutable published path", async () => {
    AgentReportPublication.get.mockResolvedValue({
      id: "publication-1",
      status: "published",
      sourcePath: args.path,
      title: args.title,
      contentHash: "different",
    });
    const result = await publishReport.execute(args, context());
    expect(result).toMatchObject({
      ok: false,
      code: "PUBLISHED_REPORT_CHANGED",
    });
  });

  it("blocks repeated publication attempts when the embedding model is unavailable", async () => {
    Document.addDocuments.mockRejectedValue(new Error("fetch failed"));

    const result = await publishReport.execute(args, context());

    expect(result).toMatchObject({
      ok: false,
      code: "EMBEDDING_MODEL_UNAVAILABLE",
      retryable: false,
      blocksCapability: true,
      data: { cause: "fetch failed" },
    });
    expect(AgentReportPublication.fail).toHaveBeenCalledWith(
      expect.any(String),
      "fetch failed"
    );
  });

  it("prevents a second final report path in the same run", async () => {
    AgentReportPublication.forRun.mockResolvedValue([
      {
        id: "publication-canonical",
        sourcePath: "reports/canonical.md",
        status: "published",
      },
    ]);

    const result = await publishReport.execute(args, context());

    expect(result).toMatchObject({
      ok: false,
      code: "RUN_REPORT_ALREADY_PUBLISHED",
      data: {
        publication: { sourcePath: "reports/canonical.md" },
      },
    });
    expect(AgentReportPublication.begin).not.toHaveBeenCalled();
  });

  it("binds publication to an exact filter-index manifest and coverage receipt", async () => {
    const crypto = require("crypto");
    const manifestPath = "work/proposals.json";
    const receiptPath = "work/coverage.json";
    const manifest = JSON.stringify({
      schema: "3gpp-review-manifest/v1",
      count: 1,
      proposals: [
        {
          document: "S2-2606085",
          agenda: "20.6.22",
          title: "Coordination",
          source: "Huawei",
          status: "available",
        },
      ],
    });
    const receipt = JSON.stringify({
      schema: "3gpp-review-coverage/v1",
      status: "passed",
      manifestSha256: crypto
        .createHash("sha256")
        .update(manifest)
        .digest("hex"),
      expectedDocuments: ["S2-2606085"],
      extractedDocuments: ["S2-2606085"],
      missing: [],
      extra: [],
      validatedAt: "2026-08-28T00:00:00Z",
    });
    mockManager.validatePath.mockImplementation(
      async (requested) => `/storage/workspace-2/${requested}`
    );
    fs.readFile.mockImplementation(async (target) => {
      if (target.endsWith("proposals.json")) return manifest;
      if (target.endsWith("coverage.json")) return receipt;
      return "# Report\n\nS2-2606085 evidence.";
    });

    const result = await publishReport.execute(
      { ...args, manifestPath, coverageReceiptPath: receiptPath },
      {
        ...context(),
        run: {
          id: "run-publish",
          runtimeSnapshot: {
            runtimeConfig: { publicationRequiresCoverage: true },
          },
        },
      }
    );

    expect(result.code).toBe("REPORT_PUBLISHED");
    expect(AgentReportPublication.begin).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          coverage: expect.objectContaining({
            manifestPath,
            coverageReceiptPath: receiptPath,
          }),
        }),
      })
    );
  });

  it("rejects a publication TDoc list that differs from the manifest", async () => {
    const manifest = JSON.stringify({
      schema: "3gpp-review-manifest/v1",
      count: 1,
      proposals: [
        {
          document: "S2-2606085",
          agenda: "20.6.22",
          title: "Coordination",
          source: "Huawei",
          status: "available",
        },
      ],
    });
    mockManager.validatePath.mockImplementation(
      async (requested) => `/storage/workspace-2/${requested}`
    );
    fs.readFile.mockImplementation(async (target) => {
      if (target.endsWith("proposals.json")) return manifest;
      if (target.endsWith("coverage.json")) return "{}";
      return "# Report";
    });

    const result = await publishReport.execute(
      {
        ...args,
        tdocIds: ["S2-2606481"],
        manifestPath: "work/proposals.json",
        coverageReceiptPath: "work/coverage.json",
      },
      {
        ...context(),
        run: {
          id: "run-publish",
          runtimeSnapshot: {
            runtimeConfig: { publicationRequiresCoverage: true },
          },
        },
      }
    );

    expect(result).toMatchObject({ ok: false, code: "TDOC_SET_MISMATCH" });
    expect(AgentReportPublication.begin).not.toHaveBeenCalled();
  });
});
