const fs = require("fs");
const path = require("path");
const YAML = require("yaml");
const { validateWizard } = require("../../utils/agentWizard");
jest.mock("../../utils/MCP", () => jest.fn());
const {
  validateAgentPayload,
  predefinedAgentEndpoints,
} = require("../../endpoints/predefinedAgents");
const {
  PredefinedAgent,
  normalizeAgent,
} = require("../../models/predefinedAgent");
const config = YAML.parse(
  fs.readFileSync(
    path.resolve(__dirname, "../../../agent-config/agents/3gpp-review.yaml"),
    "utf8"
  )
);

test("bundled review wizard is valid and optional", () => {
  expect(validateWizard(config.wizard)).toEqual(config.wizard);
  expect(validateWizard(undefined)).toBeNull();
  expect(validateWizard(null)).toBeNull();
});

test("admin payload preserves omission and supports explicit removal", () => {
  const base = { name: "测试助手", systemPrompt: "测试" };
  expect(validateAgentPayload(base).data).not.toHaveProperty("wizard");
  expect(
    validateAgentPayload({ ...base, wizard: null }).data.wizard
  ).toBeNull();
  expect(
    validateAgentPayload({ ...base, wizard: config.wizard }).data.wizard
  ).toEqual(config.wizard);
  expect(validateAgentPayload({ ...base, wizard: {} }).error).toBeTruthy();
});

test("normalizes stored JSON and returns the wizard in the public roster", async () => {
  const agent = normalizeAgent({
    id: 6,
    name: config.name,
    skillIds: "[]",
    wizard: JSON.stringify(config.wizard),
  });
  expect(agent.wizard).toEqual(config.wizard);
  const routes = new Map();
  const app = Object.fromEntries(
    ["get", "post", "put", "delete"].map((method) => [
      method,
      jest.fn((path, ...handlers) =>
        routes.set(`${method} ${path}`, handlers.at(-1))
      ),
    ])
  );
  predefinedAgentEndpoints(app);
  const list = jest.spyOn(PredefinedAgent, "all").mockResolvedValue([agent]);
  const defaultId = jest
    .spyOn(PredefinedAgent, "defaultId")
    .mockResolvedValue(6);
  try {
    const response = { status: jest.fn().mockReturnThis(), json: jest.fn() };
    await routes.get("get /predefined-agents")({}, response);
    expect(response.json).toHaveBeenCalledWith(
      expect.objectContaining({
        agents: [expect.objectContaining({ wizard: config.wizard })],
      })
    );
    expect(list).toHaveBeenCalledWith(
      expect.objectContaining({ enabledOnly: true })
    );
  } finally {
    list.mockRestore();
    defaultId.mockRestore();
  }
});
test.each([
  (wizard) => {
    delete wizard.fields[0].id;
  },
  (wizard) => {
    wizard.fields[0].id = "constructor";
  },
  (wizard) => {
    wizard.version = 2;
  },
  (wizard) => {
    wizard.fields[1].id = wizard.fields[0].id;
  },
  (wizard) => {
    wizard.fields[0].when = [{ field: "scope", values: ["tdocs"] }];
  },
  (wizard) => {
    wizard.fields[1].when[0].values = ["unknown"];
  },
  (wizard) => {
    wizard.fields[0].options.push(wizard.fields[0].options[0]);
  },
  (wizard) => {
    wizard.fields[0].type = "script";
  },
  (wizard) => {
    wizard.fields[0].required = "true";
  },
])("rejects invalid schemas before persistence", (mutate) => {
  const wizard = JSON.parse(JSON.stringify(config.wizard));
  mutate(wizard);
  expect(() => validateWizard(wizard)).toThrow("任务向导配置无效");
});
