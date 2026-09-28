// Run only in a dedicated Playwright CLI session against the dev server on port 7870.
// playwright-cli -s=workspace-list open http://127.0.0.1:7870
// playwright-cli -s=workspace-list run-code --filename=frontend/scripts/check-workspace-list.browser.js
// All /api requests are mocked; this test does not modify server data.
async page => {
  const results = [], errors = [], counts = {};
  const check = (ok, label) => { if (!ok) throw new Error(label); results.push(label); };
  const workspaces = [
    { id: 1, slug: 'sa2', name: 'SA2 提案分析', viewerAccess: 'owner', documents: [], chatMode: 'chat' },
    { id: 2, slug: 'knowledge', name: '通用知识工作', viewerAccess: 'owner', documents: [], chatMode: 'chat' },
    { id: 3, slug: 'shared', name: '共享资料', viewerAccess: 'public_readonly', documents: [], chatMode: 'chat' },
  ];
  const lists = Object.fromEntries(workspaces.map(w => [w.slug, Array.from({length: 8}, (_, i) => ({ id: w.id * 100 + i, slug: `thread-${i}`, name: `${w.name} · ${['会议材料对比','公司技术路线','提案格式转换','关键议题整理','参考资料清单','技术方案分析','会议结果汇总','历史讨论记录'][i]}`, canModify: w.slug !== 'shared', owner: {username: i % 2 ? '王工' : '李工'} }))]));
  let failShared = true;
  const setup = async context => {
    await context.unroute('**/api/**');
    await context.addInitScript(() => { localStorage.setItem('theme', 'light'); localStorage.setItem('anythingllm_seen_help_intro', 'true'); });
    await context.route('**/api/**', async route => {
      const path = route.request().url().split('/api')[1].split('?')[0];
      const method = route.request().method();
      const ws = workspaces.find(w => path.startsWith(`/workspace/${w.slug}`));
      let body = {};
      if (path === '/ping') return route.fulfill({status:200, headers:{'x-request-id':'workspace-list-test'}, json:{online:true}});
      if (path === '/onboarding') body = { onboardingComplete: true };
      else if (path === '/setup-complete') body = { results: { MultiUserMode: false, RequiresAuth: false } };
      else if (path === '/workspaces') body = { workspaces };
      else if (ws && path === `/workspace/${ws.slug}`) body = { workspace: ws };
      else if (path.endsWith('/threads')) {
        counts[ws.slug] = (counts[ws.slug] || 0) + 1;
        if (ws.slug === 'shared' && failShared) return route.fulfill({status: 503, json: {error: 'test'}});
        body = { threads: lists[ws.slug], defaultThreadChatCount: 1 };
      }
      else if (path.endsWith('/thread/new')) {
        const thread = {id: 999, slug:'created', name:'新建测试对话', canModify: true};
        lists[ws.slug].unshift(thread); body = {thread};
      }
      else if (path.endsWith('/update') && path.includes('/thread/')) {
        const thread = lists[ws.slug].find(t => path.includes(`/thread/${t.slug}/`));
        Object.assign(thread, route.request().postDataJSON()); body = {thread};
      }
      else if (path.endsWith('/update') && ws) { Object.assign(ws, route.request().postDataJSON()); body = {workspace:ws}; }
      else if (method === 'DELETE' && path.includes('/thread/')) { lists[ws.slug] = lists[ws.slug].filter(t => !path.endsWith('/'+t.slug)); }
      else if (method === 'DELETE' && path.endsWith('/thread-bulk-delete')) { const {slugs} = route.request().postDataJSON(); lists[ws.slug] = lists[ws.slug].filter(t=>!slugs.includes(t.slug)); }
      else if (path.endsWith('/suggested-messages')) body = { suggestedMessages: [] };
      else if (path.endsWith('/files')) body = { entries: [], path: '' };
      else if (path.endsWith('/parsed-files')) body = { files: [], contextWindow: 32000, currentContextTokenCount: 0 };
      else if (path.endsWith('/chats')) body = { history: [], thread: lists[ws?.slug]?.find(t => path.includes('/'+t.slug+'/')) };
      else if (path === '/predefined-agents') body = { agents: [{ id:1, name:'通用助手', isBuiltinDefault:true, welcomeMessage:'今天想完成什么？', examplePrompts:[] }], defaultAgentId:1 };
      else if (path.includes('footer')) body = {footerData:[]};
      else if (path.includes('logo')) return route.fulfill({status:204});
      else if (path.includes('agent-command')) body = {showAgentCommand:false};
      await route.fulfill({ status:200, json:body });
    });
  };
  await setup(page.context());
  await page.evaluate(() => localStorage.clear());
  page.on('pageerror', e => errors.push(e.message));
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:7870/');
  const list = name => page.getByRole('list', { name: `${name} 的对话`, exact:true });
  const section = slug => page.locator(`#workspace-threads-${workspaces.find(w=>w.slug===slug).id}`).locator('..');
  await list('SA2 提案分析').waitFor();
  check(await list('SA2 提案分析').getByRole('link').count() === 5, 'Only five rows initially');
  const ownedThread = list('SA2 提案分析').getByRole('link',{name:'SA2 提案分析 · 会议材料对比',exact:true});
  check(await ownedThread.getByText('由 李工 创建',{exact:true}).count()===0, 'Thread owner is hidden in the row');
  await ownedThread.hover();
  await page.getByText('SA2 提案分析 · 会议材料对比 · 由 李工 创建',{exact:true}).waitFor();
  check(true, 'Thread owner is available on hover');
  await page.mouse.move(600, 100);
  check(!counts.knowledge, 'Collapsed workspace is not fetched');
  await page.getByRole('button',{name:'展开 通用知识工作',exact:true}).click();
  await list('通用知识工作').waitFor();
  check(await list('SA2 提案分析').isVisible(), 'Multiple workspaces expand independently');
  const requests = counts.knowledge;
  await page.getByRole('button',{name:'收起 通用知识工作',exact:true}).click();
  await page.getByRole('button',{name:'展开 通用知识工作',exact:true}).click();
  await list('通用知识工作').waitFor();
  check(counts.knowledge === requests, 'Reopening does not refetch');
  await list('SA2 提案分析').getByRole('button',{name:'查看其余 4 条对话'}).click();
  check(await list('SA2 提案分析').getByRole('link').count() === 9, 'Show more exposes all rows');
  await list('SA2 提案分析').getByRole('link',{name:'SA2 提案分析 · 历史讨论记录',exact:true}).click();
  await page.waitForURL('**/workspace/sa2/t/thread-7');
  await page.waitForLoadState('networkidle');
  const showLessButton = list('SA2 提案分析').getByRole('button',{name:'收起对话',exact:true});
  if (await showLessButton.count()) await showLessButton.click({timeout:1000}).catch(()=>{});
  check(await list('SA2 提案分析').getByRole('link',{name:'SA2 提案分析 · 历史讨论记录',exact:true}).isVisible(), 'Active row beyond limit stays visible');
  check(await list('通用知识工作').locator('[aria-current="page"]').count() === 0, 'Other workspace does not share active thread highlight');
  await list('SA2 提案分析').getByRole('link',{name:'SA2 提案分析 · 历史讨论记录',exact:true}).click();
  check(await page.getByRole('textbox',{name:'重命名对话',exact:true}).count() === 0, 'Clicking active thread does not rename');
  await page.getByRole('button',{name:'收起 通用知识工作',exact:true}).click();
  await page.reload();
  await page.getByRole('button',{name:'展开 通用知识工作',exact:true}).waitFor();
  check(true, 'Expansion preference survives reload');
  await section('sa2').hover();
  await section('sa2').getByRole('button',{name:'工作区操作',exact:true}).click();
  await page.getByRole('menuitem',{name:'重命名工作区'}).waitFor();
  await page.keyboard.press('ArrowDown');
  check(await page.getByRole('menuitem').nth(1).evaluate(el=>el===document.activeElement), 'Workspace menu supports arrow navigation');
  await page.keyboard.press('Escape');
  check(await section('sa2').getByRole('button',{name:'工作区操作',exact:true}).evaluate(el=>el===document.activeElement), 'Escape restores menu trigger focus');
  await section('sa2').getByRole('button',{name:'工作区操作',exact:true}).click();
  await page.getByRole('menuitem',{name:'重命名工作区'}).click();
  await page.getByRole('textbox',{name:'重命名工作区'}).fill('SA2 会议研究');
  await page.getByRole('textbox',{name:'重命名工作区'}).press('Enter');
  await section('sa2').getByRole('link',{name:'SA2 会议研究',exact:true}).waitFor();
  check(true, 'Workspace rename via menu works');
  await section('sa2').hover();
  await page.getByRole('button',{name:'在 SA2 会议研究 中新建对话',exact:true}).click();
  await page.waitForURL('**/workspace/sa2/t/created');
  await list('SA2 会议研究').getByRole('link',{name:'新建测试对话',exact:true}).waitFor();
  check(true, 'Header plus creates and opens thread');
  const newRow = list('SA2 会议研究').getByRole('listitem').filter({hasText:'新建测试对话'});
  await newRow.hover();
  await newRow.getByRole('button',{name:'对话操作'}).click();
  await newRow.getByRole('button',{name:'重命名对话'}).click();
  await page.getByRole('textbox',{name:'重命名对话'}).fill('新建后重命名');
  await page.getByRole('textbox',{name:'重命名对话'}).press('Enter');
  await list('SA2 会议研究').getByRole('link',{name:'新建后重命名',exact:true}).waitFor();
  check(true, 'Thread rename works');
  await page.getByRole('button',{name:'展开 共享资料',exact:true}).click();
  await page.getByRole('button',{name:'对话加载失败，点击重试'}).waitFor();
  failShared = false;
  await page.getByRole('button',{name:'对话加载失败，点击重试'}).click();
  await list('共享资料').waitFor();
  check(await section('shared').getByRole('button',{name:'在 共享资料 中新建对话',exact:true}).count()===0, 'Read-only workspace has no create button');
  check(await list('共享资料').getByRole('button',{name:'对话操作'}).count()===0, 'Read-only thread has no mutation menu');
  check(true, 'Failed request can be retried');
  await page.getByRole('button',{name:'收起 共享资料',exact:true}).click();
  await page.screenshot({path:'/tmp/workspace-list-desktop.png'});
  await page.keyboard.press('Meta+.');
  await page.waitForFunction(() => document.documentElement.getAttribute('data-theme') === 'dark' && !document.body.classList.contains('light'));
  await page.screenshot({path:'/tmp/workspace-list-dark.png',animations:'disabled'});
  const mobile = await page.context().browser().newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1'});
  await setup(mobile);
  const mp=await mobile.newPage(); mp.on('pageerror',e=>errors.push(e.message));
  await mp.goto('http://127.0.0.1:7870/');
  await mp.getByRole('button',{name:'展开侧栏',exact:true}).click();
  await mp.getByRole('list',{name:'SA2 会议研究 的对话',exact:true}).waitFor();
  check(await mp.getByRole('button',{name:'在 SA2 会议研究 中新建对话',exact:true}).evaluate(el=>getComputedStyle(el.parentElement).opacity)==='1', 'Touch actions stay visible');
  const mobileDrawerLayout = await mp.locator('dialog[open]').evaluate(el=>({
    rect:el.getBoundingClientRect().toJSON(),
    clientWidth:el.clientWidth,
    scrollWidth:el.scrollWidth,
    computed:{boxSizing:getComputedStyle(el).boxSizing,width:getComputedStyle(el).width,overflowX:getComputedStyle(el).overflowX},
    overflow:[...el.querySelectorAll('*')].map(node=>({node:node.tagName,className:node.className?.baseVal ?? node.className ?? '',right:node.getBoundingClientRect().right})).filter(node=>node.right>el.getBoundingClientRect().right+0.5).slice(0,8)
  }));
  check(mobileDrawerLayout.scrollWidth<=mobileDrawerLayout.clientWidth, `Mobile drawer has no horizontal overflow: ${JSON.stringify(mobileDrawerLayout)}`);
  await mp.getByRole('button',{name:'展开 通用知识工作',exact:true}).click();
  await mp.getByRole('list',{name:'通用知识工作 的对话',exact:true}).waitFor();
  check(await mp.locator('dialog[open]').count()===1, 'Expanding workspace keeps mobile drawer open');
  await mp.screenshot({path:'/tmp/workspace-list-mobile.png'});
  await mp.getByRole('list',{name:'SA2 会议研究 的对话',exact:true}).getByRole('link',{name:'新建后重命名',exact:true}).click();
  await mp.waitForURL('**/workspace/sa2/t/created');
  check(await mp.locator('dialog[open]').count()===0, 'Thread navigation closes mobile drawer');
  await mp.screenshot({path:'/tmp/workbench-mobile-main.png',animations:'disabled'});
  check(errors.length===0, 'No page errors: '+errors.join(';'));
  await mobile.close();
  await page.getByRole('button',{name:'展开 通用知识工作',exact:true}).click();
  await list('通用知识工作').waitFor();
  const other = list('通用知识工作').getByRole('listitem').filter({hasText:'通用知识工作 · 会议材料对比'});
  await other.hover();
  await other.getByRole('button',{name:'对话操作'}).click();
  await page.evaluate(() => { window.confirm = () => true; });
  await other.getByRole('button',{name:'删除对话'}).click();
  await other.waitFor({state:'hidden'});
  check(page.url().endsWith('/workspace/sa2/t/created'), 'Deleting in another workspace keeps current route');
  await list('通用知识工作').hover();
  await page.keyboard.down('Control');
  await list('通用知识工作').getByRole('button',{name:'选择要删除的对话'}).first().click();
  await list('通用知识工作').getByRole('button',{name:'删除所选对话'}).click();
  await page.keyboard.up('Control');
  check(lists.knowledge.length===6, 'Bulk deletion still works');
  const handle=page.getByRole('button',{name:'拖动排序：通用知识工作',exact:true});
  await handle.focus();
  await page.keyboard.press('Space');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Space');
  await page.waitForFunction(()=>document.querySelector('[data-rbd-draggable-id]')?.getAttribute('data-rbd-draggable-id')==='2');
  check(true,'Keyboard workspace reordering is preserved');
  return {results,counts};
}
