// Install Chromium with `npx playwright install chromium` before the first run.
import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

let server, browser, page, baseURL, artifacts;
const errors = [];
const root = fileURLToPath(new URL("../../", import.meta.url));

async function mockAPI(context) {
  await context.addInitScript(() => localStorage.setItem("theme", "light"));
  await context.route("**/api/**", async (route) => {
    const pathname = new URL(route.request().url()).pathname;
    let body = {};
    if (pathname.endsWith("/onboarding")) body = { onboardingComplete: true };
    else if (pathname.endsWith("/setup-complete"))
      body = { results: { MultiUserMode: false, RequiresAuth: false } };
    else if (pathname.endsWith("/system/refresh-user"))
      body = { success: true, user: null };
    else if (pathname.endsWith("/ping")) body = { online: true };
    else if (pathname.endsWith("/workspaces")) body = { workspaces: [] };
    else if (pathname.includes("logo") || pathname.includes("/pfp"))
      return route.fulfill({ status: 204 });
    else if (pathname.includes("footer")) body = { footerData: [] };
    await route.fulfill({ status: 200, json: body });
  });
}

before(async () => {
  server = await createServer({
    root,
    envFile: false,
    configFile: path.join(root, "vite.config.js"),
    cacheDir: path.join(tmpdir(), "coregenie-proposal-vite-cache"),
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0 },
  });
  await server.listen();
  baseURL = `http://127.0.0.1:${server.httpServer.address().port}`;
  browser = await chromium.launch({
    headless: true,
    ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {}),
  });
  const context = await browser.newContext({
    viewport: { width: 1440, height: 1000 },
  });
  await mockAPI(context);
  page = await context.newPage();
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${baseURL}/tools`);
  await page
    .getByRole("heading", { name: "提案编号回填", exact: true })
    .waitFor({ timeout: 15_000 })
    .catch(async (error) => {
      console.error(
        "Page startup:",
        page.url(),
        errors,
        (await page.locator("body").innerText()).slice(0, 2000)
      );
      throw error;
    });
  artifacts = await mkdtemp(path.join(tmpdir(), "coregenie-proposal-tests-"));
  await page.evaluate(async () => {
    const m = await import("/src/utils/localTools/proposalFill.js");
    const z = await import("/node_modules/fflate/esm/browser.js");
    const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    const S = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
    const R =
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
    const escape = (s) =>
      String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const run = (s) =>
      `<w:r><w:rPr><w:b/></w:rPr><w:t>${escape(s)}</w:t></w:r>`;
    const p = (s) => `<w:p>${run(s)}</w:p>`;
    const cell = (s) =>
      `<w:tc>${Array.isArray(s) ? `<w:p>${s.map(run).join("")}</w:p>` : p(s)}</w:tc>`;
    const row = (values) => `<w:tr>${values.map(cell).join("")}</w:tr>`;
    const record = {
      id: "2",
      tdoc: "C4-265196",
      title: "Correction on DataExposure callback",
      source: "Huawei",
      spec: "29.572",
      release: "Rel-20",
      version: "20.1.0",
      cr: "0419",
      revision: "",
    };
    function docx(options = {}) {
      const values = {
        tdoc: ["C4-26", "5abc"],
        cr: ["x", "xx"],
        version: "",
        revision: "-",
        ...options,
      };
      const number = values.blankNumber
        ? ""
        : Array.isArray(values.tdoc)
          ? values.tdoc.map(run).join("")
          : run(values.tdoc);
      const header = `<w:p>${run("3GPP TSG-CT WG4 Meeting #138")}<w:r><w:tab/></w:r>${number}</w:p>`;
      const form = `<w:tbl>${row(["", "29.572", "CR", values.cr, "rev", values.revision, "Current version:", values.version])}</w:tbl>`;
      const meta = `<w:tbl>${row(["Title:", values.title || record.title])}${row(["Source to WG:", record.source])}${row(["Category:", "F", "Release:", record.release])}</w:tbl>`;
      const body =
        `${p("CR-Form-v13.0.1")}${p("version: 1.1.0-alpha.1; xxx; C4-265abc")}${p("Body content")}` +
        '<w:p><w:del w:id="1" w:author="Reviewer"><w:r><w:delText>subscription/notificationUri</w:delText></w:r></w:del><w:ins w:id="2" w:author="Reviewer"><w:r><w:t>notificationUri</w:t></w:r></w:ins></w:p>';
      const xml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>${header}${form}${meta}${body}<w:sectPr/></w:body></w:document>`;
      return z.zipSync({
        "[Content_Types].xml": z.strToU8(
          '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
        ),
        "word/document.xml": z.strToU8(xml),
        "word/header1.xml": z.strToU8(
          `<w:hdr xmlns:w="${W}">${p("Unchanged header")}</w:hdr>`
        ),
        "word/media/image1.png": new Uint8Array([137, 80, 78, 71, 1, 2]),
        "word/embeddings/object1.bin": new Uint8Array([4, 5, 6, 7]),
        "word/_rels/document.xml.rels": z.strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>'
        ),
      });
    }
    function xlsx(records = [record], options = {}) {
      const headers = [
        "TDoc",
        "Title",
        "Source",
        "Spec",
        "Release",
        "Version",
        "CR",
        "CR revision",
        "Type",
      ];
      const keys = [
        "tdoc",
        "title",
        "source",
        "spec",
        "release",
        "version",
        "cr",
        "revision",
        "type",
      ];
      const data = [
        headers,
        ...records.map((r) =>
          keys.map((k) => (k === "type" ? "CR" : (r[k] ?? "")))
        ),
      ];
      const sheet = `<worksheet xmlns="${S}"><sheetData>${data.map((values, i) => `<row r="${i + 1}">${values.map((value, j) => (options.numericCR && i > 0 && j === 6 ? `<c r="G${i + 1}" s="1"><v>${Number(value)}</v></c>` : `<c r="${String.fromCharCode(65 + j)}${i + 1}" t="inlineStr"><is><t>${escape(value)}</t></is></c>`)).join("")}</row>`).join("")}</sheetData></worksheet>`;
      return z.zipSync({
        "xl/workbook.xml": z.strToU8(
          `<workbook xmlns="${S}" xmlns:r="${R}"><sheets><sheet name="CR_Packs_List" sheetId="1" r:id="rId1"/><sheet name="${options.wrongSheet ? "Other" : "TDoc_List"}" sheetId="7" r:id="rId7"/></sheets></workbook>`
        ),
        "xl/_rels/workbook.xml.rels": z.strToU8(
          '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId7" Target="worksheets/list.xml"/></Relationships>'
        ),
        "xl/worksheets/list.xml": z.strToU8(sheet),
        "xl/styles.xml": z.strToU8(
          `<styleSheet xmlns="${S}"><numFmts><numFmt numFmtId="164" formatCode="0000"/></numFmts><cellXfs><xf numFmtId="0"/><xf numFmtId="164"/></cellXfs></styleSheet>`
        ),
      });
    }
    window.proposalTest = {
      m,
      z,
      W,
      record,
      docx,
      xlsx,
      file: (bytes, name = "C4-26xxx.docx") => new File([bytes], name),
    };
  });
});
after(async () => {
  await browser?.close();
  await server?.close();
});

