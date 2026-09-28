// Run against a local Vite server. Every API request is mocked; no server data is changed.
async (page) => {
  const errors = [];
  const nativeDialogs = [];
  const results = [];
  const directoryRequests = {};
  const mutations = { rename: [] };
  const workspace = {
    id: 1,
    slug: "sa2",
    name: "SA2 提案分析",
    viewerAccess: "owner",
    documents: [],
    chatMode: "chat",
  };
  const user = {
    id: 1,
    username: "测试管理员",
    role: "admin",
    bio: "负责 SA2 提案分析",
    systemPrompt: "回答时优先使用工作区资料。",
  };
  const threads = [
    {
      id: 11,
      slug: "release-20",
      name: "Rel-20 技术路线",
      canModify: true,
    },
  ];
  const listings = {
    "": [
      { name: "研究资料", path: "研究资料", type: "directory", size: 0 },
      { name: "结论.md", path: "结论.md", type: "file", size: 1240 },
    ],
    研究资料: [
      {
        name: "会议材料",
        path: "研究资料/会议材料",
        type: "directory",
        size: 0,
      },
      {
        name: "S2-2600001.txt",
        path: "研究资料/S2-2600001.txt",
        type: "file",
        size: 2048,
      },
    ],
    "研究资料/会议材料": [],
  };

  const check = (condition, label) => {
    if (!condition) throw new Error(label);
    results.push(label);
  };

  await page.context().addInitScript(() => {
    localStorage.clear();
    localStorage.setItem("theme", "light");
    localStorage.setItem("anythingllm_seen_help_intro", "true");
    localStorage.setItem(
      "anythingllm_user",
      JSON.stringify({
        id: 1,
        username: "测试管理员",
        role: "admin",
        bio: "负责 SA2 提案分析",
        systemPrompt: "回答时优先使用工作区资料。",
      })
    );
    localStorage.setItem("anythingllm_authToken", "browser-check-token");
    localStorage.setItem("anythingllm_authTimestamp", String(Date.now()));
  });
  const mockApi = async (route) => {
    const method = route.request().method();
    const apiPart = route.request().url().split("/api")[1];
    const [path, query = ""] = apiPart.split("?");
    const requestedPath = decodeURIComponent(
      (query.match(/(?:^|&)path=([^&]*)/)?.[1] || "").replace(/\+/g, " ")
    );
    let body = {};
    if (path === "/ping") body = { online: true };
    else if (path === "/onboarding") body = { onboardingComplete: true };
    else if (path === "/setup-complete")
      body = { results: { MultiUserMode: true, RequiresAuth: false } };
    else if (path === "/system/refresh-user") body = { success: true, user };
    else if (path === "/system/pfp/1") return route.fulfill({ status: 204 });
    else if (path === "/workspaces") body = { workspaces: [workspace] };
    else if (path === "/workspace/sa2") body = { workspace };
    else if (path === "/workspace/sa2/threads")
      body = { threads, defaultThreadChatCount: 0 };
    else if (path === "/workspace/sa2/files" && method === "PATCH") {
      const payload = route.request().postDataJSON();
      mutations.rename.push(payload);
      const parent = payload.path.split("/").slice(0, -1).join("/");
      const renamedPath = [parent, payload.name].filter(Boolean).join("/");
      const entry = listings[parent].find((item) => item.path === payload.path);
      Object.assign(entry, { name: payload.name, path: renamedPath });
      body = { success: true, entry };
    } else if (path === "/workspace/sa2/files") {
      const directory = requestedPath;
      directoryRequests[directory] = (directoryRequests[directory] || 0) + 1;
      body = { path: directory, entries: listings[directory] || [] };
    } else if (path === "/workspace/sa2/files/preview") {
      const filePath = requestedPath;
      body = {
        name: filePath.split("/").at(-1),
        path: filePath,
        size: 2048,
        kind: "text",
        content: "测试文件内容\n第二行",
      };
    } else if (path.endsWith("/parsed-files"))
      body = { files: [], contextWindow: 32000, currentContextTokenCount: 0 };
    else if (path.endsWith("/suggested-messages"))
      body = { suggestedMessages: [] };
    else if (path.endsWith("/chats")) body = { history: [] };
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
    else if (path.includes("logo")) return route.fulfill({ status: 204 });
    else if (path.includes("footer")) body = { footerData: [] };
    else if (path.includes("agent-command")) body = { showAgentCommand: false };
    await route.fulfill({ status: 200, json: body });
  };
  await page.context().route("**/api/**", mockApi);

  page.on("pageerror", (error) => errors.push(error.message));
  page.on("dialog", async (dialog) => {
    nativeDialogs.push(dialog.message());
    await dialog.dismiss();
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("http://127.0.0.1:8787/workspace/sa2");
  await page.getByText("工作区文件", { exact: true }).waitFor();

  check(directoryRequests[""] === 1, "根目录只加载一次");
  check(directoryRequests["研究资料"] === undefined, "折叠目录不会预加载");
  await page.locator('button[title="研究资料"]').click();
  await page.locator('button[title="S2-2600001.txt"]').waitFor();
  check(directoryRequests["研究资料"] === 1, "目录首次展开时加载");
  await page.locator('button[title="研究资料"]').click();
  await page.locator('button[title="研究资料"]').click();
  check(directoryRequests["研究资料"] === 1, "折叠后再次展开复用缓存");

  await page.locator('button[title="S2-2600001.txt"]').click();
  await page.getByText("测试文件内容", { exact: false }).waitFor();
  check(true, "文件在同一侧栏内预览");
  await page.getByRole("button", { name: "返回文件列表" }).click();
  check(
    await page.locator('button[title="S2-2600001.txt"]').isVisible(),
    "返回后保留目录展开状态"
  );
  const fileTextSize = await page
    .locator('button[title="S2-2600001.txt"]')
    .evaluate((element) => getComputedStyle(element).fontSize);
  check(fileTextSize === "15px", "工作区文件名使用更清晰的 15px 字号");

  const refreshGap = await page
    .getByRole("button", { name: "刷新文件" })
    .evaluate((element) => {
      const header = element.parentElement.getBoundingClientRect();
      const button = element.getBoundingClientRect();
      return header.right - button.right;
    });
  check(refreshGap < 18, "刷新按钮右侧不再保留无用空白");

  await page.locator('button[title="研究资料"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "打开文件夹" }).waitFor();
  check(
    await page.getByRole("menuitem", { name: "打包下载" }).isVisible(),
    "文件夹右键菜单支持打开和打包下载"
  );
  check(
    await page.getByRole("menuitem", { name: "上传到此处" }).isVisible(),
    "文件夹右键菜单保留文件管理操作"
  );
  await page.keyboard.press("Escape");

  await page.locator('button[title="结论.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "预览" }).waitFor();
  check(
    await page.getByRole("menuitem", { name: "下载", exact: true }).isVisible(),
    "文件右键菜单支持预览和下载"
  );
  await page.getByRole("menuitem", { name: "预览" }).click();
  await page.getByText("测试文件内容", { exact: false }).waitFor();
  check(true, "右键菜单可以直接预览文件");
  await page.getByRole("button", { name: "返回文件列表" }).click();
  await page.locator('button[title="结论.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名" }).click();
  const renameInput = page.getByRole("textbox", { name: "重命名 结论.md" });
  await renameInput.fill("新结论.md");
  await renameInput.press("Enter");
  await page.locator('button[title="新结论.md"]').waitFor();
  check(
    mutations.rename.some(
      ({ path, name }) => path === "结论.md" && name === "新结论.md"
    ),
    "文件可在列表内重命名"
  );
  await page.locator('button[title="新结论.md"]').click({ button: "right" });
  await page.getByRole("menuitem", { name: "删除", exact: true }).click();
  const fileDeleteDialog = page.getByRole("alertdialog");
  await fileDeleteDialog.waitFor();
  check(
    await fileDeleteDialog.getByText("删除文件", { exact: true }).isVisible(),
    "文件删除使用主题确认框"
  );
  await fileDeleteDialog.getByRole("button", { name: "取消" }).click();

  const workspaceLink = page.getByRole("link", {
    name: "SA2 提案分析",
    exact: true,
  });
  await workspaceLink.click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名工作区" }).waitFor();
  check(true, "工作区支持右键菜单");
  await page.keyboard.press("Escape");

  const threadLink = page.getByRole("link", {
    name: "Rel-20 技术路线",
    exact: true,
  });
  await threadLink.click({ button: "right" });
  await page.getByRole("menuitem", { name: "重命名对话" }).waitFor();
  check(true, "会话支持右键菜单");
  await page.getByRole("menuitem", { name: "删除对话" }).click();
  const threadDeleteDialog = page.getByRole("alertdialog");
  await threadDeleteDialog.waitFor();
  check(
    await threadDeleteDialog
      .getByText("确定删除这条对话吗？所有聊天记录都会删除，且无法恢复。")
      .isVisible(),
    "会话删除使用主题确认框"
  );
  await threadDeleteDialog.getByRole("button", { name: "取消" }).click();

  const normalTextSize = await page
    .locator("textarea")
    .first()
    .evaluate((element) => getComputedStyle(element).fontSize);
  check(normalTextSize === "15px", "字体大小“一般”调整为 15px");
  check(nativeDialogs.length === 0, "删除操作没有调用浏览器原生对话框");

  const userButton = page.getByRole("button", { name: "账户", exact: true });
  const helpButton = page.getByRole("link", { name: /帮助/ }).last();
  const [userBox, helpBox] = await Promise.all([
    userButton.boundingBox(),
    helpButton.boundingBox(),
  ]);
  check(Math.abs(userBox.y - helpBox.y) < 4, "用户按钮与帮助入口同行");

  await page.screenshot({
    path: "/tmp/coregenie-dsh-files.png",
    animations: "disabled",
  });

  await workspaceLink.click({ button: "right" });
  await page.getByRole("menuitem", { name: "工作区设置" }).click();
  await page.getByRole("link", { name: "聊天设置" }).click();
  const chatSettings = page.locator("#workspace-chat-settings-container");
  await chatSettings.getByText("聊天模式", { exact: true }).waitFor();
  check(
    await chatSettings.getByText("Agent", { exact: true }).isVisible(),
    "工作区聊天模式只显示 Agent"
  );
  check(
    (await chatSettings.getByText("聊天", { exact: true }).count()) === 0 &&
      (await chatSettings.getByText("查询", { exact: true }).count()) === 0,
    "工作区不再显示聊天和查询模式"
  );
  check(
    (await chatSettings
      .getByText("查询模式拒绝响应", { exact: true })
      .count()) === 0,
    "工作区不再显示查询模式拒绝设置"
  );
  check(
    (await chatSettings.locator('input[name="chatMode"]').inputValue()) ===
      "automatic",
    "工作区固定提交 Agent 模式"
  );
  await chatSettings.screenshot({
    path: "/tmp/coregenie-agent-only-chat-settings.png",
    animations: "disabled",
  });

  const workspaceSettingsPanel = page.locator(".workspace-settings-panel");
  const workspaceSettingsBox = await workspaceSettingsPanel.boundingBox();
  const workspaceModalBox = await page
    .locator(".settings-modal-route")
    .boundingBox();
  check(
    workspaceSettingsBox.width <= 1040 && workspaceSettingsBox.height < 900,
    "工作区设置使用居中的悬浮面板"
  );
  check(
    Math.abs(
      workspaceSettingsBox.x + workspaceSettingsBox.width / 2 - 720
    ) < 2 &&
      workspaceModalBox.width === 1440 &&
      workspaceModalBox.height === 1000,
    "工作区设置在缩放后的完整视口中居中"
  );
  check(
    (await page.getByRole("navigation", { name: "工作区设置" }).count()) === 1,
    "工作区设置使用独立导航栏"
  );
  check(
    await page.getByText("工作区文件", { exact: true }).isVisible(),
    "工作区设置打开后保留原工作台"
  );
  const workspaceBackdrop = page.locator(".settings-modal-backdrop");
  check(
    (await workspaceBackdrop.evaluate(
      (element) => getComputedStyle(element).backdropFilter
    )) !== "none",
    "工作区设置背景使用模糊遮罩"
  );
  await page.screenshot({
    path: "/tmp/coregenie-workspace-settings-panel.png",
    animations: "disabled",
  });

  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "账户", exact: true }).click();
  await page.getByRole("menuitem", { name: "管理后台" }).click();
  await page.getByText("界面偏好", { exact: true }).first().waitFor();
  const systemSidebar = page.locator(".system-settings-sidebar");
  const systemContent = systemSidebar.locator("xpath=following-sibling::*[1]");
  const [systemSidebarBox, systemContentBox] = await Promise.all([
    systemSidebar.boundingBox(),
    systemContent.boundingBox(),
  ]);
  check(
    systemSidebarBox.height === systemContentBox.height &&
      systemSidebarBox.x + systemSidebarBox.width === systemContentBox.x,
    "系统设置组合为同一悬浮框"
  );
  check(
    systemSidebarBox.x > 20 &&
      systemContentBox.x + systemContentBox.width < 1420,
    "系统设置与视口边缘保留留白"
  );
  check(
    await page.getByText("工作区文件", { exact: true }).isVisible(),
    "系统设置打开后保留原工作台"
  );
  check(
    (await page
      .locator(".settings-modal-backdrop")
      .evaluate((element) => getComputedStyle(element).backdropFilter)) !==
      "none",
    "系统设置背景使用模糊遮罩"
  );
  const systemSecondaryTextColor = await systemSidebar
    .getByText("人工智能提供商", { exact: true })
    .evaluate((element) => getComputedStyle(element).color);
  check(
    systemSecondaryTextColor === "rgb(85, 91, 98)",
    "浅色设置页辅助文字使用更深的石墨灰"
  );
  check(
    (await systemSidebar.getByText("CoreGenie 移动版").count()) === 0,
    "设置导航不再显示移动设备"
  );
  check(
    (await systemSidebar.evaluate(
      (element) => getComputedStyle(element).animationName
    )) === "none" &&
      (await systemContent.evaluate(
        (element) => getComputedStyle(element).animationName
      )) === "none",
    "设置分类切换不再触发整个窗口动画"
  );
  await page.screenshot({
    path: "/tmp/coregenie-system-settings-panel.png",
    animations: "disabled",
  });

  await page.locator("[data-settings-close]").click();
  await page.getByRole("button", { name: "账户", exact: true }).click();
  await page.getByRole("menuitem", { name: "账户", exact: true }).click();
  const accountDialog = page.getByRole("dialog", { name: "个人设置" });
  await accountDialog.waitFor();
  const accountBox = await accountDialog.boundingBox();
  check(
    accountBox.width <= 860 && accountBox.height <= 720,
    "个人设置使用紧凑悬浮框"
  );
  check(
    await accountDialog.getByText("界面与语音", { exact: true }).isVisible(),
    "个人设置按帐户和偏好分组"
  );
  await page.screenshot({
    path: "/tmp/coregenie-personal-settings-panel.png",
    animations: "disabled",
  });
  await accountDialog.getByRole("button", { name: "取消" }).first().click();

  const mobileContext = await page
    .context()
    .browser()
    .newContext({
      viewport: { width: 390, height: 844 },
      isMobile: true,
      hasTouch: true,
      userAgent:
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
    });
  await mobileContext.addInitScript(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("anythingllm_seen_help_intro", "true");
    localStorage.setItem(
      "anythingllm_user",
      JSON.stringify({
        id: 1,
        username: "测试管理员",
        role: "admin",
      })
    );
    localStorage.setItem("anythingllm_authToken", "browser-check-token");
    localStorage.setItem("anythingllm_authTimestamp", String(Date.now()));
  });
  await mobileContext.route("**/api/**", mockApi);
  const mobilePage = await mobileContext.newPage();
  mobilePage.on("pageerror", (error) => errors.push(error.message));
  await mobilePage.goto("http://127.0.0.1:8787/workspace/sa2");
  await mobilePage.getByRole("button", { name: "打开工作区文件" }).click();
  await mobilePage.getByText("工作区文件", { exact: true }).waitFor();
  await mobilePage.locator('button[title="研究资料"]').click();
  await mobilePage.locator('button[title="S2-2600001.txt"]').waitFor();
  const panelWidth = await mobilePage
    .getByText("工作区文件", { exact: true })
    .locator("xpath=ancestor::div[contains(@class,'h-full')][1]")
    .evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
  check(
    panelWidth.scrollWidth <= panelWidth.clientWidth,
    "移动端文件树没有横向溢出"
  );
  await mobilePage.screenshot({
    path: "/tmp/coregenie-dsh-files-mobile.png",
    animations: "disabled",
  });
  await mobilePage.goto(
    "http://127.0.0.1:8787/workspace/sa2/settings/chat-settings"
  );
  await mobilePage.getByText("工作区设置", { exact: true }).waitFor();
  const mobileSettingsSize = await mobilePage
    .locator(".workspace-settings-panel")
    .evaluate((element) => ({
      clientWidth: element.clientWidth,
      scrollWidth: element.scrollWidth,
    }));
  check(
    mobileSettingsSize.scrollWidth <= mobileSettingsSize.clientWidth,
    "移动端工作区设置没有横向溢出"
  );
  await mobileContext.close();
  check(errors.length === 0, `没有页面错误：${errors.join("；")}`);
  return { results, directoryRequests };
}
