import { test } from "vitest";
import assert from "node:assert/strict";
import { orderWorkspaces } from "./workspaceOrder.ts";

test("created workspaces precede invited memberships and other visible workspaces", () => {
  const rows = [
    { id: 1, name: "A", viewerRelation: "other" },
    { id: 2, name: "B", viewerRelation: "member" },
    { id: 3, name: "Z", viewerRelation: "creator" },
  ];
  assert.deepEqual(
    orderWorkspaces(rows).map((w) => w.id),
    [3, 2, 1]
  );
  assert.deepEqual(
    rows.map((w) => w.id),
    [1, 2, 3]
  );
});
test("KI numbers sort naturally regardless of database or old drag order", () => {
  const rows = [17, 3, 22, 2, 8, 1].map((id) => ({
    id,
    name: `SA2 KI${id} · 测试`,
    viewerRelation: "creator",
  }));
  assert.deepEqual(
    orderWorkspaces(rows).map((w) => w.id),
    [1, 2, 3, 8, 17, 22]
  );
  rows[0].name = "SA2 KI0 · 改名";
  assert.equal(orderWorkspaces(rows)[0].id, 17);
});
test("missing ownership sorts by name with deterministic ties", () => {
  assert.deepEqual(
    orderWorkspaces([
      { id: 3, name: "测试2" },
      { id: 2, name: "测试1" },
      { id: 1, name: "测试1" },
    ]).map((w) => w.id),
    [1, 2, 3]
  );
});
