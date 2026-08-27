/* eslint-env jest, node */
const {
  compactIdentifier,
  estimateTokenUsage,
  hasReportedTokenUsage,
  langfuseConfiguration,
  maskTraceData,
  noProxyMatches,
  resolveProxyUrl,
  shouldExportLangfuseSpan,
  subagentObservationName,
  traceAttributes,
} = require("../../agent-system/observability");

describe("Langfuse Agent observability", () => {
  it("stays disabled until both credentials are configured", () => {
    expect(langfuseConfiguration({}).enabled).toBe(false);
    expect(
      langfuseConfiguration({
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      })
    ).toMatchObject({
      enabled: true,
      baseUrl: "https://cloud.langfuse.com",
      captureContent: true,
      sampleRate: 1,
      release: "anythingllm-1.15.0",
      serviceName: "anythingllm-agent-runtime",
    });
    expect(
      langfuseConfiguration({
        LANGFUSE_ENABLED: "false",
        LANGFUSE_PUBLIC_KEY: "pk",
        LANGFUSE_SECRET_KEY: "sk",
      }).enabled
    ).toBe(false);
  });

  it("uses the explicit proxy and honors NO_PROXY", () => {
    const baseUrl = "https://jp.cloud.langfuse.com";
    expect(
      resolveProxyUrl(baseUrl, {
        LANGFUSE_PROXY_URL: "http://proxy:7890",
        HTTPS_PROXY: "http://fallback:7890",
      })
    ).toBe("http://proxy:7890");
    expect(
      resolveProxyUrl(baseUrl, {
        LANGFUSE_PROXY_URL: "http://proxy:7890",
        NO_PROXY: ".cloud.langfuse.com",
      })
    ).toBeNull();
    expect(
      noProxyMatches(
        "http://host.docker.internal:3000",
        "localhost,host.docker.internal"
      )
    ).toBe(true);
  });

  it("redacts content while retaining useful structural metadata", () => {
    const payload = JSON.stringify({
      runId: "run-1",
      model: "glm-5.2",
      prompt: "confidential prompt",
      messages: [{ role: "user", content: "private text" }],
      image: "data:image/png;base64,private",
    });
    const masked = JSON.parse(
      maskTraceData(payload, { captureContent: false })
    );
    expect(masked.runId).toBe("run-1");
    expect(masked.model).toBe("glm-5.2");
    expect(masked.prompt).toBe("[REDACTED]");
    expect(masked.messages[0]).toEqual({
      role: "user",
      content: "[REDACTED]",
    });
    expect(masked.image).toBe("[MEDIA OMITTED]");
  });

  it("correlates resume segments and keeps identifiers within Langfuse limits", () => {
    const run = {
      id: "run-1",
      workspace_id: 2,
      thread_id: 3,
      user_id: 4,
      mode: "automatic",
      source: "workspace",
      runtimeKey: "evidence-research",
      runtimeVersion: 1,
      configuration: { resume: { answers: [] }, approvalMode: "always_allow" },
    };
    expect(traceAttributes(run)).toMatchObject({
      userId: "user:4",
      segment: "resume",
      metadata: {
        runId: "run-1",
        workspaceId: "2",
        threadId: "3",
        runtimeKey: "evidence-research",
        runtimeVersion: "1",
      },
      version: "evidence-research@1",
    });
    expect(compactIdentifier("x".repeat(500), "session")).toMatch(
      /^session:sha256:[a-f0-9]{64}$/
    );
  });

  it("preserves provider usage and estimates it only when absent", () => {
    const reported = {
      llmOutput: { tokenUsage: { promptTokens: 3, completionTokens: 2 } },
    };
    expect(hasReportedTokenUsage(reported)).toBe(true);
    expect(hasReportedTokenUsage({ generations: [] })).toBe(false);
    expect(
      estimateTokenUsage(["A short prompt"], {
        generations: [[{ text: "A short response" }]],
      })
    ).toMatchObject({
      promptTokens: expect.any(Number),
      completionTokens: expect.any(Number),
      totalTokens: expect.any(Number),
    });
  });

  it("uses a stable, distinct Agent observation name for subagent dispatch", () => {
    expect(subagentObservationName('{"agent_id":42,"task":"research"}')).toBe(
      "subagent-42"
    );
    expect(subagentObservationName("not-json")).toBe("subagent");
  });

  it("filters LangGraph bookkeeping while retaining meaningful spans", () => {
    const defaultFilter = jest.fn(() => true);
    expect(
      shouldExportLangfuseSpan(
        { name: "ToolCallLimitMiddleware.after_model" },
        defaultFilter
      )
    ).toBe(false);
    expect(defaultFilter).not.toHaveBeenCalled();
    expect(
      shouldExportLangfuseSpan({ name: "model_request" }, defaultFilter)
    ).toBe(true);
  });
});