test("fills split text and empty cells, preserves leading zeros, body revisions and other package parts", async () => {
  const result = await page.evaluate(async () => {
    const { m, z, record, docx, file, W } = window.proposalTest;
    const original = docx();
    const proposal = await m.readProposal(file(original));
    const plan = m.planProposal(proposal, record);
    const output = await m.generateProposal(proposal, plan);
    const reread = await m.readProposal(file(output, plan.outputName));
    const before = z.unzipSync(original),
      after = z.unzipSync(output);
    const docBefore = new DOMParser().parseFromString(
      z.strFromU8(before["word/document.xml"]),
      "application/xml"
    );
    const docAfter = new DOMParser().parseFromString(
      z.strFromU8(after["word/document.xml"]),
      "application/xml"
    );
    const bodyBefore = [
      ...docBefore.getElementsByTagNameNS(W, "body")[0].children,
    ]
      .slice(3)
      .map((n) => n.textContent);
    const bodyAfter = [
      ...docAfter.getElementsByTagNameNS(W, "body")[0].children,
    ]
      .slice(3)
      .map((n) => n.textContent);
    return {
      values: reread.values,
      ready: plan.ready,
      name: plan.outputName,
      bodyBefore,
      bodyAfter,
      revisions: ["del", "ins"].map(
        (n) => docAfter.getElementsByTagNameNS(W, n).length
      ),
      otherPartsSame: Object.keys(before)
        .filter((n) => n !== "word/document.xml")
        .every(
          (n) =>
            before[n].every((b, i) => after[n][i] === b) &&
            before[n].length === after[n].length
        ),
      originalValues: proposal.values,
      idempotent:
        (await m.generateProposal(reread, m.planProposal(reread, record)))
          .length > 0,
    };
  });
  assert.deepEqual(result.values, {
    tdoc: "C4-265196",
    cr: "0419",
    revision: "-",
    version: "20.1.0",
  });
  assert.equal(result.ready, true);
  assert.equal(result.name, "C4-265196.docx");
  assert.deepEqual(result.bodyBefore, result.bodyAfter);
  assert.deepEqual(result.revisions, [1, 1]);
  assert.equal(result.otherPartsSame, true);
  assert.equal(result.originalValues.cr, "xxx");
  assert.equal(result.idempotent, true);
});

