const path = require("path");
const {
  insertRows,
  primaryKeyFor,
  resolveWithin,
  reviveRowValues,
  safeRelativePath,
  TABLE_SPECS,
} = require("../../../scripts/offline/global-data");

describe("离线全局数据脚本", () => {
  test("拒绝绝对路径和目录穿越", () => {
    expect(() => safeRelativePath("/etc/passwd", "test")).toThrow("相对路径");
    expect(() => safeRelativePath("../escape", "test")).toThrow("允许目录");
    expect(() => safeRelativePath("..", "test")).toThrow("允许目录");
    expect(() => safeRelativePath("", "test")).toThrow("相对路径");
    expect(safeRelativePath("a/./b/../c.txt", "test")).toBe("a/c.txt");
  });

  test("resolveWithin 把解析结果限制在根目录内", () => {
    const root = path.resolve("/tmp/package");
    expect(resolveWithin(root, "storage/lancedb", "test")).toBe(
      path.resolve("/tmp/package/storage/lancedb")
    );
    // 已被 safeRelativePath 归一化的 ../ 无法通过目录检查。
    expect(() => resolveWithin(root, "../outside", "test")).toThrow();
  });

  test("全局数据表清单不包含 Workspace 表", () => {
    const exported = new Set(TABLE_SPECS.map((spec) => spec.name));
    for (const banned of [
      "workspaces",
      "workspace_chats",
      "workspace_documents",
      "workspace_users",
      "agent_runs",
      "agent_run_events",
      "agent_tool_executions",
    ]) {
      expect(exported.has(banned)).toBe(false);
    }
    // 核心全局资源必须在导出清单里。
    for (const required of [
      "users",
      "system_settings",
      "predefined_agents",
      "predefined_agent_skills",
      "predefined_quick_tasks",
      "agent_skill_revisions",
      "global_documents",
      "model_capabilities",
    ]) {
      expect(exported.has(required)).toBe(true);
    }
  });

  test("reviveRowValues 把 ISO 日期字符串还原为 Date 对象", () => {
    const row = {
      id: 1,
      createdAt: "2026-09-28T06:40:00.000Z",
      username: "2026-09-28T06:40:00.000Z", // 非日期列保持字符串
    };
    const revived = reviveRowValues("users", row);
    expect(revived.createdAt instanceof Date).toBe(true);
    expect(revived.username).toBe("2026-09-28T06:40:00.000Z");
    // 无 DMMF 的表原样返回
    expect(reviveRowValues("unknown_table", row)).toEqual(row);
  });

  describe("insertRows", () => {
    const executed = [];

    const client = {
      $executeRawUnsafe: async (sql, ...values) => {
        executed.push({ sql, values });
      },
    };

    beforeEach(() => {
      executed.length = 0;
    });

    test("按主键生成 INSERT 且默认不覆盖冲突", async () => {
      await insertRows(client, "users", [
        { id: 1, name: "a", secret: null },
      ]);
      expect(executed).toHaveLength(1);
      expect(executed[0].sql).toContain('INSERT INTO "users" ("id", "name", "secret")');
      expect(executed[0].sql).not.toContain("ON CONFLICT");
      expect(executed[0].values).toEqual([1, "a", null]);
    });

    test("memories 表的 @map 列名被翻译为数据库列名", async () => {
      await insertRows(client, "memories", [
        { id: 1, userId: 2, workspaceId: null, content: "x" },
      ]);
      expect(executed[0].sql).toContain('"user_id"');
      expect(executed[0].sql).toContain('"workspace_id"');
      expect(executed[0].sql).not.toContain('"userId"');
    });

    test("allowExisting 时生成 ON CONFLICT DO UPDATE", async () => {
      await insertRows(client, "users", [{ id: 1, name: "b" }], {
        allowExisting: true,
      });
      expect(executed[0].sql).toContain("ON CONFLICT (\"id\") DO UPDATE SET");
      expect(executed[0].sql).toContain('"name" = EXCLUDED."name"');
    });

    test("global_reference_entries 使用 key 作为主键", async () => {
      expect(primaryKeyFor("global_reference_entries")).toEqual(["key"]);
      await insertRows(client, "global_reference_entries", [
        { key: "k", payload: "{}" },
      ], { allowExisting: true });
      expect(executed[0].sql).toContain('ON CONFLICT ("key") DO UPDATE SET');
    });

    test("空行列表不执行 SQL", async () => {
      await insertRows(client, "users", []);
      expect(executed).toHaveLength(0);
    });
  });
});
