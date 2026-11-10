/* eslint-env jest, node */
jest.mock("../../models/agentToolExecution", () => ({
  AgentToolExecution: {
    get: jest.fn().mockResolvedValue(null),
    findOperation: jest.fn().mockResolvedValue([]),
    begin: jest.fn(),
    finish: jest.fn(),
  },
}));
jest.mock("../../agent-system/artifactRegistration", () => ({
  registerToolArtifacts: jest.fn(),
}));
const { z } = require("zod");
const { defineTool, toLangChainTool } = require("../../tools/descriptor");
const { AgentToolContext } = require("../../tools/context");
const {
  registerToolArtifacts,
} = require("../../agent-system/artifactRegistration");
const { AgentToolExecution } = require("../../models/agentToolExecution");

beforeEach(() => jest.clearAllMocks());
function wrapped(execute) {
  return toLangChainTool(
    defineTool({
      id: "3gpp.download",
      description: "Download test",
      schema: z.object({}),
      execute,
      maxResultBytes: 100,
    }),
    new AgentToolContext({
      run: { id: "r", configuration: {} },
      workspace: { id: 1, slug: "demo" },
      emit: jest.fn(),
      signal: new AbortController().signal,
    })
  );
}
it("registers complete tool data before shortening the model result", async () => {
  let observed;
  registerToolArtifacts.mockImplementation(async ({ result }) => {
    observed = JSON.parse(JSON.stringify(result.data));
    result.artifactIds = ["artifact-1"];
  });
  const data = {
    outputs: [
      {
        directory: "/workspace/results/batch",
        files: Array(20).fill({ docx: "/workspace/results/batch/a.docx" }),
      },
    ],
  };
  const value = JSON.parse(
    await wrapped(async () => ({
      ok: true,
      code: "OK",
      summary: "Downloaded",
      data,
    })).func({}, undefined, { toolCall: { id: "one" } })
  );
  expect(observed).toEqual(data);
  expect(value.artifactIds).toEqual(["artifact-1"]);
  expect(typeof value.data).toBe("string");
  expect(AgentToolExecution.finish).toHaveBeenCalledWith(
    "r",
    "one",
    expect.objectContaining({ artifactIds: ["artifact-1"] })
  );
});
it("does not rerun or fail a successful action when attachment registration fails", async () => {
  const warning = jest.spyOn(console, "warn").mockImplementation(() => {});
  registerToolArtifacts.mockRejectedValue(
    new Error("temporary persistence failure")
  );
  const execute = jest.fn(async () => ({
    ok: true,
    code: "OK",
    summary: "Saved",
  }));
  try {
    expect(
      JSON.parse(
        await wrapped(execute).func({}, undefined, { toolCall: { id: "two" } })
      ).ok
    ).toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  } finally {
    warning.mockRestore();
  }
});