test("reads the named Excel sheet and numeric CR display format; disambiguates Release", async () => {
  const result = await page.evaluate(async () => {
    const { m, record, xlsx, docx, file } = window.proposalTest;
    const records = await m.readMeetingList(
      file(
        xlsx([record, { ...record, tdoc: "C4-265197", release: "Rel-19" }], {
          numericCR: true,
        }),
        "meeting.xlsx"
      )
    );
    const proposal = await m.readProposal(file(docx()));
    const match = m.matchRecords(proposal, records);
    return {
      records,
      match,
      ambiguous: m.matchRecords(proposal, [
        records[0],
        { ...records[0], id: "4" },
      ]),
      noMatch: m.matchRecords(proposal, [
        { ...records[0], title: "Another title" },
      ]),
    };
  });
  assert.equal(result.records[0].cr, "0419");
  assert.equal(result.match.selectedId, "2");
  assert.equal(result.match.candidates.length, 2);
  assert.equal(result.ambiguous.selectedId, "");
  assert.equal(result.ambiguous.reason, "ambiguous");
  assert.equal(result.noMatch.reason, "no_match");
});

test("requires conflict confirmation and blocks duplicate output names", async () => {
  const result = await page.evaluate(async () => {
    const { m, record, docx, file } = window.proposalTest;
    const proposal = await m.readProposal(
      file(
        docx({ tdoc: "C4-265000", cr: "0001", version: "19.1.0" }),
        "C4-26xxx Proposal.docx"
      )
    );
    const pending = m.planProposal(proposal, record);
    let blocked;
    try {
      await m.generateProposal(proposal, pending);
    } catch (e) {
      blocked = e.code;
    }
    const confirmed = m.planProposal(proposal, record, true);
    const duplicates = m.duplicateNames([confirmed, confirmed]);
    const preserve = m.planProposal(proposal, record, true, "preserve");
    return {
      pending,
      blocked,
      ready: confirmed.ready,
      duplicates: m.isDuplicateName(confirmed.outputName, duplicates),
      preservedName: preserve.outputName,
    };
  });
  assert.equal(result.pending.ready, false);
  assert.equal(result.pending.conflicts, 3);
  assert.equal(result.blocked, "unconfirmed");
  assert.equal(result.ready, true);
  assert.equal(result.duplicates, true);
  assert.equal(result.preservedName, "C4-265196 Proposal.docx");
});

