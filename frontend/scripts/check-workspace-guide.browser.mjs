import assert from "node:assert/strict";
import fs from "node:fs";
import { chromium } from "playwright";
const name="__workspace-guide-preview-"+process.pid+".jsx";
const path=new URL("../src/"+name,import.meta.url);
fs.writeFileSync(path,"import React from \"react\";\nimport { createRoot } from \"react-dom/client\";\nimport { MemoryRouter, useLocation } from \"react-router-dom\";\nimport \"./i18n\";\nimport \"./index.css\";\nimport { QueryClient, QueryClientProvider } from \"@tanstack/react-query\";\nimport { AuthContext } from \"./AuthContext\";\nimport CreateWorkspaceGuide from \"./components/CreateWorkspaceGuide\";\nfunction App() {const location=useLocation();return <><output data-testid=\"location\">{location.pathname}</output><main style={{maxWidth:560,margin:\"40px auto\",padding:20}}><CreateWorkspaceGuide /></main></>}\ncreateRoot(document.getElementById(\"root\")).render(<QueryClientProvider client={new QueryClient()}><AuthContext.Provider value={{store:{user:{id:1,role:\"default\",username:\"test\"}},actions:{}}}><MemoryRouter><App /></MemoryRouter></AuthContext.Provider></QueryClientProvider>);",{flag:"wx"});
const browser=await chromium.launch({headless:true,executablePath:"/root/.cache/ms-playwright/chromium-1248/chrome-linux64/chrome"});
const page=await browser.newPage();
const errors=[], writes=[];
let fail=true;
page.on("pageerror",e=>errors.push(e.message));
await page.route("**/user/sidebar-preferences",r=>r.fulfill({json:{preferences:{groups:{groups:[],collapsed:{}},favorites:{workspaces:[],threads:[]}},globalGroups:[]}}));
await page.route("**/workspace/new/members",r=>r.fulfill({json:{users:[]}}));
await page.route("**/workspace/new",r=>{writes.push(r.request().postDataJSON());return r.fulfill({json:fail?{workspace:null,message:"创建失败，请重试"}:{workspace:{id:1,slug:"first-workspace",name:"我的工作区"},message:null}})});
await page.route("**/__workspace-guide-preview",r=>r.fulfill({contentType:"text/html",body:`<!doctype html><html><body style="margin:0"><div id="root"></div><script type="module">import RefreshRuntime from '/@react-refresh';RefreshRuntime.injectIntoGlobalHook(window);window.$RefreshReg$=()=>{};window.$RefreshSig$=()=>type=>type;window.__vite_plugin_react_preamble_installed__=true;await import("/src/${name}");</script></body></html>`}));
try {
 await page.goto("http://127.0.0.1:7876/__workspace-guide-preview");
 await page.getByRole("button",{name:"创建工作区",exact:true}).waitFor();
 for(const width of [1440,390]) for(const theme of ["light","dark"]){
  await page.setViewportSize({width,height:900});
  await page.evaluate(t=>{document.documentElement.className=t;document.documentElement.dataset.theme=t},theme);
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
  await page.screenshot({path:`/tmp/coregenie-workspace-guide-${width}-${theme}.png`});
 }
 assert.equal(writes.length,0);
 await page.getByRole("button",{name:"创建工作区",exact:true}).click();
 await page.locator("#new-workspace-name").waitFor();
 assert.equal(writes.length,0);
 await page.keyboard.press("Escape");
 await page.locator("#new-workspace-name").waitFor({state:"detached"});
 assert.equal(writes.length,0);
 await page.getByRole("button",{name:"创建工作区",exact:true}).click();
 await page.locator("#new-workspace-name").fill("我的工作区");
 await page.getByRole("dialog").locator('button[type="submit"]').click();
 await page.getByText("创建失败，请重试",{exact:true}).waitFor();
 assert.equal(await page.locator("#new-workspace-name").inputValue(),"我的工作区");
 await page.screenshot({path:"/tmp/coregenie-workspace-guide-modal.png"});
 fail=false;
 await page.getByRole("dialog").locator('button[type="submit"]').click();
 await page.getByTestId("location").filter({hasText:"/workspace/first-workspace"}).waitFor();
 assert.equal(writes.length,2);
 assert.equal(writes[1].accessMode,"private");
 assert.equal(writes[1].groupGlobal,false);
 assert.deepEqual(errors,[]);
 console.log("PASS: normal user, desktop/mobile light/dark, explicit creation, cancel, failure/retry and navigation");
} finally {await browser.close();fs.unlinkSync(path)}
