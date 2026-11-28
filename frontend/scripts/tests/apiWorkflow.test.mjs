import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";
import { mockAPI } from "./mockAPI.mjs";

let server, browser, page, baseURL, artifacts;
const errors = [];
const root = fileURLToPath(new URL("../../", import.meta.url));

before(async () => {
  server = await createServer({
    root,
    envFile: false,
    configFile: path.join(root, "vite.config.js"),
    cacheDir: path.join(tmpdir(), "coregenie-api-workflow-vite-cache"),
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
  artifacts = await mkdtemp(path.join(tmpdir(), "coregenie-api-workflow-"));
});

after(async () => {
  await browser?.close();
  await server?.close();
});

test("Full 3-step workflow engine: API_impacts -> CR docx -> Bulk TDoc Allocation xlsx -> Proposal Fill", async () => {
  await page.goto(`${baseURL}/tools/api-cr-generator`);
  await page
    .getByRole("heading", { name: "API 版本更新 CR 生成", exact: true })
    .waitFor({ timeout: 15_000 });

  const result = await page.evaluate(async () => {
    const apiMod = await import("/src/utils/localTools/apiImpactCr.ts");
    const allocMod = await import("/src/utils/localTools/tdocAllocation.ts");
    const fillMod = await import("/src/utils/localTools/proposalFill.ts");
    const ooxml = await import("/src/utils/localTools/ooxml.ts");
    const z = await import("/node_modules/fflate/esm/browser.js");

    // 1. Build a realistic API_impacts_TSGCT.xlsx matching user's exact sample
    const impactsBytes = ooxml.buildSimpleXlsx({
      sheetName: "CT3_Impacts",
      headers: [
        "TDoc #",
        "Spec #",
        "CR #",
        "Release",
        "Cat",
        "API impacts",
        "Potentially missing impacts",
        "Other comments",
      ],
      rows: [
        [
          "C3-264452",
          "29.522",
          "1951",
          "Rel-20",
          "F",
          "TS29522_ServiceParameter.yaml, TS29574_Ndccf_ContextManagement.yaml, TS29574_Ndccf_DataManagement.yaml",
          "A.9\tServiceParameter API",
          "The CR has introduced the backward compatible corrections to the following APIs:\nTS29522_ServiceParameter.yaml\nTS29574_Ndccf_ContextManagement.yaml\nTS29574_Ndccf_DataManagement.yaml\nForge related attachments:\n",
        ],
        [
          "C3-264452",
          "29.522",
          "1951",
          "Rel-20",
          "F",
          "TS29574_Ndccf_DataManagement.yaml",
          "",
          "The CR has introduced the backward compatible corrections to the following APIs:\nTS29574_Ndccf_DataManagement.yaml",
        ],
        [
          "C3-264500",
          "29.520",
          "1284",
          "Rel-20",
          "B",
          "TS29574_Ndccf_DataManagement.yaml, TS29574_Ndccf_ContextManagement.yaml",
          "",
          "The CR introduces backwards compatible feature to:\nTS29574_Ndccf_DataManagement.yaml\nTS29574_Ndccf_ContextManagement.yaml",
        ],
      ],
    });
    const impactsFile = new File([impactsBytes], "API_impacts_TSGCT.xlsx");
    const parsedImpacts = await apiMod.readApiImpactsWorkbook(impactsFile);

    // 2. Build a baseline TS 29.574 V20.1.0 .docx containing A.2 and A.3 OpenAPI YAML
    const W = ooxml.W_NS;
    const p = (t) =>
      `<w:p><w:r><w:t xml:space="preserve">${ooxml.escapeXml(t)}</w:t></w:r></w:p>`;
    const baselineXml = `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body>
      ${p("3GPP TS 29.574 V20.1.0 (2026-09)")}
      ${p("Annex A (normative): OpenAPI specification")}
      ${p("A.2 Ndccf_DataManagement API")}
      ${p("openapi: 3.0.0")}
      ${p("info:")}
      ${p("  version: 1.3.0-alpha.2")}
      ${p("  title: Ndccf_DataManagement")}
      ${p("  description: |")}
      ${p("    DCCF Data Management Service.")}
      ${p("    © 2025, 3GPP Organizational Partners.")}
      ${p("externalDocs:")}
      ${p("  description: 3GPP TS 29.574 V20.1.0; 5G System; Data Collection Coordination Services; Stage 3.")}
      ${p("  url: 'https://www.3gpp.org/ftp/Specs/archive/29_series/29.574/'")}
      ${p("servers:")}
      ${p("  - url: '{apiRoot}/ndccf-datamanagement/v1'")}
      ${p("A.3 Ndccf_ContextManagement API")}
      ${p("openapi: 3.0.0")}
      ${p("info:")}
      ${p("  version: 1.3.0-alpha.2")}
      ${p("  title: Ndccf_ContextManagement")}
      ${p("  description: |")}
      ${p("    DCCF Context Management Service.")}
      ${p("    © 2026, 3GPP Organizational Partners.")}
      ${p("externalDocs:")}
      ${p("  description: 3GPP TS 29.574 V20.1.0; 5G System; Data Collection Coordination Services; Stage 3.")}
      ${p("  url: 'https://www.3gpp.org/ftp/Specs/archive/29_series/29.574/'")}
      ${p("servers:")}
      ${p("  - url: '{apiRoot}/ndccf-contextmanagement/v1'")}
    </w:body></w:document>`;
    const baselineBytes = z.zipSync({
      "[Content_Types].xml": z.strToU8(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>'
      ),
      "word/document.xml": z.strToU8(baselineXml),
    });
    const baseline = await apiMod.readBaselineSpec(
      new File([baselineBytes], "29574-k10.docx")
    );
    const enriched = apiMod.applyBaselinesToDrafts(parsedImpacts.drafts, [
      baseline,
    ]);
    const cr29574 = enriched.find(
      (d) => d.spec === "29.574" && d.release === "Rel-20"
    );

    // 3. Generate CR docx (Step 1 output)
    const crBytes = apiMod.generateApiUpdateCrDocx(cr29574, {
      meetingHeader: "3GPP TSG-CT WG3 Meeting #150",
      meetingLocationDate: "Calgary, Canada, 16th – 20th November, 2026",
      tdocPlaceholder: "C3-26xxxx",
      sourceToWg: "Huawei",
      sourceToTsg: "C3",
      date: "2026-11-25",
      copyrightYear: "2026",
      bodyMode: "full_yaml",
      author: "Huawei",
    });
    const crZip = z.unzipSync(crBytes);
    const crDocXml = z.strFromU8(crZip["word/document.xml"]);
    const crDocText = ooxml.visibleWordText(
      ooxml.parseXml(crZip["word/document.xml"], ooxml.W_NS).documentElement
    );
    const crHasOfficialTemplateParts =
      Boolean(crZip["word/header1.xml"]) &&
      crDocXml.includes("FFFF00") &&
      crDocXml.includes("CRCoverPage") &&
      crDocText.includes("CR-Form-v13.0.1") &&
      crDocText.includes("Use one of the following categories");

    // 4. Feed generated CR docx into Step 2 (Bulk TDoc Allocation Excel exporter)
    const crFile = new File(
      [crBytes],
      "C3-26xxxx_29.574_Rel-20_Update_of_info_and_externalDocs.docx"
    );
    const allocItem = await allocMod.readWordForAllocation(crFile, "row-1");
    allocItem.values["Agenda item"] = "6.6";
    allocItem.values["Contact ID"] = "12345";
    const allocXlsx = allocMod.exportAllocationWorkbook([allocItem.values]);
    const allocSheets = ooxml.readXlsxSheets(allocXlsx);

    // Also test filling into a blank template .xlsx
    const blankTemplate = ooxml.buildSimpleXlsx({
      sheetName: "BulkAllocation",
      headers: allocMod.ALLOCATION_COLUMNS,
      rows: [],
    });
    const filledTemplate = allocMod.exportAllocationWorkbook(
      [allocItem.values],
      blankTemplate
    );
    const filledSheets = ooxml.readXlsxSheets(filledTemplate);

    // 5. Feed the EXACT same CR docx into Step 3 (proposalFill.ts)
    const proposal = await fillMod.readProposal(crFile);
    const meetingBytes = ooxml.buildSimpleXlsx({
      sheetName: "TDoc_List",
      headers: [
        "TDoc",
        "Title",
        "Source",
        "Spec",
        "Release",
        "Version",
        "CR",
        "CR revision",
        "Type",
      ],
      rows: [
        [
          "C3-265629",
          "Update of info and externalDocs fields",
          "Huawei",
          "29.574",
          "Rel-20",
          "20.1.0",
          "0164",
          "-",
          "CR",
        ],
      ],
    });
    const meetingRecords = await fillMod.readMeetingList(
      new File([meetingBytes], "TDoc_List_Meeting_CT3#150.xlsx")
    );
    const sourced = fillMod.mergeMeetingLists([
      { id: "m1", name: "TDoc_List.xlsx", size: 100, records: meetingRecords },
    ]);
    const match = fillMod.matchRecords(proposal, sourced);
    const plan = fillMod.planProposal(
      proposal,
      sourced.find((r) => r.id === match.selectedId)
    );
    const filledCrBytes = await fillMod.generateProposal(proposal, plan);
    const filledProposal = await fillMod.readProposal(
      new File([filledCrBytes], plan.outputName)
    );
    const filledDocXml = z.strFromU8(
      z.unzipSync(filledCrBytes)["word/document.xml"]
    );

    return {
      draftCount: parsedImpacts.drafts.length,
      cr29574: {
        currentTsVersion: cr29574.currentTsVersion,
        targetTsVersion: cr29574.targetTsVersion,
        clausesAffected: cr29574.clausesAffected,
        apis: cr29574.apis.map((a) => ({
          apiName: a.apiName,
          clause: a.clause,
          currentApiVersion: a.currentApiVersion,
          targetApiVersion: a.targetApiVersion,
          impactCount: a.impacts.length,
          highestImpact: a.highestImpact,
        })),
      },
      versionMath: {
        frozenPatch: apiMod.computeNextApiVersion("1.2.3", "patch", false),
        frozenMinor: apiMod.computeNextApiVersion("1.2.3", "minor", false),
        frozenMajor: apiMod.computeNextApiVersion("1.2.3", "major", false),
        firstAlpha: apiMod.computeNextApiVersion("1.4.1", "patch", true),
        nextAlpha: apiMod.computeNextApiVersion("1.3.0-alpha.2", "minor", true),
      },
      crHasOfficialTemplateParts,
      crHasTrackChanges:
        crDocXml.includes("<w:del ") && crDocXml.includes("<w:ins "),
      crHasReasonLine: crDocXml.includes(
        "29.522 CR#1951 introduces backward compatible correction"
      ),
      allocHeaders: Object.values(allocSheets[0].rows[0].cells),
      allocRow: allocSheets[0].rows[1].cells,
      templateSheetName: filledSheets[0].name,
      templateRowCount: filledSheets[0].rows.length,
      step3MatchReason: match.reason,
      step3Conflicts: plan.conflicts,
      step3Ready: plan.ready,
      step3OutputName: plan.outputName,
      step3FilledValues: filledProposal.values,
      step3KeptTrackChanges:
        filledDocXml.includes("<w:del ") && filledDocXml.includes("<w:ins "),
      impactsBytes: [...impactsBytes],
      baselineBytes: [...baselineBytes],
      crBytes: [...crBytes],
    };
  });

  // Verify Step 1
  assert.equal(result.draftCount, 2); // 29.522 Rel-20 and 29.574 Rel-20
  assert.equal(result.cr29574.currentTsVersion, "20.1.0");
  assert.equal(result.cr29574.targetTsVersion, "20.2.0");
  assert.equal(result.cr29574.clausesAffected, "A.2, A.3");
  assert.equal(result.cr29574.apis.length, 2);
  assert.equal(result.cr29574.apis[0].apiName, "Ndccf_DataManagement");
  assert.equal(result.cr29574.apis[0].clause, "A.2");
  assert.equal(result.cr29574.apis[0].currentApiVersion, "1.3.0-alpha.2");
  assert.equal(result.cr29574.apis[0].targetApiVersion, "1.3.0-alpha.3");
  // Deduplication verified: 29.522 CR#1951 appeared twice, so only 2 unique CRs remain!
  assert.equal(result.cr29574.apis[0].impactCount, 2);
  assert.equal(result.cr29574.apis[0].highestImpact, "minor");
  assert.deepEqual(result.versionMath, {
    frozenPatch: "1.2.4",
    frozenMinor: "1.3.0",
    frozenMajor: "2.0.0",
    firstAlpha: "1.5.0-alpha.1",
    nextAlpha: "1.3.0-alpha.3",
  });
  assert.equal(result.crHasOfficialTemplateParts, true);
  assert.equal(result.crHasTrackChanges, true);
  assert.equal(result.crHasReasonLine, true);

  // Verify Step 2 (exact 21 columns)
  assert.deepEqual(result.allocHeaders, [
    "Title",
    "Source",
    "Contact ID",
    "Type",
    "For",
    "Agenda item",
    "TDoc sort order within agenda item",
    "Is revision of",
    "Release",
    "Spec",
    "Version",
    "Related WIs",
    "CR",
    "CR revision",
    "CR category",
    "TSG CR Pack",
    "Reply to",
    "To",
    "Cc",
    "Original LS",
    "Reply in",
  ]);
  assert.equal(result.allocRow.A, "Update of info and externalDocs fields");
  assert.equal(result.allocRow.B, "Huawei");
  assert.equal(result.allocRow.C, "12345");
  assert.equal(result.allocRow.D, "CR");
  assert.equal(result.allocRow.E, "Agreement");
  assert.equal(result.allocRow.F, "6.6");
  assert.equal(result.allocRow.I, "Rel-20");
  assert.equal(result.allocRow.J, "29.574");
  assert.equal(result.allocRow.K, "20.1.0");
  assert.equal(result.allocRow.L, "TEI20");
  assert.equal(result.allocRow.M || "", ""); // placeholder xxxx cleared!
  assert.equal(result.allocRow.O, "F");
  assert.equal(result.templateSheetName, "BulkAllocation");
  assert.equal(result.templateRowCount, 2);

  // Verify Step 3 (seamless backfill on generated CR)
  assert.equal(result.step3MatchReason, "");
  assert.equal(result.step3Conflicts, 0);
  assert.equal(result.step3Ready, true);
  assert.equal(result.step3OutputName, "C3-265629.docx");
  assert.deepEqual(result.step3FilledValues, {
    tdoc: "C3-265629",
    cr: "0164",
    revision: "-",
    version: "20.1.0",
  });
  assert.equal(result.step3KeptTrackChanges, true);

  // Persist fixtures for UI interaction tests below
  await writeFile(
    path.join(artifacts, "API_impacts_TSGCT.xlsx"),
    Buffer.from(result.impactsBytes)
  );
  await writeFile(
    path.join(artifacts, "29574-k10.docx"),
    Buffer.from(result.baselineBytes)
  );
  await writeFile(
    path.join(artifacts, "C3-26xxxx_29.574_Rel-20.docx"),
    Buffer.from(result.crBytes)
  );
});

test("Word cover matches the C3-265629 paragraph and list formatting", async () => {
  const file = await readFile(
    path.join(artifacts, "C3-26xxxx_29.574_Rel-20.docx")
  );
  const layout = await page.evaluate(
    async (bytes) => {
      const { W_NS, parseXml, unpackZip, visibleWordText, wordChildren } =
        await import("/src/utils/localTools/ooxml.ts");
      const { addCrBulletList } =
        await import("/src/utils/localTools/crBulletList.ts");
      const parts = unpackZip(Uint8Array.from(bytes));
      const doc = parseXml(parts["word/document.xml"]);
      const get = (el, name) => [...el.getElementsByTagNameNS(W_NS, name)];
      const val = (el) => el?.getAttributeNS(W_NS, "val");
      const text = (el) => visibleWordText(el);
      const cellParagraphs = (label) => {
        const cell = get(doc, "tc").find((tc) => text(tc).trim() === label);
        return wordChildren(cell.nextElementSibling, "p");
      };
      const describe = (p) => ({
        text: text(p),
        bold: wordChildren(p, "r")
          .filter((r) => get(r, "b").length)
          .map(text)
          .join(""),
        underline: wordChildren(p, "r")
          .filter((r) => val(get(r, "u")[0]) === "single")
          .map(text)
          .join(""),
        numId: val(get(p, "numId")[0]),
        halfLine: get(p, "spacing")[0]?.getAttributeNS(W_NS, "afterLines"),
      });
      const paragraphs = cellParagraphs("Reason for change:").map(describe);
      const summary = describe(cellParagraphs("Summary of change:")[0]);
      const rels = parseXml(parts["word/_rels/document.xml.rels"]);
      const rel = [...rels.documentElement.children].find((r) =>
        r.getAttribute("Type")?.endsWith("/numbering")
      );
      const path = "word/" + rel.getAttribute("Target");
      const types = parseXml(parts["[Content_Types].xml"]);
      const type = [...types.documentElement.children].find(
        (t) => t.getAttribute("PartName") === "/" + path
      );
      // A form with existing lists must retain their IDs and definitions.
      const nextId = addCrBulletList(parts);
      const numbering = parseXml(parts[path]);
      const num = get(numbering, "num").find(
        (n) => n.getAttributeNS(W_NS, "numId") === summary.numId
      );
      const abstractId = val(get(num, "abstractNumId")[0]);
      const abstract = get(numbering, "abstractNum").find(
        (n) => n.getAttributeNS(W_NS, "abstractNumId") === abstractId
      );
      const body = get(doc, "body")[0];
      const [header, date] = wordChildren(body, "p");
      return {
        paragraphs,
        summary,
        nextId,
        type: type.getAttribute("ContentType"),
        marker: val(get(abstract, "lvlText")[0]),
        format: val(get(abstract, "numFmt")[0]),
        hanging: get(abstract, "ind")[0].getAttributeNS(W_NS, "hanging"),
        headerSizes: wordChildren(header, "r")
          .filter((r) => text(r).trim())
          .map((r) => val(get(r, "sz")[0])),
        superscripts: wordChildren(date, "r")
          .filter((r) => val(get(r, "vertAlign")[0]) === "superscript")
          .map(text),
        nextChange: wordChildren(body, "p").some((p) =>
          text(p).includes("Next change")
        ),
      };
    },
    [...file]
  );
  const { paragraphs, summary } = layout;
  assert.equal(paragraphs.length, 13);
  assert.deepEqual(
    paragraphs.flatMap((p, i) => (p.text ? [] : [i])),
    [1, 7]
  );
  for (const [start, name] of [
    [2, "Ndccf_DataManagement"],
    [8, "Ndccf_ContextManagement"],
  ]) {
    const [intro, cr1, cr2, version, external] = paragraphs.slice(
      start,
      start + 5
    );
    assert.equal(intro.bold, name + " API");
    assert.equal(intro.halfLine, "50");
    assert.equal(cr1.numId, summary.numId);
    assert.equal(cr2.numId, summary.numId);
    assert.match(cr1.text, /^29\./);
    assert.match(cr2.text, /^29\./);
    assert.equal(version.underline, version.text);
    assert.equal(external.bold, "v20.2.0");
  }
  assert.equal(paragraphs.filter((p) => p.numId).length, 4);
  assert.ok(summary.numId);
  assert.notEqual(layout.nextId, summary.numId);
  assert.equal(layout.format, "bullet");
  assert.equal(layout.marker, "-");
  assert.equal(layout.hanging, "360");
  assert.match(layout.type, /numbering\+xml$/);
  assert.deepEqual(layout.headerSizes, ["24", "28"]);
  assert.deepEqual(layout.superscripts, ["th", "th"]);
  assert.equal(layout.nextChange, false);
});

test("UI rendering & interaction across Catalog, API CR Generator, and TDoc Allocation (desktop + mobile)", async () => {
  // 1. Catalog renders all 4 standard tools and subtle contributor labels cleanly
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/tools`);
  await page.getByRole("heading", { name: "API 版本更新 CR 生成" }).waitFor();
  await page.getByRole("heading", { name: "文稿号申请表导出" }).waitFor();
  await page.getByRole("heading", { name: "提案编号回填工具" }).waitFor();
  await page.getByText("贡献人：刘佳明/景昊").waitFor();
  assert.equal(await page.getByText("贡献人：张雪飞").count(), 2);
  await page.getByText("贡献人：戚彩霞").waitFor();

  // 2. Tool 1 interactive upload, filter, one-click official baseline fetch, and export
  const baselineContent = (
    await readFile(path.join(artifacts, "29574-k10.docx"))
  ).toString("base64");
  const requestedBaselines = [];
  await page.route("**/api/3gpp/baseline-spec**", (route) => {
    const params = new URL(route.request().url()).searchParams;
    requestedBaselines.push([params.get("spec"), params.get("release")]);
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        name: "29574-k10.docx",
        spec: "29.574",
        release: "Rel-20",
        version: "20.1.0",
        zipName: "29574-k10.zip",
        source:
          "https://www.3gpp.org/ftp/Specs/archive/29_series/29.574/29574-k10.zip",
        fetchedAt: "2026-11-28T00:00:00Z",
        content: baselineContent,
      }),
    });
  });
  await page.goto(`${baseURL}/tools/api-cr-generator`);
  const step1 = page.getByRole("region", { name: "1. 上传 API_impacts 表格" });
  const step2 = page.getByRole("region", {
    name: "2. 获取规范基线文件（可选）",
  });
  const workbook = await page.evaluate(async () => {
    const { buildSimpleXlsx } = await import("/src/utils/localTools/ooxml.ts");
    const rows = Array.from({ length: 210 }, (_, i) => [
      `C3-${260000 + i}`,
      "29.522",
      String(i + 1),
      i % 2 ? "Rel-20" : "Rel-19",
      "F",
      i % 3
        ? "TS29574_Ndccf_DataManagement.yaml"
        : "TS29522_ServiceParameter.yaml",
      "",
      "",
    ]);
    return [
      ...buildSimpleXlsx({
        sheetName: "CT3_Impacts",
        headers: [
          "TDoc #",
          "Spec #",
          "CR #",
          "Release",
          "Cat",
          "API impacts",
          "Potentially missing impacts",
          "Other comments",
        ],
        rows,
      }),
    ];
  });
  await step1.getByLabel("选择 API_impacts Excel").setInputFiles({
    name: "API_impacts_TSGCT.xlsx",
    mimeType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    buffer: Buffer.from(workbook),
  });
  await step1.getByText(/210 条源 CR 记录，整理出 4 篇/).waitFor();
  const filter = step1.getByLabel(/按规范号或 API 筛选/);
  const release = step1.getByLabel("按 Release 筛选");
  const fetchButton = step2.getByRole("button", {
    name: /从 3GPP 官网拉取已选基线/,
  });
  await filter.fill("Ndccf");
  await step1.getByText("筛选后有 2 篇待生成 CR。").waitFor();
  await release.selectOption("Rel-20");
  await step1.getByText("筛选后有 1 篇待生成 CR。").waitFor();
  await page.getByText("显示 1 / 4 篇").waitFor();
  assert.match(await fetchButton.innerText(), /1 份/);
  assert.equal(requestedBaselines.length, 0);
  await fetchButton.click();
  await page.getByText("已从 3GPP 官方归档拉取并应用 1 份规范基线").waitFor();
  assert.deepEqual(requestedBaselines, [["29.574", "Rel-20"]]);
  const source = step2.getByText("查看 3GPP 官方归档来源");
  await source.waitFor();
  await filter.fill("29.999");
  await step1.getByText(/没有匹配的 CR/).waitFor();
  assert.ok(await fetchButton.isDisabled());
  assert.ok(await source.isHidden());
  await filter.fill("29.574");
  await release.selectOption("Rel-19");
  await page.getByRole("heading", { name: "TS 29.574 · Rel-19" }).waitFor();
  assert.ok(await source.isHidden());
  await release.selectOption("Rel-20");
  await source.waitFor();

  // Trigger ZIP export and verify download succeeds
  const [zipDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /打包下载已选 CR/ }).click(),
  ]);
  assert.equal(zipDownload.suggestedFilename(), "3GPP-API-Update-CRs.zip");

  // Check mobile layout overflow on Tool 1
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await filter.isVisible());
  const mobileFilter = await filter.boundingBox();
  const mobileFetch = await fetchButton.boundingBox();
  assert.ok(mobileFilter.y + mobileFilter.height <= mobileFetch.y);
  const overflow1 = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  assert.ok(overflow1 <= 2, `Tool 1 mobile overflow: ${overflow1}`);

  // 3. Tool 2 interactive upload, batch agenda by release, export Excel
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${baseURL}/tools/tdoc-allocation`);
  await page
    .locator('input[aria-label="选择 Word 文件"]')
    .setInputFiles(path.join(artifacts, "C3-26xxxx_29.574_Rel-20.docx"));
  await page.getByText("将导出 1 / 1 条").waitFor();
  await page.getByPlaceholder("Agenda item").fill("6.6");
  await page.getByRole("button", { name: "应用到全部提案" }).click();
  await page.getByText("已将批量设置应用到当前所有提案").waitFor();

  const [xlsxDownload] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: /导出申请表 Excel/ }).click(),
  ]);
  assert.equal(
    xlsxDownload.suggestedFilename(),
    "Template_Bulk_TDoc_Allocation.xlsx"
  );
  const savedPath = path.join(artifacts, "downloaded-alloc.xlsx");
  await xlsxDownload.saveAs(savedPath);
  const downloadedBuf = await readFile(savedPath);
  assert.ok(downloadedBuf.byteLength > 500, "Exported xlsx should be non-empty");

  // Check mobile layout overflow on Tool 2
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow2 = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth
  );
  assert.ok(overflow2 <= 2, `Tool 2 mobile overflow: ${overflow2}`);

  assert.deepEqual(errors, [], `Unexpected page errors: ${errors.join("; ")}`);
});