test("supports a blank number after a tab and rejects broken, oversized or complex inputs", async () => {
  const result = await page.evaluate(async () => {
    const { m, z, W, record, docx, xlsx, file } = window.proposalTest;
    const blank = await m.readProposal(file(docx({ blankNumber: true })));
    const output = await m.generateProposal(
      blank,
      m.planProposal(blank, record)
    );
    const reread = await m.readProposal(file(output));
    const codes = [];
    const expectCode = async (fn) => {
      try {
        await fn();
        codes.push("unexpected_success");
      } catch (e) {
        codes.push(e.code);
      }
    };
    await expectCode(() => m.readProposal(file(new Uint8Array([1, 2, 3]))));
    await expectCode(() => m.readProposal(file(new Uint8Array(), "old.doc")));
    await expectCode(() =>
      m.readMeetingList(
        file(xlsx([record], { wrongSheet: true }), "meeting.xlsx")
      )
    );
    await expectCode(() =>
      m.readProposal({ name: "large.docx", size: m.LIMITS.fileBytes + 1 })
    );
    const entries = z.unzipSync(docx());
    const xml = z.strFromU8(entries["word/document.xml"]);
    entries["word/document.xml"] = z.strToU8(
      xml.replace(
        "<w:t>x</w:t>",
        `<w:ins w:id="9"><w:r><w:t>x</w:t></w:r></w:ins>`
      )
    );
    await expectCode(() => m.readProposal(file(z.zipSync(entries))));
    await expectCode(() => m.planProposal(blank, { ...record, cr: "" }));
    const protectedEntries = z.unzipSync(docx());
    protectedEntries["word/settings.xml"] = z.strToU8(
      `<w:settings xmlns:w="${W}"><w:documentProtection w:enforcement="1"/></w:settings>`
    );
    await expectCode(() => m.readProposal(file(z.zipSync(protectedEntries))));
    const duplicateForms = z.unzipSync(docx());
    const duplicated = z
      .strFromU8(duplicateForms["word/document.xml"])
      .replace(/(<w:tbl>.*?<\/w:tbl>)/, "$1$1");
    duplicateForms["word/document.xml"] = z.strToU8(duplicated);
    await expectCode(() => m.readProposal(file(z.zipSync(duplicateForms))));
    return { values: reread.values, codes };
  });
  assert.equal(result.values.tdoc, "C4-265196");
  assert.deepEqual(result.codes, [
    "invalid_package",
    "file_type",
    "missing_sheet",
    "file_size",
    "complex_field",
    "record_values",
    "protected_document",
    "template",
  ]);
});

