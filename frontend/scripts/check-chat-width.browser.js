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
    if(innerWidth<768) localStorage.setItem("anythingllm_sidebar_toggle", "closed");
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
    else if (path.endsWith("/chats")) body = { history: [{uuid:"preview-reply",role:"assistant",content:"下面是提案对比结果。\n\n我们会逐项整理公司主张、适用场景和会议结论，并保留引用。",sentAt:Date.now()}] };
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

  const results=[];
  try {
    const app=await context.newPage();
    for (const width of [1440,1024,768,390]) {
      await app.setViewportSize({width,height:960});
      await app.goto(`${appOrigin}/workspace/workspace-1`);
      await app.locator('#chat-history').waitFor();
      await app.locator('#prompt-input-wrapper textarea').waitFor();
      const dimensions=await app.evaluate(()=>({viewport:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,history:document.querySelector('#chat-history > div').getBoundingClientRect().width,input:document.querySelector('#prompt-input-wrapper textarea').getBoundingClientRect().width}));
      if(dimensions.overflow) throw Error('Overflow at '+width);
      if(width===1440 && dimensions.history<800) throw Error('Chat width was not expanded');
      await app.screenshot({path:`/tmp/react-chat-width-${width}.png`});
      results.push(dimensions);
    }
    return results;
  } finally { await context.close(); }
}
