jest.mock("../../models/systemSettings", () => ({
  SystemSettings: {
    getValueOrFallback: jest.fn(),
  },
}));
jest.mock("../../models/systemPromptVariables", () => ({
  SystemPromptVariables: {
    expandSystemPromptVariables: jest.fn(),
  },
}));

const { SystemSettings } = require("../../models/systemSettings");
const { SystemPromptVariables } = require("../../models/systemPromptVariables");
const { composeSystemPrompt } = require("../../utils/systemPrompt");

describe("composeSystemPrompt", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    SystemPromptVariables.expandSystemPromptVariables.mockImplementation(
      async (prompt) => prompt
    );
  });

  it("preserves the base prompt when no additional layers are configured", async () => {
    SystemSettings.getValueOrFallback.mockResolvedValue("");
    const result = await composeSystemPrompt({
      basePrompt: "Base instructions",
      user: { id: 7, systemPrompt: "" },
      workspace: { id: 3 },
    });

    expect(result).toBe("Base instructions");
    expect(
      SystemPromptVariables.expandSystemPromptVariables
    ).toHaveBeenCalledWith("Base instructions", 7, 3);
  });

  it("combines global, Agent, and user prompts in precedence order", async () => {
    SystemSettings.getValueOrFallback.mockResolvedValue("Global instructions");
    const result = await composeSystemPrompt({
      basePrompt: "Agent instructions",
      user: { id: 7, systemPrompt: "User instructions" },
      workspace: { id: 3 },
    });

    expect(result).toContain("<global_system_prompt>\nGlobal instructions");
    expect(result).toContain("<agent_system_prompt>\nAgent instructions");
    expect(result).toContain("<user_system_prompt>\nUser instructions");
    expect(result.indexOf("Global instructions")).toBeLessThan(
      result.indexOf("Agent instructions")
    );
    expect(result.indexOf("Agent instructions")).toBeLessThan(
      result.indexOf("User instructions")
    );
  });
});
