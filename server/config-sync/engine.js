const crypto = require("crypto");

function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonical(value[key])])
    );
  return value;
}

function hash(value) {
  return value == null
    ? null
    : crypto
        .createHash("sha256")
        .update(JSON.stringify(canonical(value)))
        .digest("hex");
}

// One queue covers reconciliation and application saves. No polling work overlaps.
class Synchronizer {
  constructor({ files, database, loadState, saveState }) {
    Object.assign(this, { files, database, loadState, saveState });
    this.queue = Promise.resolve();
    this.state = null;
    this.items = [];
    this.lastCheckedAt = null;
    this.error = null;
  }

  exclusive(fn) {
    const result = this.queue.then(fn);
    this.queue = result.catch(() => {});
    return result;
  }

  async scan(resolution = null) {
    // Reload the durable baseline so a failed state write is retried after a scan.
    this.state = await this.loadState();
    let saved = JSON.stringify(this.state);
    const disk = await this.files.list();
    const db = await this.database.list(this.state, disk);
    const keys = [
      ...new Set([
        ...Object.keys(db),
        ...Object.keys(disk),
        ...Object.keys(this.state.entries),
      ]),
    ];
    // Skills must exist before agents can reference them.
    keys.sort(
      (a, b) =>
        Number(!a.startsWith("skills/")) - Number(!b.startsWith("skills/")) ||
        a.localeCompare(b)
    );
    this.items = [];
    let matched = !resolution;
    for (const key of keys) {
      const entry = this.state.entries[key];
      const file = disk[key];
      const database = db[key];
      const fileHash = hash(file?.value);
      const databaseHash = hash(database?.value);
      const base = entry?.hash ?? null;
      const item = {
        key,
        name: database?.value?.name || key,
        status: "synced",
        fileHash,
        databaseHash,
      };
      try {
        if (file?.error) throw new Error(file.error);
        let direction = null;
        if (resolution?.key === key) {
          matched = true;
          if (
            resolution.fileHash !== fileHash ||
            resolution.databaseHash !== databaseHash
          )
            throw new Error("内容已变化，请刷新后重新选择版本。");
          direction = resolution.side;
        } else if (fileHash === databaseHash && fileHash) {
          direction = "equal";
        } else if (entry && !file) {
          throw new Error(
            "配置文件缺失。请恢复文件，或使用数据库版本重新导出。"
          );
        } else if (entry && !database) {
          throw new Error("数据库记录缺失。请使用文件版本恢复配置。");
        } else if (!entry) {
          direction =
            file && database ? "conflict" : file ? "file" : "database";
        } else if (fileHash === base) {
          direction = "database";
        } else if (databaseHash === base) {
          direction = "file";
        } else {
          direction = "conflict";
        }

        if (direction === "conflict") {
          item.status = "conflict";
        } else if (direction === "file") {
          if (!file) throw new Error("文件版本不存在。");
          await this.files.verify(key, fileHash);
          const id = await this.database.put(
            key,
            file.value,
            database?.id,
            this.state
          );
          this.state.entries[key] = { id, hash: fileHash };
        } else if (direction === "database") {
          if (!database) throw new Error("数据库版本不存在。");
          await this.files.verify(key, fileHash);
          await this.files.write(key, database.value, fileHash);
          this.state.entries[key] = { id: database.id, hash: databaseHash };
        } else if (direction === "equal") {
          this.state.entries[key] = { id: database.id, hash: databaseHash };
        }
        // Persist after each object so a later failure does not lose progress.
        if (JSON.stringify(this.state) !== saved) {
          await this.saveState(this.state);
          saved = JSON.stringify(this.state);
        }
      } catch (error) {
        item.status = "error";
        item.error = error.message;
      }
      this.items.push(item);
    }
    if (!matched) throw new Error("配置不存在，请刷新后重试。");
    this.lastCheckedAt = new Date().toISOString();
    this.error = null;
    return this.status();
  }

  reconcile(resolution = null) {
    return this.exclusive(async () => {
      try {
        return await this.scan(resolution);
      } catch (error) {
        this.error = error.message;
        throw error;
      }
    });
  }

  status() {
    return {
      items: this.items,
      lastCheckedAt: this.lastCheckedAt,
      error: this.error,
    };
  }
}

module.exports = { Synchronizer, hash };