test("UI previews and exports locally, lists failures, handles duplicates and renders desktop/mobile", async () => {
  const fixture = await page.evaluate(() => {
    const { xlsx, docx, z } = window.proposalTest;
    return { workbook: [...xlsx()], draft: [...docx()], broken: [1, 2, 3] };
  });
  const requests = [];
  const track = (request) =>
    requests.push({
      url: request.url(),
      method: request.method(),
      body: request.postData(),
    });
  page.on("request", track);
  await page.getByLabel("选择 Excel", { exact: true }).setInputFiles({
    name: "meeting.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(fixture.workbook),
  });
  await page
    .getByText("已读取 1 份清单，共 1 条 CR 记录", { exact: true })
    .waitFor();
  await page.getByLabel("选择 Word 文件", { exact: true }).setInputFiles([
    {
      name: "C4-26xxx.docx",
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      buffer: Buffer.from(fixture.draft),
    },
    {
      name: "broken.docx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(fixture.broken),
    },
  ]);
  await page
    .getByRole("heading", { name: "检查匹配和修改 · 2 份文件", exact: true })
    .waitFor();
  const downloadButton = page.getByRole("button", { name: "生成并下载 ZIP" });
  await downloadButton.waitFor();
  await page
    .locator("article")
    .first()
    .locator("table")
    .getByText("0419", { exact: true })
    .waitFor();
  assert.match(
    await page.locator("article").nth(1).innerText(),
    /无法读取文件/
  );
  await page.screenshot({
    path: path.join(artifacts, "desktop-light.png"),
    fullPage: true,
  });
  await downloadButton.scrollIntoViewIfNeeded();
  assert.notEqual(
    await downloadButton.evaluate((el) => getComputedStyle(el).backgroundColor),
    "rgba(0, 0, 0, 0)"
  );
  await downloadButton.focus();
  await page.keyboard.press("ArrowRight");
  assert.notEqual(
    await downloadButton.evaluate((el) => getComputedStyle(el).boxShadow),
    "none"
  );
  await page.screenshot({
    path: path.join(artifacts, "desktop-preview.png"),
    fullPage: true,
  });
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  const bytes = await readFile(await download.path());
  const zip = await page.evaluate(
    async (bytes) => {
      const { z, m, file } = window.proposalTest;
      const entries = z.unzipSync(new Uint8Array(bytes));
      return {
        names: Object.keys(entries),
        report: JSON.parse(z.strFromU8(entries["处理清单.json"])),
        values: (await m.readProposal(file(entries["C4-265196.docx"]))).values,
      };
    },
    [...bytes]
  );
  assert.deepEqual(
    zip.names.sort(),
    ["C4-265196.docx", "处理清单.json"].sort()
  );
  assert.equal(zip.report.length, 2);
  assert.equal(zip.report[0]["处理结果"], "已生成");
  assert.equal(zip.report[0]["所用记录"], "meeting.xlsx / TDoc_List / 第 2 行");
  assert.match(zip.report[1]["处理结果"], /无法读取文件/);
  assert.equal(zip.values.cr, "0419");
  assert.equal(
    requests.some((r) => r.method !== "GET" || r.body),
    false,
    JSON.stringify(requests)
  );
  assert.equal(
    requests.some((r) => /DataExposure|C4-26xxx|meeting\.xlsx/.test(r.url)),
    false
  );
  const stored = await page.evaluate(() =>
    JSON.stringify({
      local: { ...localStorage },
      session: { ...sessionStorage },
    })
  );
  assert.equal(stored.includes("DataExposure"), false);
  assert.equal(stored.includes("C4-26xxx"), false);
  await page.getByLabel("选择 Word 文件", { exact: true }).setInputFiles({
    name: "duplicate.docx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    buffer: Buffer.from(fixture.draft),
  });
  await page
    .getByRole("heading", { name: "检查匹配和修改 · 3 份文件", exact: true })
    .waitFor();
  assert.equal(await downloadButton.isDisabled(), true);
  await page
    .locator("article")
    .nth(2)
    .getByLabel("本次不导出此文件", { exact: true })
    .check();
  assert.equal(await downloadButton.isEnabled(), true);
  await page.evaluate(() => {
    localStorage.setItem("theme", "dark");
    document.documentElement.setAttribute("data-theme", "dark");
  });
  await page.screenshot({
    path: path.join(artifacts, "desktop-dark.png"),
    fullPage: true,
  });
  const mobile = await browser.newContext({
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
    userAgent:
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1",
  });
  await mockAPI(mobile);
  const mobilePage = await mobile.newPage();
  mobilePage.on("pageerror", (e) => errors.push(e.message));
  await mobilePage.goto(`${baseURL}/tools`);
  await mobilePage
    .getByRole("heading", { name: "提案编号回填", exact: true })
    .waitFor();
  await mobilePage.getByLabel("选择 Excel", { exact: true }).setInputFiles([
    {
      name: "meeting.xlsx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(fixture.workbook),
    },
    {
      name: "another-meeting.xlsx",
      mimeType: "application/octet-stream",
      buffer: Buffer.from(fixture.workbook),
    },
  ]);
  await mobilePage
    .getByText("已读取 2 份清单，共 2 条 CR 记录", { exact: true })
    .waitFor();
  await mobilePage.getByLabel("选择 Word 文件", { exact: true }).setInputFiles({
    name: "C4-26xxx.docx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(fixture.draft),
  });
  await mobilePage
    .getByRole("heading", { name: "检查匹配和修改 · 1 份文件", exact: true })
    .waitFor();
  const mobileMatching = mobilePage
    .locator("article")
    .getByLabel("对应的会议清单记录");
  assert.equal(await mobileMatching.inputValue(), "");
  await mobileMatching.selectOption({ index: 1 });
  assert.equal(
    await mobilePage.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true
  );
  await mobilePage.screenshot({
    path: path.join(artifacts, "mobile.png"),
    fullPage: true,
  });
  await mobilePage
    .getByRole("button", { name: "生成并下载 ZIP" })
    .scrollIntoViewIfNeeded();
  await mobilePage
    .getByText("0419", { exact: true })
    .filter({ visible: true })
    .waitFor();
  await mobilePage.screenshot({
    path: path.join(artifacts, "mobile-preview.png"),
    fullPage: true,
  });
  await mobilePage.getByRole("button", { name: "展开侧栏" }).click();
  await mobilePage
    .locator("dialog[open]")
    .getByRole("link", { name: "日常工具", exact: true })
    .waitFor();
  await mobile.close();
  page.off("request", track);
  assert.deepEqual(errors, []);
  console.log(`Rendered screenshots: ${artifacts}`);
});

