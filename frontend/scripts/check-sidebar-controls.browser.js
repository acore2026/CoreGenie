// Run in a dedicated Playwright CLI session against the dev server on port 7870.
// All API requests are mocked; this test does not modify server data.
async (page) => {
  const errors = [];
  const user = { id: 7, username: "管理员", role: "admin" };
  const workspaces = [
    { id: 1, slug: "mine", name: "我的工作区", userIds: [7] },
    { id: 2, slug: "other", name: "其他人的工作区", userIds: [8] },
    { id: 3, slug: "shared", name: "共同工作区", userIds: [7, 8] },
  ];

  const setupContext = async (context) => {
    await context.addInitScript(({ user }) => {
      localStorage.clear();
      localStorage.setItem("theme", "light");
      localStorage.setItem("anythingllm_seen_help_intro", "true");
      localStorage.setItem("anythingllm_user", JSON.stringify(user));
      localStorage.setItem("anythingllm_authToken", "browser-test-token");
    }, { user });
    await context.route("**/api/**", async (route) => {
      const path = route.request().url().split("/api")[1].split("?")[0];
      let body = {};
      if (path === "/ping") body = { online: true };
      else if (path === "/onboarding") body = { onboardingComplete: true };
      else if (path === "/setup-complete")
        body = {
          results: {
            MultiUserMode: true,
            RequiresAuth: true,
            LLMProvider: "openai",
            LLMModel: "gpt-4.1-mini",
          },
        };
      else if (path === "/system/refresh-user")
        body = { success: true, user };
      else if (path === "/system/check-token") body = { valid: true };
      else if (path === "/system/pfp/7")
        return route.fulfill({ status: 204 });
      else if (path === "/workspaces") body = { workspaces };
      else if (path === "/admin/workspaces") body = { workspaces };
      else if (
        workspaces.some((workspace) => path === `/workspace/${workspace.slug}`)
      )
        body = {
          workspace: workspaces.find(
            (workspace) => path === `/workspace/${workspace.slug}`
          ),
        };
      else if (path.endsWith("/parsed-files"))
        body = { files: [], contextWindow: 32000, currentContextTokenCount: 0 };
      else if (path.endsWith("/suggested-messages"))
        body = { suggestedMessages: [] };
      else if (path.endsWith("/is-agent-command-available"))
        body = { showAgentCommand: false };
      else if (path.endsWith("/files")) body = { entries: [], path: "" };
      else if (path.endsWith("/threads"))
        body = { threads: [], defaultThreadChatCount: 0 };
      else if (path === "/predefined-agents")
        body = {
          agents: [
            {
              id: 1,
              name: "通用助手",
              isBuiltinDefault: true,
              welcomeMessage: "今天想完成什么？",
              examplePrompts: [],
            },
          ],
          defaultAgentId: 1,
        };
      else if (path.includes("logo"))
        return route.fulfill({ status: 204 });
      else if (path.includes("footer")) body = { footerData: [] };
      await route.fulfill({ status: 200, json: body });
    });
  };

  await setupContext(page.context());

  page.on("pageerror", (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto("http://127.0.0.1:7870/");

  const workspaceRows = page.locator(
    '#workspace-navigation [role="list"][aria-label="工作区"] > [role="listitem"]'
  );
  await page.getByRole("button", { name: "新建", exact: true }).waitFor();
  if ((await workspaceRows.count()) !== 3)
    throw new Error("管理员视图默认应显示 3 个工作区");

  const mark = page.locator('a[aria-label="返回首页"] img').first();
  const wordmark = page.getByText("CoreGenie", { exact: true }).first();
  const [markBox, wordmarkBox] = await Promise.all([
    mark.boundingBox(),
    wordmark.boundingBox(),
  ]);
  const markCenter = markBox.y + markBox.height / 2;
  const wordmarkCenter = wordmarkBox.y + wordmarkBox.height / 2;
  if (Math.abs(markCenter - wordmarkCenter) > 1)
    throw new Error("Logo 图标与文字没有垂直居中");

  await page.getByRole("button", { name: "新建", exact: true }).click();
  await page.getByRole("menuitem", { name: /新建对话/ }).waitFor();
  await page.getByRole("menuitem", { name: /新建工作区/ }).waitFor();
  await page.keyboard.press("Escape");

  const userButton = page.getByRole("button", { name: "帐户", exact: true });
  const helpLink = page.getByRole("link", { name: /帮助/ }).first();
  const [userBox, helpBox] = await Promise.all([
    userButton.boundingBox(),
    helpLink.boundingBox(),
  ]);
  if (userBox.y >= helpBox.y) throw new Error("用户入口没有放在帮助上方");

  await userButton.click();
  const adminToggle = page.getByRole("menuitemcheckbox", {
    name: /管理员视图/,
  });
  await adminToggle.waitFor();
  if ((await adminToggle.getAttribute("aria-checked")) !== "true")
    throw new Error("管理员视图默认未开启");
  const menuBox = await adminToggle.locator('xpath=ancestor::*[@role="menu"]').boundingBox();
  if (menuBox.y >= userBox.y) throw new Error("底部用户菜单没有向上展开");
  await adminToggle.click();
  await page.waitForFunction(() =>
    document.querySelector('[role="menuitemcheckbox"]')?.getAttribute("aria-checked") === "false"
  );
  await page.waitForFunction(() =>
    document.querySelectorAll(
      '#workspace-navigation [role="list"][aria-label="工作区"] > [role="listitem"]'
    ).length === 2
  );

  const scrollbar = await page.evaluate(() => {
    const lightProbe = document.createElement("div");
    lightProbe.className = "show-scrollbar";
    document.body.append(lightProbe);
    const value = getComputedStyle(lightProbe).scrollbarColor;
    lightProbe.remove();
    return value;
  });
  if (!scrollbar.includes("rgba(15, 23, 42, 0.16)"))
    throw new Error(`对话滚动条颜色不正确：${scrollbar}`);

  await page.screenshot({
    path: "/tmp/sidebar-controls-light.png",
    animations: "disabled",
  });
  const mobile = await page.context().browser().newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  });
  await setupContext(mobile);
  const mobilePage = await mobile.newPage();
  mobilePage.on("pageerror", (error) => errors.push(error.message));
  await mobilePage.goto("http://127.0.0.1:7870/");
  await mobilePage.getByRole("button", { name: "展开侧栏" }).click();
  const drawer = mobilePage.locator("dialog[open]");
  await drawer.getByRole("button", { name: "新建", exact: true }).waitFor();
  await drawer.getByRole("button", { name: "帐户", exact: true }).waitFor();
  const drawerSize = await drawer.evaluate((element) => ({
    clientWidth: element.clientWidth,
    scrollWidth: element.scrollWidth,
  }));
  if (drawerSize.scrollWidth > drawerSize.clientWidth)
    throw new Error("移动端侧栏出现横向溢出");
  await mobilePage.screenshot({
    path: "/tmp/sidebar-controls-mobile.png",
    animations: "disabled",
  });
  await mobile.close();
  if (errors.length) throw new Error(errors.join("; "));
  return {
    logoCenterDelta: Math.abs(markCenter - wordmarkCenter),
    assignedWorkspaceCount: await workspaceRows.count(),
    scrollbar,
  };
}
