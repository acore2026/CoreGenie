/* eslint-env jest, node */
const {
  createResearchGraph,
  evidenceSchema,
  mergeEvidence,
  normalizeEvidence,
  parseJsonObject,
  requestDisablesTools,
  sourceFromEvidence,
} = require("../../agent-system/runtimes/evidenceResearch");

describe("Evidence Research runtime", () => {
  it("repairs fenced structured output and normalizes stable evidence", () => {
    expect(parseJsonObject('```json\n{"summary":"ok",}\n```')).toEqual({
      summary: "ok",
    });
    const [evidence] = normalizeEvidence(
      [
        {
          kind: "web",
          title: "Primary source",
          uri: "https://example.com/source",
          excerpt: "Supported fact",
          metadata: { published: "2026-08-27" },
        },
      ],
      { id: "standards" }
    );
    expect(evidence.id).toMatch(/^evidence:/);
    expect(evidence.workstreamId).toBe("standards");
    expect(sourceFromEvidence(evidence, 0)).toMatchObject({
      id: evidence.id,
      url: "https://example.com/source",
      title: "Primary source",
      docSource: "web",
    });
    expect(mergeEvidence([evidence], [evidence])).toHaveLength(1);
  });

  it("accepts supplied evidence and enforces explicit no-tool requests", () => {
    expect(
      evidenceSchema.parse({
        kind: "user",
        title: "Evidence C",
        uri: null,
        excerpt: "A fact supplied by the user.",
        metadata: { label: "C" },
      })
    ).toMatchObject({ kind: "user", uri: null });
    expect(
      requestDisablesTools(
        "Use only this supplied evidence; do not call external tools."
      )
    ).toBe(true);
    expect(requestDisablesTools("不要使用外部工具，只用给定证据。")).toBe(true);
    expect(requestDisablesTools("Research this with primary sources.")).toBe(
      false
    );
  });

  it("compiles a raw StateGraph with the planned research stages", () => {
    const graph = createResearchGraph({
      run: {
        id: "compile-test",
        mode: "automatic",
        configuration: { approvalMode: "always_allow" },
        runtimeSnapshot: {
          systemPrompt: "Test prompt",
          selectedModel: "test-model",
          roleModels: {},
        },
        checkpointThreadId: "custom:1:compile-test",
      },
      workspace: { id: 1 },
      user: null,
      agent: {
        id: 1,
        name: "Test Agent",
        systemPrompt: "Test prompt",
        tools: [],
        skills: [],
      },
      emit: async () => null,
      signal: new AbortController().signal,
      runnableConfig: {},
      onToken: async () => null,
    });
    expect(Object.keys(graph.getGraph().nodes)).toEqual(
      expect.arrayContaining([
        "plan_research",
        "research_worker",
        "aggregate_evidence",
        "review_evidence",
        "request_input",
        "revise_plan",
        "synthesize",
      ])
    );
  });
});
