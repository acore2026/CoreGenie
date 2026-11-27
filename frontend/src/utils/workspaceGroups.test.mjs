import { test } from "vitest";
import assert from "node:assert/strict";
import {
  normalizeWorkspaceGroups,
  workspaceScope,
  workspaceGroupId,
  workspaceGroupsKey,
  removeWorkspaceGroup,
  moveGroupedWorkspace,
  effectiveWorkspaceGroups,
  personalWorkspaceGroups,
  assignWorkspaceGroups,
  groupDropDestination,
} from "./workspaceGroups.mjs";

const settings = normalizeWorkspaceGroups({
  groups: [
    { id: "group-sa2", scope: "private", name: "SA2" },
    { id: "group-team", scope: "public", name: "团队" },
  ],
  assignments: { 2: "group-sa2", 3: "group-sa2" },
});
const workspaces = [
  { id: 1, accessMode: "public_readonly" },
  { id: 2, accessMode: "private" },
  { id: 4, accessMode: "private" },
  { id: 3, accessMode: "private" },
];

test("public modes share a section; missing permission metadata stays private", () => {
  assert.equal(
    workspaceScope({ accessMode: "public_collaborative" }),
    "public"
  );
  assert.equal(workspaceScope(workspaces[0]), "public");
  assert.equal(workspaceScope({}), "private");
  assert.notEqual(workspaceGroupsKey(1), workspaceGroupsKey(2));
});
test("permission changes and deleted groups cannot hide a workspace", () => {
  assert.equal(
    workspaceGroupId(
      { ...workspaces[1], accessMode: "public_readonly" },
      settings
    ),
    "public"
  );
  const next = removeWorkspaceGroup(settings, "group-sa2");
  assert.equal(workspaceGroupId(workspaces[1], next), "private");
  assert.deepEqual(next.assignments, {});
  assert.equal(workspaces.length, 4);
});
test("reorder uses group-local indices with interleaved public and private rows", () => {
  const next = moveGroupedWorkspace(
    workspaces,
    settings,
    { droppableId: "group-sa2", index: 1 },
    { droppableId: "group-sa2", index: 0 }
  );
  assert.deepEqual(
    next.workspaces
      .filter((w) => workspaceGroupId(w, next.settings) === "group-sa2")
      .map((w) => w.id),
    [3, 2]
  );
  assert.deepEqual(
    workspaces.map((w) => w.id),
    [1, 2, 4, 3]
  );
});
test("moving into and out of a custom group only updates personal assignments", () => {
  const next = moveGroupedWorkspace(
    workspaces,
    settings,
    { droppableId: "private", index: 0 },
    { droppableId: "group-sa2", index: 1 }
  );
  assert.equal(next.settings.assignments[4], "group-sa2");
  assert.deepEqual(
    next.workspaces
      .filter((w) => workspaceGroupId(w, next.settings) === "group-sa2")
      .map((w) => w.id),
    [2, 4, 3]
  );
  const back = moveGroupedWorkspace(
    next.workspaces,
    next.settings,
    { droppableId: "group-sa2", index: 1 },
    { droppableId: "private", index: 0 }
  );
  assert.equal(back.settings.assignments[4], undefined);
  assert.equal(back.workspaces.find((w) => w.id === 4).accessMode, "private");
});
test("dragging between permission sections is rejected", () => {
  assert.equal(
    moveGroupedWorkspace(
      workspaces,
      settings,
      { droppableId: "private", index: 0 },
      { droppableId: "group-team", index: 0 }
    ),
    null
  );
});
test("malformed preferences and stale assignments are safely discarded", () => {
  assert.deepEqual(normalizeWorkspaceGroups(null), {
    groups: [],
    assignments: {},
    collapsed: {},
  });
  const next = normalizeWorkspaceGroups({
    groups: [
      null,
      { id: "private", name: "bad", scope: "private" },
      ...settings.groups,
    ],
    assignments: { 99: "gone", 2: "group-sa2" },
    collapsed: { private: true, public: "false", missing: true },
  });
  assert.deepEqual(next.groups, settings.groups);
  assert.deepEqual(next.assignments, { 2: "group-sa2" });
  assert.deepEqual(next.collapsed, { private: true });
});
test("global defaults appear for all accounts while personal assignments take priority", () => {
  const shared = {
    groups: [{ id: "group-shared", name: "会议", scope: "private" }],
    assignments: { 2: "group-shared" },
  };
  const personal = normalizeWorkspaceGroups(null);
  const combined = effectiveWorkspaceGroups(personal, shared);
  assert.equal(workspaceGroupId(workspaces[1], combined), "group-shared");
  const override = { ...personal, assignments: { 2: "private" } };
  assert.equal(
    workspaceGroupId(workspaces[1], effectiveWorkspaceGroups(override, shared)),
    "private"
  );
  assert.equal(shared.assignments[2], "group-shared");
});
test("folding groups preserves live global defaults and moving out only saves a personal override", () => {
  const personal = normalizeWorkspaceGroups(null);
  const shared = {
    groups: [{ id: "group-shared", name: "会议", scope: "private" }],
    assignments: { 2: "group-shared" },
  };
  const before = effectiveWorkspaceGroups(personal, shared);
  const folded = personalWorkspaceGroups(
    personal,
    before,
    { ...before, collapsed: { "group-shared": true } },
    shared
  );
  assert.deepEqual(folded.groups, []);
  assert.deepEqual(folded.assignments, {});
  const moved = personalWorkspaceGroups(
    personal,
    before,
    { ...before, assignments: {} },
    shared
  );
  assert.deepEqual(moved.assignments, { 2: "private" });
});
test("quick moves reject mixed permission sections and preserve other assignments", () => {
  const next = assignWorkspaceGroups(settings, workspaces, [2, 4], "group-sa2");
  assert.deepEqual(next.assignments, {
    2: "group-sa2",
    3: "group-sa2",
    4: "group-sa2",
  });
  assert.equal(
    assignWorkspaceGroups(settings, workspaces, [1, 2], "group-sa2"),
    null
  );
  assert.equal(
    assignWorkspaceGroups(settings, workspaces, [999], "group-sa2"),
    null
  );
  assert.equal(
    assignWorkspaceGroups(settings, workspaces, [2], "missing"),
    null
  );
  assert.equal(
    assignWorkspaceGroups(
      settings,
      workspaces,
      Array(101).fill(2),
      "group-sa2"
    ),
    null
  );
  assert.equal(
    assignWorkspaceGroups(settings, workspaces, [2], "private").assignments[2],
    undefined
  );
});
test("dropping on a folded group heading resolves to its existing group", () => {
  assert.deepEqual(
    groupDropDestination({ droppableId: "group-target:group-sa2", index: 0 }),
    { droppableId: "group-sa2", index: 0 }
  );
  assert.deepEqual(
    groupDropDestination({ droppableId: "group-sa2", index: 1 }),
    { droppableId: "group-sa2", index: 1 }
  );
  assert.equal(groupDropDestination(null), null);
  const moved = moveGroupedWorkspace(
    workspaces,
    { ...settings, collapsed: { private: true, "group-sa2": true } },
    { droppableId: "private", index: 0 },
    groupDropDestination({ droppableId: "group-target:group-sa2", index: 0 })
  );
  assert.equal(moved.settings.collapsed.private, false);
  assert.equal(moved.settings.collapsed["group-sa2"], false);
});
