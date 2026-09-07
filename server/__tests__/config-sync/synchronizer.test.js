const fs = require("fs/promises");
const os = require("os");
const path = require("path");
const { Synchronizer, hash } = require("../../config-sync/engine");
const { ConfigFiles, skillSource } = require("../../config-sync/files");

describe("repository configuration synchronization", () => {
  let root, files, database, records, persisted, sync;
  const makeSync = () =>
    new Synchronizer({
      files,
      database,
      loadState: async () => structuredClone(persisted),
      saveState: async (state) => {
        persisted = structuredClone(state);
      },
    });
  beforeEach(async () => {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "config-sync-test-"));
    files = new ConfigFiles(root);
    records = { "global-prompt": { id: null, value: "original" } };
    persisted = { entries: {}, keys: {} };
    database = {
      list: async () => structuredClone(records),
      put: jest.fn(async (key, value, id) => {
        records[key] = { id: id || 1, value };
        return id || 1;
      }),
    };
    sync = makeSync();
  });
  afterEach(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });

  it("exports the database on first use and imports a later file edit without looping", async () => {
    await sync.reconcile();
    expect(await files.read("global-prompt")).toBe("original");
    await fs.writeFile(path.join(root, "global-prompt.md"), "file edit");
    await sync.reconcile();
    await sync.reconcile();
    expect(records["global-prompt"].value).toBe("file edit");
    expect(database.put).toHaveBeenCalledTimes(1);
  });

  it("exports a web edit and retains pending changes across restart", async () => {
    await sync.reconcile();
    records["global-prompt"].value = "web edit";
    const write = jest
      .spyOn(files, "write")
      .mockRejectedValueOnce(new Error("read only"));
    expect((await sync.reconcile()).items[0].status).toBe("error");
    sync = makeSync();
    await sync.reconcile();
    expect(await files.read("global-prompt")).toBe("web edit");
    expect(write).toHaveBeenCalledTimes(2);
  });

  it.each(["file", "database"])(
    "preserves conflicting edits until the admin selects %s",
    async (side) => {
      await sync.reconcile();
      records["global-prompt"].value = "web edit";
      await fs.writeFile(path.join(root, "global-prompt.md"), "file edit");
      expect((await sync.reconcile()).items[0].status).toBe("conflict");
      sync = makeSync();
      expect((await sync.reconcile()).items[0].status).toBe("conflict");
      const result = await sync.reconcile({
        key: "global-prompt",
        side,
        fileHash: hash("file edit"),
        databaseHash: hash("web edit"),
      });
      expect(result.items[0].status).toBe("synced");
      const expected = side === "file" ? "file edit" : "web edit";
      expect(await files.read("global-prompt")).toBe(expected);
      expect(records["global-prompt"].value).toBe(expected);
    }
  );

  it("rejects stale conflict resolution without overwriting newer edits", async () => {
    await sync.reconcile();
    records["global-prompt"].value = "web edit";
    await fs.writeFile(path.join(root, "global-prompt.md"), "new file edit");
    const result = await sync.reconcile({
      key: "global-prompt",
      side: "database",
      fileHash: hash("old file edit"),
      databaseHash: hash("web edit"),
    });
    expect(result.items[0].status).toBe("error");
    expect(await files.read("global-prompt")).toBe("new file edit");
  });

  it("does not interpret a missing file as deletion and can restore it from the UI", async () => {
    await sync.reconcile();
    await fs.unlink(path.join(root, "global-prompt.md"));
    expect((await sync.reconcile()).items[0].status).toBe("error");
    await sync.reconcile({
      key: "global-prompt",
      side: "database",
      fileHash: null,
      databaseHash: hash("original"),
    });
    expect(await files.read("global-prompt")).toBe("original");
  });

  it("validates files and leaves the active configuration intact", async () => {
    await fs.mkdir(path.join(root, "agents"));
    await fs.writeFile(path.join(root, "agents/broken.yaml"), "name: [invalid");
    const result = await sync.reconcile();
    expect(
      result.items.find((item) => item.key === "agents/broken").status
    ).toBe("error");
    expect(database.put).not.toHaveBeenCalled();
  });

  it("compares existing files on first use instead of overwriting them", async () => {
    await fs.writeFile(path.join(root, "global-prompt.md"), "existing repo");
    expect((await sync.reconcile()).items[0].status).toBe("conflict");
    expect(await files.read("global-prompt")).toBe("existing repo");
  });

  it("round-trips a skill's binary resources and explicit archive state", async () => {
    const value = {
      skillMd:
        "---\nname: sample\ndescription: Sample skill\n---\n\nInstructions.\n",
      archived: true,
      files: {
        "assets/test.bin": Buffer.from([0, 255, 3]).toString("base64"),
        "scripts/test.py": Buffer.from("print(1)").toString("base64"),
      },
    };
    records["skills/sample"] = { id: 2, value };
    await sync.reconcile();
    expect(await files.read("skills/sample")).toEqual(value);
    await fs.unlink(path.join(root, "skills/sample/scripts/test.py"));
    await sync.reconcile();
    expect(records["skills/sample"].value.files).not.toHaveProperty(
      "scripts/test.py"
    );
    expect(records["skills/sample"].value.archived).toBe(true);
  });

  it("recovers an interrupted skill directory replacement", async () => {
    const value = {
      skillMd: "---\nname: sample\ndescription: Sample\n---\nText",
      archived: false,
      files: {},
    };
    await files.write("skills/sample", value);
    await fs.rename(
      path.join(root, "skills/sample"),
      path.join(root, "skills/.backup-sample")
    );
    expect((await files.list())["skills/sample"].value).toEqual(value);
  });

  it("rejects symlinked definitions and traversal keys", async () => {
    await fs.symlink(
      path.join(root, "target"),
      path.join(root, "global-prompt.md")
    );
    expect((await sync.reconcile()).items[0].status).toBe("error");
    expect(() => files.target("agents/../../outside")).toThrow();
  });

  it("serializes overlapping reconciliation calls", async () => {
    await Promise.all([sync.reconcile(), sync.reconcile(), sync.reconcile()]);
    expect(await files.read("global-prompt")).toBe("original");
    expect(database.put).not.toHaveBeenCalled();
  });

  it("strips only the sync archive field from SKILL frontmatter", () => {
    expect(
      skillSource(
        "---\narchived: true\nname: test\ndescription: Test\n---\narchived: example"
      )
    ).toEqual({
      archived: true,
      skillMd: "---\nname: test\ndescription: Test\n---\narchived: example",
    });
  });
});
