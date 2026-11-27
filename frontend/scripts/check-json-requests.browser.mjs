// Run with a local Vite server. All API traffic goes to an isolated parser fixture.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { once } from "node:events";
import { chromium } from "playwright";

const require = createRequire(new URL("../../server/package.json", import.meta.url));
const app = require("express")();
const bodyParser = require("body-parser");
const upload = require("multer")({ storage: require("multer").memoryStorage() });
const requests = [];
app.use(bodyParser.text({ limit: "2mb" }));
app.use(bodyParser.json({ limit: "2mb" }));
app.use(upload.any());
app.use((req, res) => {
  requests.push({
    method: req.method, path: req.path, type: req.get("content-type"),
    body: req.body, files: (req.files || []).map(file => file.originalname),
  });
  const valid = ["GET", "DELETE"].includes(req.method) ||
    (req.body && typeof req.body === "object");
  res.status(valid ? 200 : 400).json({
    success: !!valid, error: valid ? null : "Request body was not parsed as an object",
    agents: [], skills: [],
  });
});
const server = app.listen(0, "127.0.0.1");
await once(server, "listening");
let browser;
try {
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH ||
      "/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
    headless: true, args: ["--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.route("**/__json-request-check", route =>
    route.fulfill({ contentType: "text/html", body: "<html><body>JSON request checks</body></html>" }));
  await page.route("**/api/**", async route => {
    const request = route.request();
    const parsed = new URL(request.url());
    const response = await fetch("http://127.0.0.1:" + server.address().port + parsed.pathname + parsed.search, {
      method: request.method(),
      headers: request.headers()["content-type"] ?
        { "content-type": request.headers()["content-type"] } : {},
      ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}),
    });
    await route.fulfill({ status: response.status, contentType: "application/json", body: await response.text() });
  });
  await page.goto((process.env.CONTEXT_PREVIEW_URL || "http://127.0.0.1:7876") + "/__json-request-check");
  const results = await page.evaluate(async () => {
    const { default: refresh } = await import("/@react-refresh");
    refresh.injectIntoGlobalHook(window);
    window.$RefreshReg$ = () => {};
    window.$RefreshSig$ = () => type => type;
    window.__vite_plugin_react_preamble_installed__ = true;
    const { default: personal } = await import("/src/models/personalSkills.js");
    const { default: config } = await import("/src/models/configSync.js");
    const { default: workspace } = await import("/src/models/workspace.js");
    const { default: predefined } = await import("/src/models/predefinedAgent.js");
    const results = [];
    const check = async (name, action) => {
      try {
        const result = await action();
        results.push({ name, success: (result.data || result).success === true });
      } catch (error) { results.push({ name, success: false, error: error.message }); }
    };
    await check("enable shared skill", () => personal.enable(2, true));
    await check("disable shared skill", () => personal.enable(2, false));
    await check("share", () => personal.share(1, true));
    await check("unshare", () => personal.share(1, false));
    await check("create personal skill", () => personal.create({ skillMd: "demo", isShared: false }));
    await check("update personal skill", () => personal.update(1, { skillMd: "updated", revision: "old" }));
    const detail = { key: "agents/demo", fileHash: "file", databaseHash: "db" };
    await check("resolve file version", () => config.resolve(detail, "file"));
    await check("resolve database version", () => config.resolve(detail, "database"));
    await check("retry sync", () => config.retry());
    await check("rename workspace entry", () => workspace.renameWorkspaceEntry("demo", "旧文件.md", "新文件.md"));
    await check("save workspace skill", () => predefined.saveWorkspaceSkill("demo", { skillMd: "demo" }));
    await check("create global skill", () => predefined.createSkill({ skillMd: "demo" }));
    await check("update global skill", () => predefined.updateSkill(1, { skillMd: "updated" }));
    const file = new File(["demo"], "demo.txt", { type: "text/plain" });
    await check("upload global skill file", () => predefined.uploadSkillFile(1, "references/demo.txt", file));
    await check("upload workspace skill file", () => predefined.uploadWorkspaceSkillFile("demo", "test", "references/demo.txt", file));
    await check("upload agent icon", () => predefined.uploadIcon(1, file));
    const form = new FormData();
    form.append("path", ".");
    form.append("file", file);
    await check("upload workspace file", () => workspace.uploadWorkspaceFile("demo", form));
    await personal.list("enabled");
    await config.status();
    await predefined.getSkill(1);
    return results;
  });
  console.log(JSON.stringify(results));
  assert.deepEqual(results.filter(result => !result.success), []);
  for (const path of ["/api/personal-skills/2/enabled", "/api/personal-skills/1/sharing"]) {
    const values = requests.filter(r => r.path === path).map(r => r.body.enabled ?? r.body.isShared);
    assert.deepEqual(values, [true, false], path);
  }
  assert.deepEqual(requests.find(r => r.method === "PATCH" && r.path.endsWith("/files")).body,
    { path: "旧文件.md", name: "新文件.md" });
  for (const request of requests.filter(r => r.files.length)) {
    assert.match(request.type, /^multipart\/form-data; boundary=/);
    assert.deepEqual(request.files, ["demo.txt"]);
  }
  assert.equal(requests.filter(r => r.files.length).length, 4);
  for (const request of requests.filter(r => r.method === "GET")) assert.equal(request.type, undefined);
  console.log("JSON booleans, payloads, multipart uploads and bodyless reads passed.");
} finally {
  if (browser) await browser.close();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
}
