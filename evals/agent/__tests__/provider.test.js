/* eslint-env jest, node */
const http = require("http");
const AnythingLLMAgentProvider = require("../providers/anythingllm-agent");
const { completionUrl } = require("../providers/current-model-judge");
const runtimeAssertion = require("../assertions/runtime");
const { generatedDocx } = require("../providers/fixtures");
const AdmZip = require("adm-zip");
const { configuredAgentNames } = require("../scripts/smoke");
const {
  reportedWorkspaceFiles,
  snapshotReportedWorkspaceFiles,
} = require("../providers/anythingllm-agent");

function listen(handler) {
  return new Promise((resolve) => {
    const server = http.createServer(handler);
    server.listen(0, "127.0.0.1", () =>
      resolve({ server, port: server.address().port })
    );
  });
}

function json(response, status, payload) {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

describe("AnythingLLM Promptfoo provider", () => {
  it("runs a live API attempt and returns structured metadata", async () => {
    const { server, port } = await listen((request, response) => {
      if (request.url === "/api/v1/agents")
        return json(response, 200, {
          agents: [{ id: 1, name: "通用助手" }],
          defaultAgentId: 1,
        });
      if (request.url === "/api/v1/workspace/new")
        return json(response, 200, {
          workspace: { id: 2, slug: "eval-workspace" },
        });
      if (request.url.includes("/thread/new"))
        return json(response, 200, { thread: { id: 3, slug: "attempt" } });
      if (request.url.includes("/agent-runs") && request.method === "POST")
        return json(response, 202, { run: { id: "run-1", status: "queued" } });
      if (request.url.includes("/snapshot"))
        return json(response, 200, {
          run: { id: "run-1", status: "completed", finalResponse: "four" },
          tasks: [],
          evidence: [],
          toolExecutions: [],
          events: [{ id: 1, type: "run.completed", payload: {} }],
          artifacts: [],
          traceId: "trace-1",
        });
      return json(response, 404, { error: "not found" });
    });
    const provider = new AnythingLLMAgentProvider({
      config: {
        baseUrl: `http://127.0.0.1:${port}/api`,
        apiKey: "test-key",
        pollIntervalMs: 1,
      },
    });

    try {
      const response = await provider.callApi("two plus two", {
        evaluationId: "eval-1",
        repeatIndex: 0,
        vars: {
          agentName: "通用助手",
          caseId: "direct-answer",
          setup: {},
        },
      });
      expect(response.error).toBeUndefined();
      expect(response.output).toBe("four");
      expect(response.metadata).toMatchObject({
        traceId: "trace-1",
        evaluation: { evaluationId: "eval-1", attempt: 1 },
        snapshot: { run: { id: "run-1", status: "completed" } },
      });
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("generates a DOCX package with a table and embedded image", async () => {
    const buffer = await generatedDocx({
      name: "test.docx",
      text: "Source: Example",
      table: [["Field", "Value"]],
    });
    const entries = new AdmZip(buffer)
      .getEntries()
      .map((entry) => entry.entryName);
    expect(entries).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "word/document.xml",
        "word/_rels/document.xml.rels",
      ])
    );
    expect(entries.some((entry) => entry.startsWith("word/media/"))).toBe(true);
  });

  it("discovers concrete workspace files reported by an Agent", () => {
    expect(
      reportedWorkspaceFiles(
        "原文：`/workspace/downloads/S2-260001.docx`。报告位于 /workspace/reports/result.md",
        {
          summary:
            "重复路径 /workspace/reports/result.md，目录模式 /workspace/downloads/*.docx",
        }
      )
    ).toEqual([
      expect.objectContaining({
        title: "S2-260001.docx",
        storagePath: "/workspace/downloads/S2-260001.docx",
      }),
      expect.objectContaining({
        title: "result.md",
        storagePath: "/workspace/reports/result.md",
      }),
    ]);
  });

  it("discovers files from API task resultSummary fields", () => {
    expect(
      snapshotReportedWorkspaceFiles({
        run: { finalResponse: "下载完成" },
        tasks: [
          {
            resultSummary:
              "原文：/workspace/3gpp-review/docs/S2-260001.docx",
          },
        ],
      })
    ).toEqual([
      expect.objectContaining({
        storagePath: "/workspace/3gpp-review/docs/S2-260001.docx",
      }),
    ]);
  });

  it("validates JSON workspace files as raw downloaded bytes", async () => {
    const { server, port } = await listen((_request, response) => {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end('{"schema":"test"}');
    });
    const provider = new AnythingLLMAgentProvider({
      config: {
        baseUrl: `http://127.0.0.1:${port}/api`,
        apiKey: "test-key",
      },
    });

    try {
      await expect(
        provider.validateArtifacts({ slug: "eval-workspace" }, [
          {
            id: "json-1",
            title: "manifest.json",
            storagePath: "/workspace/results/manifest.json",
          },
        ])
      ).resolves.toEqual([
        expect.objectContaining({
          id: "json-1",
          valid: true,
          checks: ["non-empty"],
        }),
      ]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("evaluates runtime contracts from provider metadata", () => {
    const passing = runtimeAssertion("four", {
      config: { checks: ["direct", "terminal"] },
      metadata: {
        snapshot: {
          run: { status: "completed" },
          tasks: [],
          toolExecutions: [],
        },
      },
    });
    expect(passing.pass).toBe(true);
    const failing = runtimeAssertion("", {
      config: { checks: ["skillPreplan"] },
      metadata: { snapshot: { events: [{ type: "plan.created" }] } },
    });
    expect(failing).toMatchObject({ pass: false, score: 0 });
    const observedPlanning = runtimeAssertion("plan-rerun-ok", {
      config: { checks: ["skillPreplan", "noSkillTask"] },
      metadata: {
        snapshot: { run: { status: "completed" }, events: [], tasks: [] },
        observedSnapshot: {
          events: [{ type: "skill.activated" }, { type: "plan.created" }],
          tasks: [{ id: "t1", title: "查找会议" }],
        },
      },
    });
    expect(observedPlanning.pass).toBe(true);
    const delegatedSkill = runtimeAssertion("converted", {
      config: { checks: ["subagentSkills"] },
      metadata: {
        agent: { id: 6 },
        snapshot: {
          events: [
            {
              type: "task.started",
              payload: {
                agent: { id: 8 },
                activatedSkills: [
                  { name: "3gpp-review", revision: "sha256:abc" },
                ],
              },
            },
          ],
        },
      },
    });
    expect(delegatedSkill.pass).toBe(true);

    const invalidDownloadPlan = runtimeAssertion("done", {
      config: { checks: ["writeIntent"] },
      metadata: {
        snapshot: {
          tasks: [
            {
              id: "download",
              title: "下载并提取 TDoc Word 原文",
              objective: "下载 ZIP 并保存 DOCX 文件",
              writeIntent: false,
              allowedToolIds: ["bash"],
            },
          ],
          toolExecutions: [],
          artifacts: [],
        },
      },
    });
    expect(invalidDownloadPlan.pass).toBe(false);

    const deterministicConversion = runtimeAssertion("converted", {
      config: { checks: ["skillPreplan", "writeIntent"] },
      metadata: {
        snapshot: {
          tasks: [],
          events: [
            {
              type: "request.classified",
              payload: { execution: "deterministic" },
            },
            { type: "skill.activated", payload: { name: "3gpp-review" } },
            {
              type: "tool.started",
              payload: { toolId: "3gpp.convert-markdown" },
            },
          ],
          toolExecutions: [{ tool_id: "3gpp.convert-markdown", task_id: null }],
          artifacts: [],
        },
      },
    });
    expect(deterministicConversion.pass).toBe(true);

    const publishedArtifact = runtimeAssertion("done", {
      config: { checks: ["artifacts", "portablePaths"] },
      metadata: {
        snapshot: {
          registeredOutputs: [
            {
              id: "publication:1",
              title: "report.md",
              storagePath: "reports/report.md",
            },
          ],
          artifactValidation: [
            {
              id: "publication:1",
              title: "report.md",
              valid: true,
            },
          ],
          run: { finalResponse: "Saved to /workspace/reports/report.md" },
          tasks: [],
          toolExecutions: [],
          artifacts: [],
        },
      },
    });
    expect(publishedArtifact.pass).toBe(true);

    const truncatedList = runtimeAssertion(
      "匹配 TDoc 数：47 条。第 47 条标题未返回（报告输出截断）。",
      {
        config: { checks: ["completeRequestedFields"] },
        metadata: {},
      }
    );
    expect(truncatedList).toMatchObject({ pass: false, score: 0 });

    const deferredList = runtimeAssertion(
      "共 **47 条**提案。完整 47 行清单已写入报告文件，但当前回复步骤无法读取该文件内容，以下仅列出任务结果摘要。\n| TDoc 编号 | 标题 |\n|---|---|\n| S2-2606968 | Example |",
      {
        config: { checks: ["completeRequestedFields"] },
        metadata: {},
      }
    );
    expect(deferredList).toMatchObject({ pass: false, score: 0 });
  });

  it("normalizes OpenAI-compatible judge URLs", () => {
    expect(completionUrl("http://models.example/v1/")).toBe(
      "http://models.example/v1/chat/completions"
    );
    expect(completionUrl("http://models.example/v1/chat/completions")).toBe(
      "http://models.example/v1/chat/completions"
    );
  });

  it("finds every Agent referenced by the bootstrap suite", async () => {
    await expect(
      configuredAgentNames(
        require("path").join(__dirname, "..", "promptfooconfig.bootstrap.yaml")
      )
    ).resolves.toEqual(
      expect.arrayContaining(["3GPP 提案分析助手", "3GPP 提案转 Markdown 助手"])
    );
  });
});
