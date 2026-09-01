/* eslint-env jest, node */
const { traceAttributes } = require("../../agent-system/observability");

describe("evaluation trace correlation", () => {
  it("adds Promptfoo correlation fields without changing the trace identity", () => {
    const attributes = traceAttributes({
      id: "run-1",
      workspace_id: 2,
      thread_id: 3,
      user_id: null,
      agent_id: 4,
      mode: "automatic",
      source: "evaluation",
      runtimeKey: "governed-agent",
      runtimeVersion: 1,
      runtimeSnapshot: {},
      configuration: {
        approvalMode: "always_allow",
        evaluation: {
          evaluationId: "eval-1",
          suiteId: "runtime-v0",
          caseId: "skill-before-plan",
          attempt: 3,
        },
      },
    });

    expect(attributes.tags).toEqual(
      expect.arrayContaining(["source:evaluation", "evaluation"])
    );
    expect(attributes.metadata).toMatchObject({
      evaluationId: "eval-1",
      evaluationSuiteId: "runtime-v0",
      evaluationCaseId: "skill-before-plan",
      evaluationAttempt: "3",
    });
  });
});
