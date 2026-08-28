const fs = require("fs/promises");
const os = require("os");
const path = require("path");

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
const {
  MAX_WORKSPACE_AGENT_BYTES,
  workspaceFilesystemRoot,
} = require("../../utils/workspaceAgentInstructions");

describe("composeSystemPrompt", () => {
  let storageRoot;
  let previousStorageDir;

  beforeEach(() => {
    jest.clearAllMocks();
    previousStorageDir = process.env.STORAGE_DIR;
    SystemPromptVariables.expandSystemPromptVariables.mockImplementation(
      async (prompt) => prompt
    );
  });

  afterEach(async () => {
    if (previousStorageDir === undefined) delete process.env.STORAGE_DIR;
    else process.env.STORAGE_DIR = previousStorageDir;
    if (storageRoot)
      await fs.rm(storageRoot, { recursive: true, force: true });
    storageRoot = null;
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

  it("injects workspace agent.md between Agent and user instructions", async () => {
    storageRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "anythingllm-agent-md-")
    );
    process.env.STORAGE_DIR = storageRoot;
    const workspaceRoot = workspaceFilesystemRoot(3);
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, "agent.md"),
      "Always run the workspace tests.",
      "utf8"
    );
    SystemSettings.getValueOrFallback.mockResolvedValue("");

    const result = await composeSystemPrompt({
      basePrompt: "Agent instructions",
      user: { id: 7, systemPrompt: "User instructions" },
      workspace: { id: 3 },
    });

    expect(result).toContain(
      "<workspace_agent_md>\nAlways run the workspace tests.\n</workspace_agent_md>"
    );
    expect(result.indexOf("Agent instructions")).toBeLessThan(
      result.indexOf("Always run the workspace tests.")
    );
    expect(result.indexOf("Always run the workspace tests.")).toBeLessThan(
      result.indexOf("User instructions")
    );
  });

  it("caps workspace agent.md before adding it to the prompt", async () => {
    storageRoot = await fs.mkdtemp(
      path.join(os.tmpdir(), "anythingllm-agent-md-")
    );
    process.env.STORAGE_DIR = storageRoot;
    const workspaceRoot = workspaceFilesystemRoot(3);
    await fs.mkdir(workspaceRoot, { recursive: true });
    await fs.writeFile(
      path.join(workspaceRoot, "agent.md"),
      "x".repeat(MAX_WORKSPACE_AGENT_BYTES + 100),
      "utf8"
    );
    SystemSettings.getValueOrFallback.mockResolvedValue("");

    const result = await composeSystemPrompt({
      basePrompt: "Agent instructions",
      workspace: { id: 3 },
    });

    expect(result).toContain(
      `[agent.md truncated at ${MAX_WORKSPACE_AGENT_BYTES} bytes]`
    );
    expect(result).not.toContain("x".repeat(MAX_WORKSPACE_AGENT_BYTES + 1));
  });
});
