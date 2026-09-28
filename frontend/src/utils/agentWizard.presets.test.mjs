import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { visibleFields, updateAnswer, generatePrompt } from "./agentWizard.mjs";

const require = createRequire(
  new URL("../../../server/package.json", import.meta.url)
);
const { quickTasks } = require("yaml").parse(
  readFileSync(
    new URL("../../../agent-config/agents/3gpp-review.yaml", import.meta.url),
    "utf8"
  )
);
const tasks = quickTasks.map((key) =>
  require("yaml").parse(
    readFileSync(
      new URL(`../../../agent-config/quick-tasks/${key}.yaml`, import.meta.url),
      "utf8"
    )
  )
);

test("KI choices appear before any meeting is selected, for every group", () => {
  for (const task of tasks) {
    const groups = task.fields.find((f) => f.id === "group").options;
    for (const { value: group } of groups) {
      const fields = visibleFields(task, { group }).filter((f) =>
        f.id.startsWith("ki_")
      );
      assert.ok(fields.length >= 1);
      if (["SA2", "SA3", "SA5", "SA6", "CT4"].includes(group))
        assert.ok(
          fields.flatMap((f) => f.options).every((o) => /^KI#\d/.test(o.label))
        );
      else {
        assert.equal(fields.length, 1);
        assert.equal(fields[0].type, "text");
        assert.equal(fields[0].options, undefined);
      }
    }
  }
});

test("core-network groups are promoted and the remaining choices are collapsed", () => {
  for (const task of tasks) {
    const field = task.fields.find((f) => f.id === "group");
    assert.deepEqual(
      field.options.filter((o) => o.group === "core").map((o) => o.value),
      ["SA2", "SA3", "SA5", "CT1", "CT3", "CT4"]
    );
    assert.equal(
      field.optionGroups.find((group) => group.id === "other").collapsed,
      true
    );
    assert.equal(field.options.find((o) => o.value === "SA6").group, "other");
    assert.equal(field.options.find((o) => o.value === "CT6").group, "other");
  }
});

test("meeting changes preserve KI while switching group removes old KI", () => {
  const task = tasks[0];
  const answers = {
    group: "SA2",
    ki_sa2_0: ["23801-01_5_4"],
    meeting: { label: "SA2#176" },
    focus: ["solution"],
    detail: "overview",
  };
  const next = updateAnswer(task, answers, "meeting", { label: "SA2#177" });
  assert.deepEqual(next.ki_sa2_0, ["23801-01_5_4"]);
  const switched = updateAnswer(task, next, "group", "RAN1");
  assert.equal(switched.ki_sa2_0, undefined);
  assert.equal(switched.meeting, undefined);
  assert.equal(
    updateAnswer(task, switched, "group", "SA2").ki_sa2_0,
    undefined
  );
});

test("prompt preserves official KI, report version and section", () => {
  const prompt = generatePrompt(tasks[0], {
    action: "download_analyze",
    analysis_mode: "single",
    group: "SA2",
    ki_sa2_0: ["23801-01_5_4", "23801-01_5_2"],
    meeting: [{ label: "SA2#176" }],
    focus: ["solution"],
    detail: "overview",
  });
  assert.match(prompt, /KI#4 · 用户面架构（§5.4）/);
  assert.match(prompt, /KI#2 · 服务化架构框架/);
  assert.match(prompt, /TR 23.801-01 V0.8.0/);
  assert.doesNotMatch(prompt, /不是官方 KI 编号/);
});

test("CT4 prompt keeps the official TR and clause for repeated KI numbers", () => {
  const prompt = generatePrompt(tasks[0], {
    action: "download_analyze",
    analysis_mode: "single",
    group: "CT4",
    ki_ct4_29841_0: ["29841_5_1_1", "29841_5_2_1"],
    meeting: [{ label: "CT4#136" }],
    focus: ["solution"],
    detail: "overview",
  });
  assert.match(prompt, /TR 29.841 V0.3.1/);
  assert.match(prompt, /KI#1 · GTP-U 作为 6G 用户面协议（§5.1.1）/);
  assert.match(prompt, /KI#1 · CP\/UP 功能全互联部署（§5.2.1）/);
});
