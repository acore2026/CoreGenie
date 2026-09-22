async (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/__plan-preview", (route) => route.fulfill({ contentType: "text/html", body: `<!doctype html><html><body style="margin:0"><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const ReactModule=await import('/node_modules/.vite/deps/react.js');
    const React=ReactModule.default;
    const ReactDOMModule=await import('/node_modules/.vite/deps/react-dom.js');
    const ReactDOM=ReactDOMModule.default;
    await import('/src/i18n.js');await import('/src/index.css');
    const {default:Timeline}=await import('/src/components/WorkspaceChat/ChatContainer/ChatHistory/ReActMessageTimeline/index.jsx');
    const root=ReactDOM.createRoot(document.getElementById('root'));
    window.renderPlan=(state)=>root.render(React.createElement('div',{style:{maxWidth:920,margin:'48px auto',padding:20}},React.createElement(Timeline,{runId:'preview',runState:state,messageId:'preview',fallbackText:'正在整理提案中的技术差异。'})));
    window.planReady=true;
  </script></body></html>` }));
  await page.goto("http://127.0.0.1:7870/__plan-preview");
  await page.waitForFunction(() => window.planReady);
  const tasks = ["确认会议与提案范围", "下载并转换提案", "对比公司技术观点", "检查引用与会议结果", "生成中文分析报告"].map((title, i) => ({id:`step-${i}`,title,status:i<2?"completed":i===2?"running":"pending",budget:{planOrder:i}}));
  const state = {status:"running",tasks,toolExecutions:[{call_id:"tool",tool_id:"filesystem.read",status:"running",startedAt:new Date(Date.now()-65000).toISOString(),result_summary:"读取会议材料并整理提案中的技术差异"}],messageParts:[{id:"text",type:"text",text:"已整理好本次会议的提案，正在逐篇对比公司主张。"},{id:"tools",type:"toolGroup",callIds:["tool"]}]};
  for (const width of [1440,390]) for (const theme of ["light","dark"]) {
    await page.setViewportSize({width,height:960});
    await page.evaluate(({theme,state})=>{document.documentElement.dataset.theme=theme;document.documentElement.className=theme;document.body.style.background='var(--theme-bg-primary)';window.renderPlan(state);},{theme,state});
    await page.getByRole("region",{name:"任务计划"}).waitFor();
    if (await page.locator(".dsh-task-number").allTextContents().then(x=>x.join(',')) !== '1,2,3,4,5') throw new Error('Missing ordered task numbers');
    if (await page.locator('[data-agent-working]').count() !== 1) throw new Error('Missing persistent spinner');
    if (!await page.locator('[data-agent-working] svg').evaluate(el=>getComputedStyle(el).animationName.includes('spin'))) throw new Error('Spinner is not animated');
    if (await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw new Error('Horizontal overflow');
    await page.screenshot({path:`/tmp/react-plan-${width}-${theme}.png`});
    await page.getByRole('button',{name:/任务计划/}).click();
    if (await page.locator('.dsh-task-number').count()) throw new Error('Collapse failed');
    await page.getByRole('button',{name:/任务计划/}).click();
  }
  await page.getByRole('button',{name:/调用详情/}).click();
  if (await page.locator('.dsh-tool-entry').count()!==1) throw new Error('Tool expansion failed');
  await page.getByText('读取文件').first().waitFor();
  if (!await page.locator('.dsh-tool-entry').innerText().then(x=>x.includes('分'))) throw new Error('Missing elapsed time');
  await page.getByRole('button',{name:/调用详情/}).click();
  await page.evaluate(state=>window.renderPlan({...state,toolExecutions:[{...state.toolExecutions[0],status:'failed',completedAt:new Date().toISOString(),error:'无法读取文档，请检查文件是否可用。'}]}),state);
  await page.locator('.dsh-tool-group[data-status="failed"]').waitFor();
  await page.getByText('无法读取文档，请检查文件是否可用。').waitFor();
  await page.screenshot({path:'/tmp/react-tools-failed-mobile.png'});
  await page.evaluate(state=>window.renderPlan({...state,toolExecutions:[{...state.toolExecutions[0],status:'completed'}]}),state);
  await page.getByText('已调用 1 个工具').count();
  if (await page.locator('[data-agent-working]').count()!==1) throw new Error('Spinner stopped after tool completion');
  for (const status of ['waiting_for_input','waiting_for_approval','completed','failed','cancelled','partial']) {
    await page.evaluate(({state,status})=>window.renderPlan({...state,status}),{state,status});
    await page.waitForFunction(()=>!document.querySelector('[data-agent-working]'));
  }
  if(errors.length) throw new Error(errors.join('\n'));
  return {widths:[1440,390],themes:['light','dark'],checks:'numbering, collapse, persistent spinner, waiting and terminal states, no overflow'};
}
