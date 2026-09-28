async (page) => {
  let prefs = {lightweight_model_provider:'generic-openai',lightweight_model_name:'fast-model'};
  let failLoad=false, failSave=false;
  const writes=[];
  await page.route('**/admin/system-preferences-for?*', route => route.fulfill({json:failLoad?{error:'failed'}:{settings:prefs}}));
  await page.route('**/admin/system-preferences', route => {
    const body=route.request().postDataJSON(); writes.push(body);
    if(!failSave) prefs=body;
    return route.fulfill({status:failSave?400:200,json:failSave?{success:false,error:'保存失败测试'}:{success:true}});
  });
  await page.route('**/__lightweight-preview', route=>route.fulfill({contentType:'text/html',body:`<!doctype html><html><body style="margin:0"><main id="root"></main><script type="module">
    import RefreshRuntime from '/@react-refresh';
    RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;
    const React=(await import('/node_modules/.vite/deps/react.js')).default;
    const ReactDOM=(await import('/node_modules/.vite/deps/react-dom.js')).default;
    await import('/src/i18n.js');await import('/src/index.css');
    const Component=(await import('/src/pages/GeneralSettings/LLMPreference/LightweightModel/index.jsx')).default;
    window.submissions=0;
    ReactDOM.createRoot(document.getElementById('root')).render(React.createElement('form',{onSubmit:e=>{e.preventDefault();window.submissions++},style:{maxWidth:720,margin:'32px auto',padding:20}},React.createElement(Component)));
  </script></body></html>`}));
  await page.goto('http://127.0.0.1:7870/__lightweight-preview');
  const model=page.getByRole('textbox');const provider=page.getByRole('combobox');const save=page.getByRole('button',{name:'保存轻量模型'});
  await model.waitFor();await page.waitForFunction(()=>document.querySelector('input')?.value==='fast-model');
  for(const width of [1440,390]) for(const theme of ['light','dark']) {
    await page.setViewportSize({width,height:900});
    await page.evaluate(theme=>{document.documentElement.dataset.theme=theme;document.documentElement.className=theme;document.body.style.background='var(--theme-bg-primary)'},theme);
    if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)) throw Error('Horizontal overflow');
    await page.screenshot({path:'/tmp/lightweight-'+width+'-'+theme+'.png'});
  }
  await model.fill('new-fast-model');await model.press('Enter');
  await save.click();await page.waitForFunction(()=>document.querySelector('button')?.disabled);
  if(writes.at(-1)?.lightweight_model_name!=='new-fast-model')throw Error('Wrong save payload');
  if(await page.evaluate(()=>window.submissions)!==0)throw Error('Submitted parent form');
  await page.reload();await page.waitForFunction(()=>document.querySelector('input')?.value==='new-fast-model');
  failSave=true;await model.fill('retry-model');await save.click();
  await page.waitForFunction(()=>!document.querySelector('fieldset')?.disabled);
  if(await save.isDisabled())throw Error('Failed save cannot retry');
  failSave=false;await provider.selectOption('');if(!await model.isDisabled())throw Error('Inherited model editable');await save.click();
  failLoad=true;await page.reload();await page.getByRole('alert').waitFor();
  failLoad=false;await page.getByRole('button',{name:'重新加载'}).click();await provider.waitFor();
  return {widths:[1440,390],themes:['light','dark'],checks:'load, save, retained config, inherit, failed save, failed load retry, no parent submit, no overflow'};
}
