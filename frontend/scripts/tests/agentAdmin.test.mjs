import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mockAPI } from "./mockAPI.mjs";

let server, browser, context, page, base;
const data = {
  agents: [],
  skills: [],
  quickTasks: [],
  tools: [],
  runtimes: [],
  modelCapabilities: [],
  defaultAgentId: null,
};
before(async () => {
  base = process.env.COREGENIE_TEST_URL;
  if (!base) {
    server = await createServer({
      root: fileURLToPath(new URL("../../", import.meta.url)),
      server: { host: "127.0.0.1", port: 0 },
    });
    await server.listen();
    base = `http://127.0.0.1:${server.httpServer.address().port}`;
  }
  browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
  });
  context = await browser.newContext();
  await mockAPI(context);
  await context.route("**/api/admin/predefined-agents", (route) =>
    route.fulfill({ json: data })
  );
  page = await context.newPage();
  page.setDefaultTimeout(12000);
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test("a failed default assignment retains the Agent and retries by updating its id", async () => {
  const writes = [];
  await page.route("**/api/admin/predefined-agents", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    const agent = { ...route.request().postDataJSON(), id: 7 };
    data.agents = [agent];
    writes.push("create");
    return route.fulfill({ json: { success: true, agent } });
  });
  await page.route("**/api/admin/predefined-agents/7", (route) => {
    data.agents[0] = { ...route.request().postDataJSON(), id: 7 };
    writes.push("update");
    return route.fulfill({ json: { success: true, agent: data.agents[0] } });
  });
  await page.route("**/api/admin/predefined-agents/default", (route) => {
    const retry = writes.includes("default");
    writes.push("default");
    if (retry) data.defaultAgentId = 7;
    return route.fulfill({
      status: retry ? 200 : 400,
      json: retry
        ? { success: true }
        : { success: false, error: "无法设置默认助手" },
    });
  });
  await page.goto(base + "/settings/agents");
  await page.getByRole("button", { name: "新建 Agent", exact: true }).click();
  const name = page.getByPlaceholder("例如：研究分析师");
  await name.fill("会议分析");
  await page
    .getByPlaceholder("定义角色、工作方式、输出要求和边界……")
    .fill("比较提案");
  await page.getByText("设为所有工作区的默认 Agent", { exact: true }).click();
  const save = page.getByRole("button", { name: "保存 Agent" });
  await save.click();
  await page.getByText("无法设置默认助手", { exact: true }).waitFor();
  assert.equal(await name.inputValue(), "会议分析");
  await save.click();
  await name.waitFor({ state: "detached" });
  assert.deepEqual(writes, ["create", "default", "update", "default"]);
  assert.equal(await page.getByLabel("Global default Agent").inputValue(), "7");
});

test("model capabilities and Skill text survive a rejected save", async () => {
  await page.goto(base + "/settings/agents");
  await page.getByRole("button", { name: "Add model" }).click();
  const model = page.getByPlaceholder("Exact model ID");
  await model.fill("review-model");
  let attempts = 0;
  await page.route("**/api/admin/model-capabilities", (route) => {
    const capability = route.request().postDataJSON();
    if (++attempts === 1)
      return route.fulfill({ status: 400, json: { error: "模型保存失败" } });
    data.modelCapabilities = [capability];
    return route.fulfill({ json: { success: true, capability } });
  });
  const save = page.getByRole("button", { name: "Save", exact: true });
  await save.click();
  await page.getByText("模型保存失败", { exact: true }).waitFor();
  assert.equal(await model.inputValue(), "review-model");
  await save.click();
  await page.getByText("review-model", { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(base + "/settings/agents/skills");
  await page.getByRole("button", { name: "新建 Skill" }).click();
  const markdown = page.locator("form textarea");
  const text = "---\nname: review\ndescription: 会议提案\n---\n比较两份提案";
  await markdown.fill(text);
  let skillAttempts = 0;
  await page.route("**/api/admin/predefined-agent-skills", (route) => {
    assert.equal(route.request().postDataJSON().skillMd, text);
    if (++skillAttempts === 1)
      return route.fulfill({ status: 400, json: { error: "Skill 保存失败" } });
    data.skills = [
      { id: 8, name: "review", description: "会议提案", valid: true },
    ];
    return route.fulfill({ json: { success: true } });
  });
  const saveSkill = page.getByRole("button", { name: "保存 Skill" });
  await saveSkill.click();
  await page.getByText("Skill 保存失败", { exact: true }).waitFor();
  assert.equal(await markdown.inputValue(), text);
  await saveSkill.click();
  await markdown.waitFor({ state: "detached" });
  await page.getByText("review", { exact: true }).waitFor();
});
