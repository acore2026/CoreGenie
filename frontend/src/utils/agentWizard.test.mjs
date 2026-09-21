import test from "node:test";
import assert from "node:assert/strict";
import {
  generatePrompt,
  missingFields,
  pruneAnswers,
  visibleFields,
} from "./agentWizard.mjs";

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
