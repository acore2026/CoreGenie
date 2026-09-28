import test from "node:test";
import assert from "node:assert/strict";
import {
  generatePrompt,
  missingFields,
  pruneAnswers,
  visibleFields,
  updateAnswer,
  wizardTasks,
} from "./agentWizard.mjs";

test("multiple quick tasks preserve identity and old single forms still work", () => {
  assert.deepEqual(wizardTasks(null), []);
  assert.equal(wizardTasks({ title: "旧任务" })[0].id, "default");
  const tasks = [{ id: "one" }, { id: "two" }];
  assert.deepEqual(wizardTasks(tasks), tasks);
});

test("changing group clears meeting and KI; changing meeting clears only KI", () => {
  const config = {
    fields: [
      { id: "group" },
      { id: "meeting", type: "meeting", groupField: "group" },
      {
        id: "ki",
        type: "agenda",
        groupField: "group",
        meetingField: "meeting",
      },
      { id: "notes" },
    ],
  };
  const answers = {
    group: "SA2",
    meeting: { id: "176" },
    ki: [{ value: "1" }],
    notes: "keep",
  };
  assert.deepEqual(updateAnswer(config, answers, "group", "RAN1"), {
    group: "RAN1",
    notes: "keep",
  });
  assert.deepEqual(updateAnswer(config, answers, "meeting", { id: "177" }), {
    group: "SA2",
    meeting: { id: "177" },
    notes: "keep",
  });
});

test("catalog selections include source and KI context in generated prompt", () => {
  const config = {
    instructions: "分析",
    fields: [
      { id: "meeting", type: "meeting", label: "会议", required: true },
      { id: "ki", type: "agenda", label: "KI", required: true },
    ],
  };
  assert.equal(
    generatePrompt(config, { meeting: { label: "SA2#176" }, ki: [] }),
    null
  );
  const prompt = generatePrompt(config, {
    meeting: { label: "SA2#176", source: "https://www.3gpp.org/ftp/meeting/" },
    ki: [
      {
        label: "KI#1",
        description: "study A",
        source: "https://www.3gpp.org/ftp/agenda.htm",
      },
    ],
  });
  assert.match(prompt, /KI#1（study A）/);
  assert.match(prompt, /来源：https:\/\/www.3gpp.org\/ftp\/agenda.htm/);
});

const wizard = {
  instructions: "分析任务",
  fields: [
    {
      id: "scope",
      label: "范围",
      type: "single",
      required: true,
      options: [
        { value: "meeting", label: "会议" },
        { value: "tdocs", label: "编号" },
      ],
    },
    {
      id: "group",
      label: "工作组",
      type: "single",
      required: true,
      options: [{ value: "other", label: "其他" }],
      when: [{ field: "scope", values: ["meeting"] }],
    },
    {
      id: "name",
      label: "名称",
      type: "text",
      required: true,
      when: [{ field: "group", values: ["other"] }],
    },
    {
      id: "ids",
      label: "编号",
      type: "textarea",
      required: true,
      when: [{ field: "scope", values: ["tdocs"] }],
    },
    {
      id: "focus",
      label: "重点",
      type: "multi",
      options: [
        { value: "flows", label: "流程" },
        { value: "results", label: "会议结果" },
      ],
    },
  ],
};

test("empty form validates only visible required fields", () => {
  assert.deepEqual(
    missingFields(wizard, {}).map((f) => f.id),
    ["scope"]
  );
  assert.equal(generatePrompt(wizard, {}), null);
});
test("switching a branch clears nested answers and excludes hidden required fields", () => {
  const answers = {
    scope: "tdocs",
    group: "other",
    name: "old branch",
    ids: "S2-123",
  };
  assert.deepEqual(
    visibleFields(wizard, answers).map((f) => f.id),
    ["scope", "ids", "focus"]
  );
  assert.deepEqual(pruneAnswers(wizard, answers), {
    scope: "tdocs",
    ids: "S2-123",
  });
  assert.equal(
    generatePrompt(wizard, answers),
    "分析任务\n\n范围：编号\n\n编号：S2-123"
  );
});
test("selected labels, not internal values, appear in generated prompt", () => {
  const prompt = generatePrompt(wizard, {
    scope: "tdocs",
    ids: " S2-123 ",
    focus: ["results", "flows", "invented"],
  });
  assert.match(prompt, /重点：流程、会议结果/);
  assert.doesNotMatch(prompt, /invented|flows|results/);
});
test("unknown choices and whitespace cannot satisfy required fields", () => {
  assert.equal(generatePrompt(wizard, { scope: "unknown" }), null);
  assert.equal(generatePrompt(wizard, { scope: "tdocs", ids: "  " }), null);
});
test("multiple conditions require all parents; hidden ancestors block descendants", () => {
  const config = {
    fields: [
      ...wizard.fields,
      {
        id: "extra",
        when: [
          { field: "scope", values: ["meeting"] },
          { field: "focus", values: ["flows"] },
        ],
      },
    ],
  };
  assert.equal(
    visibleFields(config, { scope: "meeting", focus: ["flows"] }).at(-1).id,
    "extra"
  );
  assert.notEqual(
    visibleFields(config, { scope: "tdocs", focus: ["flows"] }).at(-1).id,
    "extra"
  );
});
