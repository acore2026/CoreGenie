// Run from a Playwright CLI session opened on the app origin under test.
// All API requests are mocked; this check does not modify server data.
async (page) => {
  const appOrigin = page.url().match(/^https?:\/\/[^/]+/)?.[0];
  if (!appOrigin)
    throw new Error("The browser session must start on an HTTP app origin");

  const workspaces = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    slug: `workspace-${index + 1}`,
    name: `工作区 ${String(index + 1).padStart(2, "0")}`,
    viewerAccess: "owner",
    documents: [],
    chatMode: "chat",
  }));
  const context = await page.context().browser().newContext({
    viewport: { width: 1440, height: 900 },
  });
  await context.addInitScript(() => {
    localStorage.setItem("theme", "light");
    localStorage.setItem("anythingllm_seen_help_intro", "true");
  });
  await context.route("**/api/**", async (route) => {
    const path = route.request().url().split("/api")[1].split("?")[0];
    const workspace = workspaces.find((item) =>
      path.startsWith(`/workspace/${item.slug}`)
    );
    let body = {};
    if (path === "/ping") body = { online: true };
    else if (path === "/onboarding") body = { onboardingComplete: true };
    else if (path === "/setup-complete")
      body = { results: { MultiUserMode: false, RequiresAuth: false } };
    else if (path === "/workspaces") body = { workspaces };
    else if (workspace && path === `/workspace/${workspace.slug}`)
      body = { workspace };
    else if (path.endsWith("/threads"))
      body = {
        threads: Array.from({ length: 8 }, (_, index) => ({
          id: workspace.id * 100 + index,
          slug: `thread-${index + 1}`,
          name: `${workspace.name} · 对话 ${index + 1}`,
          canModify: true,
        })),
        defaultThreadChatCount: 1,
      };
    else if (path.endsWith("/suggested-messages"))
      body = { suggestedMessages: [] };
    else if (path.endsWith("/chats")) body = { history: [] };
    else if (path.endsWith("/files")) body = { entries: [], path: "" };
    else if (path.endsWith("/parsed-files"))
      body = { files: [], contextWindow: 32000, currentContextTokenCount: 0 };
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
    else if (path.includes("footer")) body = { footerData: [] };
    else if (path.includes("logo"))
      return route.fulfill({ status: 204 });
    else if (path.includes("agent-command"))
      body = { showAgentCommand: false };
    await route.fulfill({ status: 200, json: body });
  });

  const desktopPage = await context.newPage();
  try {
    await desktopPage.goto(`${appOrigin}/workspace/workspace-1`);
    const scrollRegion = desktopPage.locator(
      "#workspace-navigation .overflow-y-auto"
    );
    const target = desktopPage.getByRole("link", {
      name: "工作区 18",
      exact: true,
    });
    await target.waitFor();
    await scrollRegion.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await target.waitFor({ state: "visible" });
    const before = {
      scrollTop: await scrollRegion.evaluate((element) => element.scrollTop),
      targetTop: (await target.boundingBox()).y,
      pageScrollY: await desktopPage.evaluate(() => window.scrollY),
    };

    await target.click();
    await desktopPage.waitForURL("**/workspace/workspace-18");
    await desktopPage
      .getByRole("list", { name: "工作区 18 的对话", exact: true })
      .getByRole("link", { name: "默认对话", exact: true })
      .waitFor();
    await desktopPage.waitForTimeout(500);
    const after = {
      scrollTop: await scrollRegion.evaluate((element) => element.scrollTop),
      targetTop: (await target.boundingBox()).y,
      pageScrollY: await desktopPage.evaluate(() => window.scrollY),
      activeElementId: await desktopPage.evaluate(
        () => document.activeElement?.id || null
      ),
    };
    const targetShift = Math.round(after.targetTop - before.targetTop);
    const sidebarScrollShift = Math.round(after.scrollTop - before.scrollTop);
    if (targetShift !== 0 || sidebarScrollShift !== 0)
      throw new Error(
        `Workspace navigation moved the desktop sidebar: target ${targetShift}px, scroll ${sidebarScrollShift}px`
      );
    if (after.pageScrollY !== before.pageScrollY)
      throw new Error("Workspace navigation moved the desktop page");
    return {
      before,
      after,
      targetShift,
      sidebarScrollShift,
    };
  } finally {
    await context.close();
  }
}
