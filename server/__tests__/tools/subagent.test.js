/* eslint-env jest, node */
jest.mock("../../models/agentToolExecution", () => ({
  AgentToolExecution: {
    begin: jest.fn().mockResolvedValue(null),
    findOperation: jest.fn().mockResolvedValue([]),
    finish: jest.fn().mockResolvedValue(null),
    get: jest.fn().mockResolvedValue(null),
  },
}));
jest.mock("../../resources/agents", () => ({
  resolveAgent: jest.fn(),
}));
jest.mock("../../agent-system/runtimes/invoke", () => ({
  invokeAgentRuntime: jest.fn(),
}));
jest.mock("../../agent-system/observability", () => ({
  childRunnableConfig: jest.fn((config) => config || {}),
}));

const { resolveAgent } = require("../../resources/agents");
const { invokeAgentRuntime } = require("../../agent-system/runtimes/invoke");
const { AgentToolContext } = require("../../tools/context");
const {
  createSubagentTool,
  inheritedSkillSnapshots,
} = require("../../tools/subagent");

describe("subagent Skill inheritance", () => {
  it("passes every activated Skill as a serializable child snapshot", () => {
    const context = {
      activatedSkills: () => [
        {
          id: 10,
          name: "3gpp-review",
          scope: "global",
          revision: "sha256:review",
          root: "/private/skill/package",
          allowedTools: "bash web.fetch",
          instructions: "Review TDocs.",
          files: [{ path: "scripts/3gpp_tdocs.py", text: true }],
        },
        {
          id: 11,
          name: "3gpp-position-evolution",
          scope: "global",
          revision: "sha256:evolution",
          allowedTools: "filesystem.read",
          instructions: "Trace positions.",
          files: [],
        },
      ],
    };

    const inherited = inheritedSkillSnapshots(context);
    expect(inherited.map((skill) => skill.name)).toEqual([
      "3gpp-review",
      "3gpp-position-evolution",
    ]);
    expect(inherited[0]).toMatchObject({
      revision: "sha256:review",
      skillRoot: "skill://3gpp-review",
      instructions: "Review TDocs.",
    });
    expect(inherited[0]).not.toHaveProperty("root");
  });
});

describe("subagent action serialization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("lets a child write acquire the shared action lock", async () => {
    const context = new AgentToolContext({
      run: { id: "run-1", configuration: {} },
      workspace: { id: 1 },
      user: { id: 1 },
      agent: { id: 1 },
      emit: jest.fn().mockResolvedValue(null),
      signal: new AbortController().signal,
    });
    const runAction = jest.spyOn(context, "runAction");
    resolveAgent.mockResolvedValue({ id: 2, name: "Writer" });
    invokeAgentRuntime.mockImplementation(async () => {
      await context.runAction(async () => "child write completed");
      return { kind: "completed", text: "child completed" };
    });

    const subagent = createSubagentTool(context, [
      { id: 2, name: "Writer", description: "Writes an artifact." },
    ]);
    const result = await Promise.race([
      subagent.invoke({ agent_id: 2, task: "Write the artifact." }),
      new Promise((_, reject) =>
        setTimeout(
          () => reject(new Error("Nested child write deadlocked.")),
          250
        )
      ),
    ]);

    expect(JSON.parse(result)).toMatchObject({
      ok: true,
      data: "child completed",
    });
    expect(runAction).toHaveBeenCalledTimes(1);
    expect(invokeAgentRuntime).toHaveBeenCalledTimes(1);
  });
});