test("merges user-provided meeting lists without row ID collisions or automatic cross-meeting selection", async () => {
  const result = await page.evaluate(async () => {
    const { m, record, xlsx, docx, file } = window.proposalTest;
    const first = await m.readMeetingList(file(xlsx(), "November.xlsx"));
    const second = await m.readMeetingList(
      file(
        xlsx([{ ...record, tdoc: "C4-265197", cr: "0520" }]),
        "December.xlsx"
      )
    );
    const records = m.mergeMeetingLists([
      { id: "first", name: "November.xlsx", records: first },
      { id: "second", name: "December.xlsx", records: second },
      { id: "broken", name: "broken.xlsx", error: "invalid" },
    ]);
    const proposal = await m.readProposal(file(docx()));
    const match = m.matchRecords(proposal, records);
    const chosen = records.find((r) => r.id === "second:2");
    const plan = m.planProposal(proposal, chosen);
    const filled = await m.readProposal(
      file(await m.generateProposal(proposal, plan))
    );
    return { records, match, values: filled.values };
  });
  assert.deepEqual(
    result.records.map((r) => r.id),
    ["first:2", "second:2"]
  );
  assert.deepEqual(
    result.records.map((r) => [r.sourceFile, r.row]),
    [
      ["November.xlsx", "2"],
      ["December.xlsx", "2"],
    ]
  );
  assert.equal(result.match.selectedId, "");
  assert.equal(result.match.reason, "ambiguous");
  assert.equal(result.values.cr, "0520");
  assert.equal(result.values.tdoc, "C4-265197");
});

