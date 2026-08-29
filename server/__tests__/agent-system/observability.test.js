/* eslint-env jest, node */
const {
  compactAgentToolOutput,
  compactIdentifier,
  estimateTokenUsage,
  ensureLangfuseResponseModel,
  hasReportedTokenUsage,
  langfuseConfiguration,
  maskTraceData,
  noProxyMatches,
  resolveProxyUrl,
  shouldExportLangfuseSpan,
  subagentObservationName,
  traceAttributes,
  withAgentToolTrace,
  withLangfuseModel,
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

  it("marks 3GPP Skill runs with stable feature tags and revision metadata", () => {
    const attributes = traceAttributes({
      id: "run-3gpp",
      workspace_id: 2,
      thread_id: 3,
      user_id: 4,
      mode: "automatic",
      source: "workspace",
      runtimeKey: "governed-agent",
      runtimeVersion: 1,
      configuration: {},
      runtimeSnapshot: {
        agent: {
          skills: [{ name: "3gpp-review", revision: "sha256:abc" }],
        },
      },
    });
    expect(attributes.tags).toEqual(
      expect.arrayContaining(["feature:3gpp-review", "skill:3gpp-review"])
    );
    expect(attributes.metadata.skillRevisions).toEqual([
      { name: "3gpp-review", revision: "sha256:abc" },
    ]);
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

  it("promotes custom-provider model metadata to the first-class model field", () => {
    expect(withLangfuseModel(undefined, { ls_model_name: "glm-5.2" })).toEqual({
      invocation_params: { model: "glm-5.2" },
    });
    expect(
      withLangfuseModel(undefined, undefined, {
        kwargs: { model: "serialized-model" },
      })
    ).toEqual({ invocation_params: { model: "serialized-model" } });
    expect(
      withLangfuseModel(undefined, undefined, null, "fallback-model")
    ).toEqual({ invocation_params: { model: "fallback-model" } });
    expect(
      withLangfuseModel(
        { invocation_params: { model: "configured-model", temperature: 0 } },
        { ls_model_name: "metadata-model" }
      )
    ).toEqual({
      invocation_params: { model: "configured-model", temperature: 0 },
    });
    const output = {
      generations: [[{ message: { response_metadata: {} } }]],
    };
    expect(ensureLangfuseResponseModel(output, "glm-5.2")).toBe(output);
    expect(output.generations[0][0].message.response_metadata.model_name).toBe(
      "glm-5.2"
    );
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
        { name: "ModelCallLimitMiddleware.before_model" },
        defaultFilter
      )
    ).toBe(false);
    expect(defaultFilter).not.toHaveBeenCalled();
    expect(
      shouldExportLangfuseSpan({ name: "model_request" }, defaultFilter)
    ).toBe(true);
  });

  it("keeps tool execution working when Langfuse is disabled", async () => {
    await expect(
      withAgentToolTrace(
        "convert-3gpp-markdown",
        { input: { tdoc: "S2-2606085" } },
        async () => ({ ok: true, code: "TDOC_CONVERTED" })
      )
    ).resolves.toEqual({ ok: true, code: "TDOC_CONVERTED" });
  });

  it("keeps direct tool traces concise", () => {
    expect(
      compactAgentToolOutput({
        ok: true,
        code: "SKILL_ACTIVATED",
        summary: "Activated 3gpp-review.",
        data: {
          name: "3gpp-review",
          revision: "revision-1",
          instructions: "long instructions should not enter the trace",
          files: [{ path: "SKILL.md" }],
        },
        artifactIds: [],
      })
    ).toEqual({
      ok: true,
      code: "SKILL_ACTIVATED",
      summary: "Activated 3gpp-review.",
      data: { name: "3gpp-review", revision: "revision-1" },
    });
  });
});
