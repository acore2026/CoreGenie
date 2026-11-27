import assert from "node:assert/strict";
import fs from "node:fs";
import { createRequire } from "node:module";
import { once } from "node:events";

const serverRequire = createRequire(new URL("../../server/package.json", import.meta.url));
const express = serverRequire("express");
const bodyParser = serverRequire("body-parser");
// Use the production parser order: a browser JSON string without its media type
// is text/plain and must not silently become an object in the mocked API.
const parserApp = express();
parserApp.use(bodyParser.text({ limit: "2mb" }));
parserApp.use(bodyParser.json({ limit: "2mb" }));
parserApp.all("/parse", (req, res) => res.json({ body: req.body ?? null }));
const parserServer = parserApp.listen(0, "127.0.0.1");
await once(parserServer, "listening");
const parserUrl = "http://127.0.0.1:" + parserServer.address().port + "/parse";
import { chromium } from "playwright";

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || "/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome",
});
const previewName = "__personal-skills-preview-" + process.pid + ".jsx";
const previewPath = new URL("../src/" + previewName, import.meta.url);
fs.writeFileSync(previewPath, "import React from \"react\";\nimport { createRoot } from \"react-dom/client\";\nimport { MemoryRouter } from \"react-router-dom\";\nimport \"./i18n\";\nimport \"./index.css\";\nimport { SkillLibrary } from \"./pages/PersonalSkills\";\nimport SkillsLink from \"./components/Sidebar/SkillsLink\";\ncreateRoot(document.getElementById(\"root\")).render(\n  <MemoryRouter>\n    <main style={{ minHeight: \"100vh\", padding: 24, background: \"var(--theme-bg-chat)\", color: \"var(--theme-text-primary)\" }}>\n      <div style={{ maxWidth: 240, marginBottom: 24 }}><SkillsLink /></div>\n      <SkillLibrary />\n    </main>\n  </MemoryRouter>\n);\n", {flag: "wx"});
const context = await browser.newContext();
const page = await context.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", msg => { if (msg.type() === "error") console.log("CONSOLE",msg.text()); });
const md = (name) => `---\nname: ${name}\ndescription: 分析会议材料，提取结论和待办事项。\n---\n\n先阅读材料，再整理输出。\n`;
const template = md("new-skill");
const records = [
  { id: 1, name: "my-review", description: "我自己的会议审阅方法，保留结论和后续行动。",
    owner: { id: 1, username: "当前用户" }, isOwner: true, isShared: true, enabled: true, revision: "revision-1", skillMd: md("my-review"), files: [] },
  { id: 2, name: "shared-analysis", description: "来自其他作者的分析流程，可先查看指令和脚本，启用后用于自己的任务。",
    owner: { id: 2, username: "同事小林" }, isOwner: false, isShared: true, enabled: false, revision: "revision-2", skillMd: md("shared-analysis"),
    files: [{ path: "scripts/analyze.py", content: "print('analysis')", encoding: "utf8", text: true, size: 17 }] },
];
let failSave = false, failLoad = false;
const writes = [];
await page.route("**/personal-skills**", async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const suffix = url.pathname.split("/personal-skills")[1];
  const method = request.method();
  if (method === "GET") {
    if (failLoad) return route.fulfill({ status: 503, json: { success: false, error: "测试加载失败" } });
    if (suffix) {
      const record = records.find((r) => r.id === Number(suffix.slice(1)));
      return route.fulfill({ json: { success: true, skill: record } });
    }
    const view = url.searchParams.get("view");
    const filtered = records.filter((r) => view === "mine" ? r.isOwner : view === "enabled" ? !r.isOwner && r.enabled && r.isShared : !r.isOwner && r.isShared);
    return route.fulfill({ json: { success: true, skills: filtered, template } });
  }
  let body = {};
  if (request.postData()) {
    const parsed = await fetch(parserUrl, {
      method,
      headers: { "Content-Type": request.headers()["content-type"] || "" },
      body: request.postData(),
    });
    body = (await parsed.json()).body;
    if (!body || typeof body !== "object")
      return route.fulfill({ status: 400, json: { success: false, error: "共享开关必须为布尔值。请求体未解析为 JSON。" } });
  }
  if (suffix.endsWith("/sharing") && typeof body.isShared !== "boolean")
    return route.fulfill({ status: 400, json: { success: false, error: "共享开关必须为布尔值。" } });
  if (suffix.endsWith("/enabled") && typeof body.enabled !== "boolean")
    return route.fulfill({ status: 400, json: { success: false, error: "启用开关必须为布尔值。" } });
  writes.push({ method, suffix, body });
  await new Promise((resolve) => setTimeout(resolve, 120));
  if (failSave) return route.fulfill({ status: 400, json: { success: false, error: "测试保存失败" } });
  const id = Number(suffix.split("/")[1]);
  let record = records.find((r) => r.id === id);
  if (suffix.endsWith("/sharing")) record.isShared = body.isShared;
  else if (suffix.endsWith("/enabled")) record.enabled = body.enabled;
  else if (method === "DELETE") records.splice(records.indexOf(record), 1);
  else if (method === "POST") {
    const name = body.skillMd.match(/name: (.+)/)[1];
    record = { ...body, id: 3, name, description: "新建个人技能", isOwner: true, enabled: true, owner: { id: 1, username: "当前用户" }, revision: "revision-3" };
    records.push(record);
  } else if (method === "PUT") Object.assign(record, body);
  return route.fulfill({ json: { success: true, skill: record } });
});
await page.route("**/__personal-skills-preview", (route) => route.fulfill({
  contentType: "text/html",
  body: `<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module">
  import RefreshRuntime from '/@react-refresh';
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
  window.__vite_plugin_react_preamble_installed__=true;
  await import("/src/${previewName}");
  </script></body></html>`,
}));
const card = (name) => page.getByRole("article", { name, exact: true });
try {
  await page.goto((process.env.CONTEXT_PREVIEW_URL || "http://127.0.0.1:7876") + "/__personal-skills-preview");
  await card("my-review").waitFor();
  assert.equal(writes.length, 0, "opening the library must not change sharing or subscriptions");
  const transportResults = await page.evaluate(async () => {
    const { default: api } = await import("/src/models/personalSkills.ts");
    return [await api.share(1, false), await api.share(1, true)];
  });
  for (const result of transportResults)
    assert.equal(result.success, true, result.error || "sharing request must reach the API as JSON");
  assert.equal(writes[0].body.isShared, false);
  assert.equal(writes[1].body.isShared, true);
  assert.equal(await page.getByRole("link", { name: "Skills 广场" }).getAttribute("href"), "/skills");
  for (const width of [1440, 390]) for (const theme of ["light", "dark"]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate((theme) => {
      document.documentElement.dataset.theme = theme;
      document.documentElement.className = theme;
    }, theme);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: `/tmp/coregenie-skills-${width}-${theme}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "新建个人 Skill", exact: true }).click();
  let dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await dialog.waitFor();
  assert.equal(await dialog.getByRole("checkbox", { name: "共享这个 Skill" }).isChecked(), true);
  await dialog.getByRole("textbox", { name: "SKILL.md", exact: true }).fill(md("new-personal"));
  await dialog.getByRole("button", { name: "保存 Skill", exact: true }).click();
  await card("new-personal").waitFor();
  assert.equal(writes.find((w) => w.method === "POST").body.isShared, true);

  failSave = true;
  await card("new-personal").getByText("共享这个 Skill", { exact: true }).click();
  await page.waitForTimeout(250);
  assert.equal(await card("new-personal").getByRole("checkbox").isChecked(), true, "failed sharing change must preserve state");
  failSave = false;
  await card("new-personal").getByRole("checkbox").focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => [...document.querySelectorAll("article")].find((a) => a.getAttribute("aria-label") === "new-personal")?.textContent.includes("仅自己"));
  assert.equal(records.find((r) => r.id === 3).isShared, false);

  await page.getByRole("button", { name: "发现共享", exact: true }).click();
  await card("shared-analysis").waitFor();
  await card("shared-analysis").getByRole("button", { name: "查看内容" }).click();
  dialog = page.locator('[role="dialog"][aria-modal="true"]');
  const textarea = dialog.getByRole("textbox", { name: "SKILL.md", exact: true });
  await textarea.waitFor();
  assert.equal(await textarea.getAttribute("readonly"), "");
  assert.equal(await dialog.getByRole("button", { name: "保存 Skill", exact: true }).count(), 0);
  assert.equal(await dialog.getByRole("checkbox", { name: "共享这个 Skill" }).count(), 0);
  await dialog.getByRole("button", { name: "scripts/analyze.py", exact: true }).click();
  assert.match(await dialog.getByRole("textbox", { name: "scripts/analyze.py" }).inputValue(), /analysis/);
  await page.setViewportSize({ width: 390, height: 900 });
  await page.screenshot({ path: "/tmp/coregenie-skills-mobile-preview.png" });
  assert.equal(await dialog.evaluate((node) => node.scrollWidth > node.clientWidth), false);
  await page.keyboard.press("Escape");
  await dialog.waitFor({ state: "detached" });

  await card("shared-analysis").getByRole("button", { name: "启用 Skill", exact: true }).click();
  await card("shared-analysis").getByRole("button", { name: "已启用 · 停用" }).waitFor();
  assert.equal(records[1].enabled, true);
  await page.getByRole("button", { name: "已启用", exact: true }).click();
  await card("shared-analysis").waitFor();
  await card("shared-analysis").getByRole("button", { name: "已启用 · 停用" }).click();
  await page.getByText("还没有启用他人的 Skill，可以去“发现共享”看看。", { exact: true }).waitFor();
  assert.equal(records[1].enabled, false);

  await page.getByRole("button", { name: "我的 Skills", exact: true }).click();
  await card("new-personal").waitFor();
  await card("new-personal").getByRole("button", { name: "编辑 Skill" }).click();
  dialog = page.locator('[role="dialog"][aria-modal="true"]');
  await dialog.getByRole("textbox", { name: "SKILL.md" }).waitFor();
  assert.equal(await dialog.getByRole("checkbox").isChecked(), false, "saved private state must survive reopening");
  await page.screenshot({ path: "/tmp/coregenie-skills-mobile-editor.png" });
  await dialog.getByRole("button", { name: "全屏编辑", exact: true }).click();
  await page.locator("dialog[open]").waitFor();
  await page.keyboard.press("Escape");
  await page.locator("dialog[open]").waitFor({ state: "detached" });
  assert.equal(await dialog.isVisible(), true, "closing fullscreen must keep the skill editor open");

  const saveBox = await dialog.getByRole("button", { name: "保存 Skill", exact: true }).boundingBox();
  assert.ok(saveBox && saveBox.y + saveBox.height <= 900, "mobile save button must remain visible");
  await dialog.getByRole("button", { name: "保存 Skill", exact: true }).click();
  await dialog.waitFor({ state: "detached" });
  assert.equal(writes.at(-1).method, "PUT");
  assert.equal(writes.at(-1).body.isShared, undefined, "editing content must not change sharing");
  assert.equal(records.find(r => r.id === 3).isShared, false);
  await page.getByRole("searchbox").fill("不存在的名称");
  await page.getByText("没有匹配的 Skill。", { exact: true }).waitFor();

  failLoad = true;
  await page.getByRole("button", { name: "发现共享", exact: true }).click();
  await page.getByRole("alert").waitFor();
  assert.equal(await page.getByRole("button", { name: "新建个人 Skill", exact: true }).isDisabled(), true);
  failLoad = false;
  await page.getByRole("button", { name: "重试", exact: true }).click();
  await card("shared-analysis").waitFor();
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ checks: ["production-json-parser", "boolean-sharing-both-directions", "json-edit-save", "colored-entry", "no-write-on-mount", "default-shared-create", "sharing-failure", "private-toggle", "readonly-preview", "script-preview", "enable", "disable", "edit-saved-private", "mobile-footer", "fullscreen-escape", "escape", "search", "failed-load-retry", "responsive-light-dark"], widths: [1440,390] }));
} catch (error) { console.log("BROWSER_ERRORS", errors); console.log("BODY", (await page.locator("body").innerText()).slice(0,1800)); await page.screenshot({path:"/tmp/coregenie-skills-error.png"}); throw error; } finally { fs.unlinkSync(previewPath); await browser.close(); parserServer.closeAllConnections(); await new Promise(resolve => parserServer.close(resolve)); }