test("UI supports multiple Excel files and folders, preserves valid files on failure, and resets selection after source changes", async () => {
  const fixture = await page.evaluate(() => {
    const { record, xlsx, docx } = window.proposalTest;
    return {
      first: [...xlsx()],
      second: [...xlsx([{ ...record, tdoc: "C4-265197", cr: "0520" }])],
      draft: [...docx()],
      conflict: [...docx({ cr: "0001" })],
    };
  });
  const clearFiles = page.getByRole("button", {
    name: "清空文件",
    exact: true,
  });
  if (await clearFiles.count()) await clearFiles.click();
  const clearMeetings = page.getByRole("button", {
    name: "清空会议清单",
    exact: true,
  });
  if (await clearMeetings.count()) await clearMeetings.click();
  const excelInput = page.getByLabel("选择 Excel", { exact: true });
  assert.equal(await excelInput.getAttribute("multiple"), "");
  const toFile = (name, bytes) => ({
    name,
    mimeType: "application/octet-stream",
    buffer: Buffer.from(bytes),
  });
  await excelInput.setInputFiles([
    toFile("November.xlsx", fixture.first),
    toFile("December.xlsx", fixture.second),
    toFile("broken.xlsx", [1, 2, 3]),
  ]);
  await page
    .getByText("已读取 2 份清单，共 2 条 CR 记录", { exact: true })
    .waitFor();
  const lists = page.getByRole("list", { name: "已添加的会议清单" });
  assert.equal(await lists.getByRole("listitem").count(), 3);
  assert.match(await lists.innerText(), /broken.xlsx[\s\S]*无法读取文件/);
  await page
    .getByLabel("选择 Word 文件", { exact: true })
    .setInputFiles(toFile("draft.docx", fixture.draft));
  const article = page.locator("article").first();
  const matching = article.getByLabel("对应的会议清单记录");
  await article
    .getByRole("option", { name: /December.xlsx/ })
    .waitFor({ state: "attached" });
  assert.equal(await matching.inputValue(), "");
  const downloadButton = page.getByRole("button", {
    name: "生成并下载 ZIP",
    exact: true,
  });
  assert.equal(await downloadButton.isDisabled(), true);
  const decemberValue = await matching
    .locator("option")
    .filter({ hasText: "December.xlsx" })
    .getAttribute("value");
  await matching.selectOption(decemberValue);
  await article
    .getByText("所用清单：December.xlsx / TDoc_List / 第 2 行", { exact: true })
    .waitFor();
  assert.equal(await downloadButton.isEnabled(), true);
  const downloadPromise = page.waitForEvent("download");
  await downloadButton.click();
  const download = await downloadPromise;
  const archive = [...(await readFile(await download.path()))];
  const output = await page.evaluate(async (bytes) => {
    const { m, z, file } = window.proposalTest;
    const entries = z.unzipSync(new Uint8Array(bytes));
    return {
      report: JSON.parse(z.strFromU8(entries["处理清单.json"])),
      values: (await m.readProposal(file(entries["C4-265197.docx"]))).values,
    };
  }, archive);
  assert.equal(output.values.cr, "0520");
  assert.equal(
    output.report[0]["所用记录"],
    "December.xlsx / TDoc_List / 第 2 行"
  );
  await page
    .getByRole("button", { name: "移除会议清单 November.xlsx", exact: true })
    .click();
  await page
    .getByText("已读取 1 份清单，共 1 条 CR 记录", { exact: true })
    .waitFor();
  assert.equal(await matching.inputValue(), decemberValue);

  // A newly added list invalidates confirmation of an existing formal CR value.
  await page.getByRole("button", { name: "清空文件", exact: true }).click();
  await page
    .getByLabel("选择 Word 文件", { exact: true })
    .setInputFiles(toFile("conflict.docx", fixture.conflict));
  const confirmation = page.locator("article").getByRole("checkbox").first();
  await confirmation.check();
  assert.equal(await downloadButton.isEnabled(), true);
  await excelInput.setInputFiles(toFile("November.xlsx", fixture.first));
  await page
    .getByText("已读取 2 份清单，共 2 条 CR 记录", { exact: true })
    .waitFor();
  assert.equal(
    await page.locator("article").getByLabel("对应的会议清单记录").inputValue(),
    ""
  );
  assert.equal(await downloadButton.isDisabled(), true);
  await page
    .locator("article")
    .getByLabel("对应的会议清单记录")
    .selectOption(decemberValue);
  assert.equal(await confirmation.isChecked(), false);
  await page.screenshot({
    path: path.join(artifacts, "multiple-lists-desktop.png"),
    fullPage: true,
  });

  // Folder import includes nested Excel files, ignores unrelated files and Office lock files.
  const directory = path.join(artifacts, "meeting-fixtures");
  await mkdir(path.join(directory, "nested"), { recursive: true });
  await writeFile(
    path.join(directory, "November.xlsx"),
    Buffer.from(fixture.first)
  );
  await writeFile(
    path.join(directory, "nested", "December.xlsx"),
    Buffer.from(fixture.second)
  );
  await writeFile(path.join(directory, "notes.txt"), "Ignored");
  await writeFile(path.join(directory, "~$lock.xlsx"), "Ignored");
  await page.getByRole("button", { name: "清空会议清单", exact: true }).click();
  assert.equal(
    await page
      .getByRole("button", { name: "选择 Word 文件", exact: true })
      .isDisabled(),
    true
  );
  assert.equal(await downloadButton.isDisabled(), true);
  await page
    .getByLabel("选择清单文件夹", { exact: true })
    .setInputFiles(directory);
  await page
    .getByText("已读取 2 份清单，共 2 条 CR 记录", { exact: true })
    .waitFor();
  assert.equal(await lists.getByRole("listitem").count(), 2);
  assert.equal((await lists.innerText()).includes("~$lock.xlsx"), false);
  assert.match(
    await lists.innerText(),
    /meeting-fixtures\/nested\/December.xlsx/
  );
  assert.equal(
    await page.locator("article").getByLabel("对应的会议清单记录").inputValue(),
    ""
  );

  assert.deepEqual(errors, []);
});
