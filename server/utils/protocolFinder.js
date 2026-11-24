const fs = require("node:fs/promises");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const exec = require("node:util").promisify(
  require("node:child_process").execFile
);
const titles = {
  "38.413": "NG Application Protocol (NGAP)",
  "29.501": "Principles and Guidelines for Services Definition",
  "38.901": "Study on channel model for frequencies from 0.5 to 100 GHz",
  "38.523-3": "UE conformance specification · Protocol test suites",
};
function invalid(publicMessage, status = 400) {
  return Object.assign(new Error(publicMessage), { publicMessage, status });
}
async function directory(url) {
  return (
    await exec("curl", ["-fsS", "--max-time", "15", url], {
      maxBuffer: 4000000,
    })
  ).stdout;
}
async function resolveProtocol({ q, v, refresh }) {
  const match =
    typeof q === "string" &&
    q.length <= 100 &&
    q
      .trim()
      .match(
        /^(?:3GPP\s+)?(?:(TS|TR)\s*)?(\d{2})\.?(\d{3})(?:-(\d{1,2})(?=$|\s|-))?(?:-([\da-z]{3})|\s+v?(\d{1,2}\.\d{1,2}\.\d{1,2}))?(?:\.(?:zip|docx?))?$/i
      );
  if (
    !match ||
    (v !== undefined &&
      (typeof v !== "string" || !/^\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(v)))
  )
    throw invalid("请输入有效的规范编号或文件名，例如 38.413-i60。");
  const [, kind, series, item, part, code, dotted] = match;
  const id = series + "." + item + (part ? "-" + Number(part) : "");
  const number = "1" + series + item;
  const key = number + (part ? part.padStart(2, "0") : "");
  const base = Math.floor(Number(number) / 100) * 100;
  const requested = code
    ? [...code].map((c) => parseInt(c, 36)).join(".")
    : dotted?.split(".").map(Number).join(".");
  const cache = path.join(
    process.env.STORAGE_DIR || path.join(__dirname, "../storage"),
    "protocol-finder"
  );
  await fs.mkdir(cache, { recursive: true });
  async function read(name) {
    try {
      return JSON.parse(await fs.readFile(path.join(cache, name), "utf8"));
    } catch {
      return null;
    }
  }
  async function save(name, value) {
    const file = path.join(cache, name),
      tmp = file + "." + randomUUID();
    await fs.writeFile(tmp, JSON.stringify(value));
    await fs.rename(tmp, file);
  }
  for (const type of kind
    ? [kind.toUpperCase()]
    : id === "38.901"
      ? ["TR", "TS"]
      : ["TS", "TR"]) {
    const dir =
      "https://www.etsi.org/deliver/etsi_" +
      type.toLowerCase() +
      "/" +
      base +
      "_" +
      (base + 99) +
      "/" +
      key +
      "/";
    const file = type + key + ".json";
    let index = await read(file),
      warning = "";
    if (!index || refresh === "1") {
      try {
        const entries = [];
        for (const row of (await directory(dir)).split(/<br\s*\/?\s*>/i)) {
          const folder = row.match(/>(\d+\.\d+\.\d+_\d+)\s*<\/a>/i)?.[1];
          if (folder)
            entries.push({
              folder,
              version: folder.split("_")[0].split(".").map(Number).join("."),
              date: row.match(/\d+\/\d+\/\d{4}/)?.[0],
            });
        }
        if (!entries.length) throw Error("Empty index");
        entries.sort((a, b) =>
          b.version.localeCompare(a.version, "en", { numeric: true })
        );
        index = { entries, checked: new Date().toISOString() };
        await save(file, index);
      } catch (error) {
        if (!index && error.code === 22 && /404/.test(error.stderr)) continue;
        if (!index) throw error;
        warning = "刷新失败，当前显示已保存的目录。";
      }
    }
    if (v !== undefined) {
      const entry = index.entries.find((e) => e.version === v);
      if (!entry) throw invalid("目录中没有这个版本。", 404);
      const name = type + key + "-" + entry.folder + ".json";
      let pdf = await read(name);
      if (!pdf) {
        const page = await directory(dir + entry.folder + "/");
        const filename = page.match(/href="[^"]*\/([a-z0-9_-]+\.pdf)"/i)?.[1];
        if (!filename) throw invalid("此版本目录中没有 PDF。", 404);
        pdf = dir + entry.folder + "/" + filename;
        await save(name, pdf);
      }
      return { pdf };
    }
    return { type, id, title: titles[id], dir, index, requested, warning };
  }
  throw invalid("ETSI 中没有找到该规范。", 404);
}
module.exports = { resolveProtocol };
