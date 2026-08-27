jest.mock("../../../../../../utils/agents/aibitat/plugins/sandbox/lib", () => ({
  run: jest.fn(),
}));

const sandbox = require("../../../../../../utils/agents/aibitat/plugins/sandbox/lib");
const {
  bash,
} = require("../../../../../../utils/agents/aibitat/plugins/sandbox/bash");
const {
  python,
} = require("../../../../../../utils/agents/aibitat/plugins/sandbox/python");

function registeredTool(plugin, requestToolApproval) {
  let definition;
  const aibitat = {
    handlerProps: {
      invocation: {
        uuid: "ec8f330d-4d41-4f9d-ac13-d17170c2473b",
        workspace_id: 42,
      },
      log: jest.fn(),
    },
    introspect: jest.fn(),
    requestToolApproval,
    function: jest.fn((value) => {
      definition = value;
    }),
  };
  plugin.plugin().setup(aibitat);
  return { definition, aibitat };
}

describe("sandbox agent tools", () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [bash, "bash"],
    [python, "python"],
  ])(
    "registers the exact %s tool and derives workspace identity",
    async (plugin, language) => {
      const approve = jest.fn().mockResolvedValue({ approved: true });
      approve.isInteractive = true;
      sandbox.run.mockResolvedValue({
        exitCode: 0,
        stdout: "ok\n",
        stderr: "",
        timedOut: false,
        truncated: false,
      });
      const { definition } = registeredTool(plugin, approve);

      const result = await definition.handler.call(
        { ...definition, caller: "@agent" },
        { code: "print('ok')", timeout_seconds: 5 }
      );

      expect(definition.name).toBe(language);
      expect(approve).toHaveBeenCalledWith(
        expect.objectContaining({
          skillName: language,
        })
      );
      expect(sandbox.run).toHaveBeenCalledWith({
        language,
        code: "print('ok')",
        workspaceId: 42,
        invocationId: "ec8f330d-4d41-4f9d-ac13-d17170c2473b",
        timeoutSeconds: 5,
      });
      expect(result).toContain("Exit code: 0");
      expect(result).toContain("ok");
    }
  );

  it("refuses execution without an interactive approval channel", async () => {
    const { definition } = registeredTool(python, jest.fn());
    const result = await definition.handler.call(
      { ...definition, caller: "@agent" },
      { code: "print('no')" }
    );

    expect(result).toContain("requires interactive user approval");
    expect(sandbox.run).not.toHaveBeenCalled();
  });
});
