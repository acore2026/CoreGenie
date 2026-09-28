// Invoke via Playwright CLI with the wizard parsed from the canonical Agent YAML.
// All API calls are mocked; no messages are sent to the live server.
async (page, wizard) => {
  const errors = [];
  let writes = 0;
  let agendaReads = 0;
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
    else if (path === "/3gpp/catalog") {
      if (route.request().url().includes("meeting=")) agendaReads++;
      body = route.request().url().includes("meeting=")
        ? {
            items: [
              {
                value: "ki1",
                label: "KI#1 测试",
                source: "https://www.3gpp.org/ftp/",
              },
            ],
          }
        : {
            meetings: [175, 176, 177].map((n) => ({
              id: "m" + n,
              label: "SA2#" + n,
              year: 2026,
              source: "https://www.3gpp.org/ftp/",
            })),
          };
    } else if (path.includes("logo") || path.includes("pfp"))
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
    const trigger = page.getByRole("button", {
      name: "按议题分析",
      exact: true,
    });
    await trigger.click();
    const dialog = page.getByRole("dialog", { name: "按议题分析" });
    const otherGroups = dialog
      .locator("details")
      .filter({ hasText: "其他工作组" });
    if (!(await dialog.getByText("核心网相关", { exact: true }).isVisible()))
      throw new Error("Core-network group section is missing");
    if (await otherGroups.evaluate((element) => element.open))
      throw new Error("Other groups should be collapsed initially");
    if (await dialog.getByRole("radio", { name: /^SA6/ }).isVisible())
      throw new Error("SA6 should not be promoted as a core-network group");
    await otherGroups.locator("summary").click();
    if (!(await dialog.getByRole("radio", { name: /^SA6/ }).isVisible()))
      throw new Error("Collapsed group choices cannot be expanded");
    await otherGroups.locator("summary").click();
    await dialog.getByRole("button", { name: "生成提示词" }).click();
    if (!(await dialog.getByRole("alert").count()))
      throw new Error("Missing required validation");
    await dialog.getByRole("radio", { name: /^SA2/ }).check();
    await dialog.getByRole("checkbox", { name: /KI#4 · 用户面架构/ }).check();
    await dialog
      .getByRole("checkbox", { name: /KI#2 · 服务化架构框架/ })
      .check();
    if (await dialog.getByText("KI / 议程项", { exact: true }).count())
      throw new Error("Old agenda label remains");
    await dialog
      .getByRole("combobox", { name: "会议", exact: true })
      .selectOption("m176");
    await dialog.getByRole("button", { name: "上一次", exact: true }).click();
    if ((await dialog.getByRole("combobox").inputValue()) !== "m175")
      throw new Error("Previous meeting");
    await dialog.getByRole("button", { name: "下一次", exact: true }).click();
    if (
      !(await dialog
        .getByRole("checkbox", { name: /KI#4 · 用户面架构/ })
        .isChecked())
    )
      throw new Error("Meeting change cleared static KI");
    await dialog.getByRole("radio", { name: /^SA3/ }).check();
    await dialog
      .getByRole("checkbox", { name: /KI#1.1 · 安全域与信任锚/ })
      .check();
    if (
      await dialog.getByRole("checkbox", { name: /KI#4 · 用户面架构/ }).count()
    )
      throw new Error("Previous group KI still visible");
    await dialog.getByRole("radio", { name: /^SA2/ }).check();
    if (
      await dialog
        .getByRole("checkbox", { name: /KI#4 · 用户面架构/ })
        .isChecked()
    )
      throw new Error("Previous group answer retained");
    await dialog.getByRole("checkbox", { name: /KI#4 · 用户面架构/ }).check();
    await dialog
      .getByRole("checkbox", { name: /KI#2 · 服务化架构框架/ })
      .check();
    await dialog
      .getByRole("combobox", { name: "会议", exact: true })
      .selectOption("m176");
    await dialog.getByRole("checkbox", { name: /Huawei/ }).check();
    await dialog.getByRole("checkbox", { name: /方案与技术路线/ }).check();
    await dialog.getByRole("radio", { name: /重点结论与对比表/ }).check();
    await page.screenshot({
      path: `/tmp/agent-wizard-${viewport.width}-form.png`,
    });
    if (await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1))
      throw new Error("Dialog overflows horizontally");
    await dialog.getByRole("button", { name: "生成提示词" }).click();
    const preview = dialog.getByRole("textbox", { name: "检查并修改提示词" });
    const generated = await preview.inputValue();
    if (
      generated.includes("discarded") ||
      !generated.includes("SA2#176") ||
      !generated.includes("KI#4 · 用户面架构") ||
      !generated.includes("KI#2 · 服务化架构框架") ||
      generated.includes("KI#1.1 · 安全域与信任锚")
    )
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
  if (
    await page.getByRole("button", { name: "按议题分析", exact: true }).count()
  )
    throw new Error("Agent without wizard shows a trigger");
  await page
    .getByRole("button", {
      name: "3GPP 提案分析助手 随时可以开始",
      exact: true,
    })
    .click();
  await page.getByRole("button", { name: "按议题分析", exact: true }).click();
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
  await page.screenshot({
    path: "/tmp/agent-wizard-mobile-dark.png",
    animations: "disabled",
  });
  if (writes) throw new Error("Wizard submitted a chat automatically");
  if (agendaReads) throw new Error("Static KI requested a live agenda");
  if (errors.length) throw new Error(errors.join("\n"));
  return { desktop: "passed", mobile: "passed", automaticChatRequests: writes };
};
