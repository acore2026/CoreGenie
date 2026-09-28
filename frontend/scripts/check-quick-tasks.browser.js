async (page) => {
  const user = { id: 7, username: "测试用户", role: "admin" };
  const tasks = [];
  const errors = [];
  let listRequests = 0;
  let bindingSaves = 0;
  const agents = [{ id: 1, name: "测试助手", systemPrompt: "测试", skillIds: [], quickTaskIds: [], tools: [], enabled: true, runtimeKey: "governed-agent", runtimeConfig: {} }];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.context().addInitScript((user) => {
    localStorage.setItem("anythingllm_user", JSON.stringify(user));
    localStorage.setItem("anythingllm_authToken", "test-token");
    localStorage.setItem("anythingllm_seen_help_intro", "true");
    localStorage.setItem("theme", "light");
  }, user);
  await page.context().route("**/api/**", async (route) => {
    const request = route.request();
    const path = request.url().split("/api")[1].split("?")[0];
    let body = {};
    if (path === "/ping") body = { online: true };
    else if (path === "/onboarding") body = { onboardingComplete: true };
    else if (path === "/setup-complete") body = { results: { MultiUserMode: true, RequiresAuth: true, LLMProvider: "openai", LLMModel: "test" } };
    else if (path === "/system/refresh-user") body = { success: true, user };
    else if (path === "/system/check-token") body = { valid: true };
    else if (path.includes("preferences")) body = { settings: {} };
    else if (path === "/admin/predefined-agents") {
      listRequests++;
      body = { agents, skills: [], quickTasks: tasks, tools: [], runtimes: [{ key: "governed-agent", label: "测试" }], modelCapabilities: [] };
    } else if (path === "/admin/predefined-agents/1" && request.method() === "PUT") {
      Object.assign(agents[0], request.postDataJSON());
      bindingSaves++;
      body = { success: true, agent: agents[0] };
    }
    else if (path === "/workspaces" || path === "/admin/workspaces") body = { workspaces: [] };
    else if (path === "/predefined-agents") body = { agents: [], defaultAgentId: null };
    else if (path.startsWith("/admin/predefined-quick-tasks")) {
      const input = request.postDataJSON();
      const definition = { ...input.definition, id: input.key, title: input.title };
      if (path.endsWith("validate")) body = { success: true, definition };
      else {
        const task = { ...input, definition, id: 1 };
        tasks.splice(0, tasks.length, task);
        body = { success: true, quickTask: task };
      }
    } else if (path.includes("logo") || path.includes("pfp")) return route.fulfill({ status: 204 });
    else if (path.includes("footer")) body = { footerData: [] };
    return route.fulfill({ status: 200, json: body });
  });
  const navigate = async (path) => {
    await page.evaluate((path) => {
      window.history.pushState({}, "", path);
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, path);
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 960 });
    await page.goto("http://127.0.0.1:7870/settings/agents/quick-tasks");
    await page.getByRole("button", { name: "新建快捷任务", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "新建快捷任务" });
    await dialog.getByLabel("标题", { exact: true }).fill("浏览器测试任务");
    await dialog.getByLabel(/固定标识/).fill("browser-task");
    await dialog.getByLabel(/任务说明/).fill("请根据输入分析资料。");
    await dialog.getByRole("button", { name: "检查并试填" }).click();
    await dialog.getByRole("button", { name: "浏览器测试任务", exact: true }).click();
    const preview = page.getByRole("dialog", { name: "浏览器测试任务", exact: true });
    await preview.getByLabel(/你希望完成什么任务/).fill("检查资料");
    await preview.getByRole("button", { name: /生成/ }).click();
    await preview.getByRole("button", { name: /草稿/ }).click();
    if (!(await dialog.getByLabel("生成的提示词（仅预览）").inputValue()).includes("检查资料")) throw new Error("Preview failed");
    const overflow = await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 2);
    if (overflow) throw new Error("Editor horizontal overflow");
    await page.screenshot({ path: `/tmp/quick-tasks-${width}.png` });
    await dialog.getByRole("button", { name: "保存快捷任务", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    await page.getByRole("button", { name: /浏览器测试任务/ }).click();
    const edit = page.getByRole("dialog", { name: "编辑快捷任务" });
    if (!(await edit.getByLabel(/固定标识/).isDisabled())) throw new Error("Key not immutable");
    await edit.getByLabel("标题", { exact: true }).fill("编辑后的任务");
    await edit.getByRole("button", { name: "保存快捷任务", exact: true }).click();
    await edit.waitFor({ state: "hidden" });
    const previousRequests = listRequests;
    // Keep the page mounted to catch stale data when only the settings view changes.
    await navigate("/settings/agents/skills");
    await page.getByRole("button", { name: "新建 Skill", exact: true }).waitFor();
    await navigate("/settings/agents");
    await page.getByRole("button", { name: /测试助手/ }).click();
    const binding = page.getByRole("button", { name: /编辑后的任务/ });
    await binding.waitFor();
    if (listRequests < previousRequests + 2) throw new Error("Settings navigation did not refresh");
    await binding.click();
    await page.getByRole("button", { name: "保存 Agent", exact: true }).click();
    await page.getByRole("button", { name: "保存 Agent", exact: true }).waitFor({ state: "hidden" });
    if (!agents[0].quickTaskIds.includes(1)) throw new Error("Binding was not saved");
    await navigate("/settings/agents/quick-tasks");
    await page.getByRole("button", { name: /编辑后的任务/ }).waitFor();
    agents[0].quickTaskIds = [];

  }
  if (bindingSaves !== 2) throw new Error("Expected binding saves at both widths");
  if (errors.length) throw new Error(errors.join("\n"));
  return { widths: [1440, 390], checks: "create, preview, save, edit, binding save, settings view refresh, no page errors" };
}
