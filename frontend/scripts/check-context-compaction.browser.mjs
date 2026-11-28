import assert from "node:assert/strict";
import { chromium } from "playwright";

const base = process.env.CONTEXT_PREVIEW_URL || "http://127.0.0.1:7876";
const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH } : {}) });
const page = await browser.newPage();
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
let enabled = true;
let failLoad = false;
let failSave = false;
const writes = [];
await page.route("**/setup-complete", (route) =>
  route.fulfill({
    status: failLoad ? 500 : 200,
    json: failLoad ? {} : { results: { AgentContextCompactionEnabled: enabled } },
  })
);
await page.route("**/admin/system-preferences", async (route) => {
  const body = route.request().postDataJSON();
  writes.push(body);
  await new Promise((resolve) => setTimeout(resolve, 150));
  if (!failSave) enabled = body.agent_context_compaction_enabled === "true";
  await route.fulfill({
    status: failSave ? 400 : 200,
    json: { success: !failSave, ...(failSave ? { error: "test failure" } : {}) },
  });
});
await page.route("**/__context-preview", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: `<!doctype html><html><body style="margin:0"><main id="root"></main><script type="module">
      import RefreshRuntime from '/@react-refresh';
      RefreshRuntime.injectIntoGlobalHook(window);
      window.$RefreshReg$=()=>{}; window.$RefreshSig$=()=>type=>type;
      window.__vite_plugin_react_preamble_installed__=true;
      const React=(await import('/node_modules/.vite/deps/react.js')).default;
      const ReactDOM=(await import('/node_modules/.vite/deps/react-dom.js')).default;
      await import('/src/i18n.ts'); await import('/src/index.css');
      const Component=(await import('/src/pages/Admin/Agents/AgentSkillSettings/ContextCompaction.tsx')).default;
      window.submissions=0;
      ReactDOM.createRoot(document.getElementById('root')).render(
        React.createElement('form',{
          onSubmit:e=>{e.preventDefault();window.submissions++},
          style:{maxWidth:500,margin:'24px auto',padding:16}
        },React.createElement(Component))
      );
    </script></body></html>`,
  })
);
try {
  await page.goto(base + "/__context-preview");
  const checkbox = page.getByRole("checkbox", { name: /自动整理长任务上下文/ });
  await checkbox.waitFor();
  await page.waitForFunction(() => !document.querySelector("input").disabled);
  assert.equal(await checkbox.isChecked(), true);
  assert.equal(writes.length, 0, "mount must never change the setting");

  for (const width of [1440, 390]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 800 });
      await page.evaluate((theme) => {
        document.documentElement.dataset.theme = theme;
        document.documentElement.className = theme;
        document.body.style.background = "var(--theme-bg-primary)";
      }, theme);
      assert.equal(
        await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
        false,
        "horizontal overflow"
      );
      await page.screenshot({ path: "/tmp/coregenie-context-" + width + "-" + theme + ".png" });
    }
  }

  await checkbox.focus();
  await page.keyboard.press("Space");
  await page.waitForFunction(() => document.querySelector("input").disabled);
  await page.waitForFunction(() => !document.querySelector("input").disabled);
  assert.equal(await checkbox.isChecked(), false);
  assert.deepEqual(writes.at(-1), { agent_context_compaction_enabled: "false" });
  assert.equal(await page.evaluate(() => window.submissions), 0);

  await page.reload();
  await page.waitForFunction(() => document.querySelector("input") && !document.querySelector("input").disabled);
  assert.equal(await checkbox.isChecked(), false);
  failSave = true;
  await page.getByText("自动整理长任务上下文", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector("input").disabled);
  await page.waitForFunction(() => !document.querySelector("input").disabled);
  assert.equal(await checkbox.isChecked(), false, "failed save must preserve checked state");
  assert.equal(enabled, false);

  failSave = false;
  await page.getByText("自动整理长任务上下文", { exact: true }).click();
  await page.waitForFunction(() => document.querySelector("input").checked);
  assert.equal(enabled, true);
  await page.getByText("自动整理长任务上下文", { exact: true }).click();
  await page.waitForFunction(() => !document.querySelector("input").checked);
  assert.equal(enabled, false);

  failLoad = true;
  await page.reload();
  await page.getByRole("alert").waitFor();
  assert.equal(await checkbox.isDisabled(), true);
  failLoad = false;
  await page.getByRole("button", { name: "重新加载" }).click();
  await page.waitForFunction(() => !document.querySelector("input").disabled);
  assert.equal(await checkbox.isChecked(), false);
  assert.equal(await page.evaluate(() => window.submissions), 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({
    checks: ["default-on", "no-write-on-mount", "keyboard", "saving-disabled", "save", "reload", "failed-save", "disable", "failed-load-retry", "no-parent-submit", "no-page-errors", "responsive"],
    widths: [1440, 390], themes: ["light", "dark"], finalEnabled: enabled,
  }));
} finally {
  await browser.close();
}
