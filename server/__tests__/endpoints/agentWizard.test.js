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

config.wizard = config.quickTasks.map((key) =>
  YAML.parse(
    fs.readFileSync(
      path.resolve(__dirname, `../../../agent-config/quick-tasks/${key}.yaml`),
      "utf8"
    )
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
    wizard.fields[1].when = [{ field: "group", values: ["unknown"] }];
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
  const wizard = JSON.parse(JSON.stringify(config.wizard[0]));
  mutate(wizard);
  expect(() => validateWizard(wizard)).toThrow("快捷任务配置无效");
});

test("supports legacy single forms and multiple tasks with unique stable ids", () => {
  expect(validateWizard(config.wizard[0])).toEqual(config.wizard[0]);
  expect(() => validateWizard([config.wizard[0], config.wizard[0]])).toThrow(
    "不重复"
  );
  expect(() =>
    validateWizard([{ ...config.wizard[0], id: undefined }])
  ).toThrow();
  expect(validateWizard([])).toEqual([]);
});

test("catalog fields require a supported group and earlier meeting dependency", () => {
  const wizard = JSON.parse(JSON.stringify(config.wizard[0]));
  wizard.fields.push({
    id: "old_agenda",
    label: "旧议程题型",
    type: "agenda",
    groupField: "group",
    meetingField: "missing",
  });
  expect(() => validateWizard(wizard)).toThrow();
});

test("KI options match the pinned official reports, never synthesized directions", () => {
  const catalog = require("../../../agent-config/references/3gpp-official-ki.json");
  const { GROUPS } = require("../../utils/threeGppCatalog");
  expect(catalog.studies.map((s) => s.entries.length)).toEqual([
    24, 34, 12, 7, 3, 45,
  ]);
  for (const task of config.wizard) {
    expect(task.fields.some((f) => f.type === "agenda")).toBe(false);
    expect(task.fields.find((f) => f.id === "meeting").type).toBe("meeting");
    for (const study of catalog.studies) {
      const fields = task.fields.filter(
        (f) =>
          f.id.startsWith("ki_" + study.group.toLowerCase() + "_") &&
          f.label.includes(`TR ${study.spec} V${study.version}`)
      );
      expect(fields.flatMap((f) => f.options)).toEqual(
        study.entries.map((e) => ({
          value: e.id,
          label: `KI#${e.number} · ${e.title}（§${e.clause}）`,
          description: e.description,
        }))
      );
      expect(study.source).toMatch(
        /^https:\/\/www\.3gpp\.org\/ftp\/Specs\/archive\//
      );
      expect(new Set(study.entries.map((e) => e.id)).size).toBe(
        study.entries.length
      );
      for (const field of fields) {
        expect(field.when).toEqual([{ field: "group", values: [study.group] }]);
        expect(field.label).toContain(`TR ${study.spec} V${study.version}`);
        expect(field).not.toHaveProperty("meetingField");
        expect(field.options.every((o) => /^KI#\d/.test(o.label))).toBe(true);
      }
    }
    const unsupported = GROUPS.filter(
      (g) => !catalog.studies.some((s) => s.group === g)
    );
    const manual = task.fields.find((f) => f.id === "ki_manual");
    expect(manual.type).toBe("text");
    expect(manual.when[0].values).toEqual(unsupported);
    expect(manual.options).toBeUndefined();
    expect(task.instructions).toContain("不得跨项目套用编号");
    expect(task.instructions).not.toContain("不是官方 KI 编号");
    const groupField = task.fields.find((f) => f.id === "group");
    expect(groupField.optionGroups).toEqual([
      expect.objectContaining({ id: "core" }),
      expect.objectContaining({ id: "other", collapsed: true }),
    ]);
    expect(
      groupField.options
        .filter((option) => option.group === "core")
        .map((option) => option.value)
    ).toEqual(["SA2", "SA3", "SA5", "CT1", "CT3", "CT4"]);
    expect(
      groupField.options
        .filter((option) => ["SA6", "CT6"].includes(option.value))
        .every((option) => option.group === "other")
    ).toBe(true);
    expect(
      groupField.options
        .filter((option) => /^(SA|CT)/.test(option.value))
        .every((option) => option.description)
    ).toBe(true);
  }
});

test("option groups must reference declared group ids", () => {
  const wizard = JSON.parse(JSON.stringify(config.wizard[0]));
  wizard.fields[0].options[0].group = "missing";
  expect(() => validateWizard(wizard)).toThrow();
});
