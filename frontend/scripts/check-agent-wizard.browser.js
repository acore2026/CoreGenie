// Invoke via Playwright CLI with the wizard parsed from the canonical Agent YAML.
// All API calls are mocked; no messages are sent to the live server.
async (page, wizard) => {
  const errors = [];
  let writes = 0;
  page.on("pageerror", (error) => errors.push(error.message));
  const user = { id: 7, username: "测试用户", role: "admin" };
  await page.context().addInitScript((user) => {
    localStorage.clear();
    localStorage.setItem("theme", "light");
    if (innerWidth < 768)
      localStorage.setItem("anythingllm_sidebar_toggle", "closed");
    localStorage.setItem("anythingllm_seen_help_intro", "true");
    localStorage.setItem("anythingllm_user", JSON.stringify(user));
    localStorage.setItem("anythingllm_authToken", "browser-test-token");
  }, user);
  await page.context().route("**/api/**", async (route) => {
    const path = route.request().url().split("/api")[1].split("?")[0];
    if (/chat|stream-chat/.test(path) && route.request().method() === "POST")
      writes++;
    let body = {};
    if (path === "/ping") body = { online: true };
    else if (path === "/onboarding") body = { onboardingComplete: true };
    else if (path === "/setup-complete")
      body = {
        results: {
          MultiUserMode: true,
          RequiresAuth: true,
          LLMProvider: "openai",
          LLMModel: "test",
        },
      };
    else if (path === "/system/refresh-user") body = { success: true, user };
    else if (path === "/system/check-token") body = { valid: true };
    else if (path === "/workspaces" || path === "/admin/workspaces")
      body = { workspaces: [] };
    else if (path === "/predefined-agents")
      body = {
        agents: [
          { id: 6, name: "3GPP 提案分析助手", enabled: true, wizard },
          { id: 12, name: "通用助手", enabled: true },
        ],
        defaultAgentId: 6,
      };
    else if (path.includes("logo") || path.includes("pfp"))
      return route.fulfill({ status: 204 });
    else if (path.includes("footer")) body = { footerData: [] };
    return route.fulfill({
      status: 200,
      headers: { "x-request-id": "wizard-browser-test" },
      json: body,
    });
  });

  for (const viewport of [
    { width: 1440, height: 1000 },
    { width: 390, height: 844 },
  ]) {
    await page.setViewportSize(viewport);
    await page.goto("http://127.0.0.1:7870/");
    const trigger = page.getByRole("button", { name: "任务向导", exact: true });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "配置提案分析任务" });
    await dialog.getByRole("button", { name: "生成提示词" }).click();
    if (!(await dialog.getByRole("alert").count()))
      throw new Error("Missing required validation");
    await dialog.getByLabel("按会议和议题查找", { exact: true }).check();
    await dialog.getByLabel("其他工作组", { exact: true }).check();
    await dialog
      .getByRole("textbox", { name: "工作组名称", exact: true })
      .fill("discarded group");
    await dialog.getByLabel("已知 TDoc 编号", { exact: true }).check();
    if (
      await dialog
        .getByRole("textbox", { name: "工作组名称", exact: true })
        .count()
    )
      throw new Error("Hidden descendant retained");
    await dialog
      .getByRole("textbox", { name: "TDoc 编号", exact: true })
      .fill("S2-2606085、S2-2606481");
    await dialog.getByLabel("方案与技术路线对比", { exact: true }).check();
    await dialog.getByLabel("公司立场与分歧", { exact: true }).check();
    await dialog.getByLabel("重点结论与对比表", { exact: true }).check();
    await page.screenshot({
      path: `/tmp/agent-wizard-${viewport.width}-form.png`,
    });
    if (await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1))
      throw new Error("Dialog overflows horizontally");
    await dialog.getByRole("button", { name: "生成提示词" }).click();
    const preview = dialog.getByRole("textbox", { name: "检查并修改提示词" });
    const generated = await preview.inputValue();
    if (generated.includes("discarded") || !generated.includes("S2-2606085"))
      throw new Error("Incorrect generated prompt");
    await preview.fill(generated + "\n补充：测试编辑");
    await page.screenshot({
      path: `/tmp/agent-wizard-${viewport.width}-preview.png`,
    });
    await dialog.getByRole("button", { name: "添加到聊天草稿" }).click();
    // Use the composer textarea rather than relying on a version-specific ID.
    const composer = page.locator("#prompt-input-wrapper textarea");
    if (!(await composer.inputValue()).includes("测试编辑"))
      throw new Error("Edited preview was not applied");
    await trigger.click();
    await page.keyboard.press("Escape");
    if (await dialog.isVisible())
      throw new Error("Escape did not close dialog");
    if (!(await trigger.evaluate((el) => el === document.activeElement)))
      throw new Error("Focus did not return to trigger");
    await composer.fill("保留已有草稿");
    await trigger.click();
    await dialog.getByRole("button", { name: "添加到聊天草稿" }).click();
    if (!(await composer.inputValue()).startsWith("保留已有草稿\n\n"))
      throw new Error("Existing draft overwritten");
  }
  await page
    .getByRole("button", { name: "通用助手 随时可以开始", exact: true })
    .click();
  if (await page.getByRole("button", { name: "任务向导", exact: true }).count())
    throw new Error("Agent without wizard shows a trigger");
  await page
    .getByRole("button", {
      name: "3GPP 提案分析助手 随时可以开始",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "任务向导", exact: true }).click();
  if (
    await page
      .getByRole("dialog")
      .getByRole("textbox", { name: "检查并修改提示词" })
      .count()
  )
    throw new Error("Agent switch retained stale preview");
  await page.evaluate(() => {
    document.documentElement.setAttribute("data-theme", "dark");
    document.body.classList.remove("light");
  });
  await page.screenshot({ path: "/tmp/agent-wizard-mobile-dark.png", animations: "disabled" });
  if (writes) throw new Error("Wizard submitted a chat automatically");
  if (errors.length) throw new Error(errors.join("\n"));
  return { desktop: "passed", mobile: "passed", automaticChatRequests: writes };
};
