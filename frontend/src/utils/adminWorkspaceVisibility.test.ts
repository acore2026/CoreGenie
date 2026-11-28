import { test } from "vitest";
import assert from "node:assert/strict";
import { visibleOutsideAdminView } from "./adminWorkspaceVisibility.ts";

test("personal view includes both public modes and memberships, but not unrelated private workspaces", () => {
  const rows = [
    { id: 1, accessMode: "public_collaborative", userIds: [] },
    { id: 2, accessMode: "public_readonly", userIds: [] },
    { id: 3, accessMode: "private", userIds: ["7"] },
    { id: 4, accessMode: "private", userIds: [8] },
    { id: 5, viewerRelation: "creator", userIds: [] },
  ];
  const result = visibleOutsideAdminView(rows, 7);
  assert.deepEqual(
    result.map((row) => row.id),
    [1, 2, 3, 5]
  );
  assert.ok(result.every((row) => row.viewerAccess === "manager"));
  assert.equal("viewerAccess" in rows[0], false);
});
