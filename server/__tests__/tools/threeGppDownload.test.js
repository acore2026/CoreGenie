const fs = require("fs/promises");
const path = require("path");
const os = require("os");
const AdmZip = require("adm-zip");
jest.mock("../../agent-skills/registry", () => ({
  resolveAvailableSkill: jest.fn(),
}));
const { resolveAvailableSkill } = require("../../agent-skills/registry");
const filesystem = require("../../services/workspaceFiles");
const sandbox = require("../../services/sandbox");
const catalog = require("../../utils/threeGppCatalog");
const documentCatalog = require("../../utils/threeGppDocuments");
const {
  downloadProposals,
  downloadOfficialTdoc,
  parseTdoc,
} = require("../../tools/threeGpp");
let root, manager, context;
const meeting = {
  id: "TSGS2_175_Dalian_2026-05",
  number: 175,
  source: "https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/TSGS2_175_Dalian_2026-05/",
};
const tdoc = "S2-2604004";
function response(status = 200, document = tdoc) {
  const zip = new AdmZip();
  zip.addFile(document + ".docx", Buffer.from("original DOCX"));
  return new Response(status === 200 ? zip.toBuffer() : "error", { status });
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "3gpp-download-test-"));
  manager = {
    ensureInitialized: async () => {},
    validatePath: async (value) => path.join(root, value),
  };
  context = {
    workspace: { id: 1 },
    run: { id: "test-run", prompt: "TR 23.801-01 KI#2" },
    agent: {},
    signal: new AbortController().signal,
    activatedSkill: () => ({ revision: "r1" }),
    emit: jest.fn(),
  };
  resolveAvailableSkill.mockResolvedValue({
    id: 1,
    name: "3gpp-review",
    revision: "r1",
  });
  jest.spyOn(filesystem, "forWorkspace").mockReturnValue(manager);
  jest.spyOn(catalog, "meetings").mockResolvedValue({
    meetings: [
      meeting,
      { ...meeting, id: "TSGS2_175-AH-e_Electronic_2026-06" },
    ],
  });
  jest.spyOn(documentCatalog, "meetingDocuments").mockResolvedValue({
    source: meeting.source + "Docs/TDoc_List_Meeting_SA2%23175.xlsx",
    docsSource: meeting.source + "Docs/",
    selectionSource: "official-tdoc-list",
    fetchedAt: "2026-09-30T08:00:00Z",
    warnings: [],
    unindexedTdocs: [],
    items: [{ value: "20.6.2", title: "SBA framework" }],
    documents: [
      {
        document: tdoc,
        agenda: "20.6.2",
        title: "KI#2 Interconnection",
        spec: "23.801-01",
        source: "Huawei",
        status: "revised",
        availability: "listed",
        downloadUrl: meeting.source + "Docs/" + tdoc + ".zip",
      },
    ],
  });
  jest.spyOn(global, "fetch").mockImplementation(async () => response());
  jest.spyOn(sandbox, "run").mockImplementation(async ({ code }) => {
    const convertedTdoc = code.match(/--input '[^']+\/([^\/]+)\.docx'/)[1];
    const output = code.match(/--output '\/workspace\/([^']+)'/)[1];
    await fs.mkdir(path.join(root, output, "assets"), { recursive: true });
    await fs.writeFile(path.join(root, output, "assets/image.png"), "image");
    await fs.writeFile(
      path.join(root, output, "conversion-summary.json"),
      JSON.stringify({ markdown: convertedTdoc + ".md", warnings: [] })
    );
    await fs.writeFile(
      path.join(root, output, convertedTdoc + ".md"),
      "![original](assets/image.png)"
    );
    return { exitCode: 0, stdout: "converted", stderr: "" };
  });
});
afterEach(async () => {
  jest.restoreAllMocks();
  await fs.rm(root, { recursive: true, force: true });
});
const args = { group: "SA2", meeting: "SA2#175", ki: ["KI2"] };
test("downloads from exact meeting, persists original and metadata, resumes without network or conversion", async () => {
  const result = await downloadProposals.execute(args, context);
  expect(result.ok).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(String(fetch.mock.calls[0][0])).toBe(
    meeting.source + "Docs/" + tdoc + ".zip"
  );
  const file = result.data.outputs[0].files[0];
  expect(
    await fs.readFile(
      path.join(root, file.docx.replace("/workspace/", "")),
      "utf8"
    )
  ).toBe("original DOCX");
  expect(
    await fs.readFile(
      path.join(root, file.markdown.replace("/workspace/", "")),
      "utf8"
    )
  ).toContain(tdoc + ".assets/assets/image.png");
  const repeated = await downloadProposals.execute(args, context);
  expect(repeated.data.outputs[0].files[0].cached).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sandbox.run).toHaveBeenCalledTimes(1);
});
test("conversion failure preserves DOCX and concrete error, retries only conversion", async () => {
  const convert = sandbox.run.getMockImplementation();
  sandbox.run.mockResolvedValueOnce({
    exitCode: 1,
    stdout: "",
    stderr: "converter missing input relationship",
  });
  const result = await downloadProposals.execute(args, context);
  expect(result.data.failures[0].error).toContain(
    "converter missing input relationship"
  );
  expect(result.retryable).toBe(false);
  sandbox.run.mockImplementation(convert);
  expect((await downloadProposals.execute(args, context)).ok).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(1);
});
test("permanent HTTP failure does not retry or hide status", async () => {
  fetch.mockImplementation(async () => response(403));
  const result = await downloadProposals.execute(args, context);
  expect(result.data.failures[0]).toMatchObject({
    code: "HTTP_403",
    retryable: false,
  });
  expect(result.retryable).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(sandbox.run).not.toHaveBeenCalled();
});
test("transient gateway error is retried within the tool", async () => {
  fetch.mockResolvedValueOnce(response(503));
  const result = await downloadOfficialTdoc(parseTdoc(tdoc), context, manager, {
    meetingFolder: meeting.id,
    destinationRoot: "docs",
  });
  expect(result.ok).toBe(true);
  expect(fetch).toHaveBeenCalledTimes(2);
});
test("empty fallback agenda cannot claim proposals are unpublished or download complete", async () => {
  documentCatalog.meetingDocuments.mockResolvedValue({
    selectionSource: "official-agenda-section",
    source: meeting.source + "TdocsByAgenda.htm",
    warnings: ["TDoc 表无法读取，下载范围尚未确认。"],
    items: [{ value: "20.6.2", title: "SBA framework" }],
    documents: [],
  });
  const result = await downloadProposals.execute(
    { ...args, agenda_item: "20.6.2" },
    context
  );
  expect(result.ok).toBe(true);
  expect(result.code).toBe("DOWNLOAD_INCOMPLETE");
  expect(result.data.outputs[0].status).toBe("no_matching_documents_in_source");
  expect(result.summary).toContain("不能据此判断尚未上传");
  expect(fetch).not.toHaveBeenCalled();
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(
        root,
        result.data.outputs[0].directory.replace("/workspace/", ""),
        "tdoc-manifest.json"
      ),
      "utf8"
    )
  );
  expect(manifest).toMatchObject({
    count: 0,
    completeness: "unknown",
    selectionSource: "official-agenda-section",
  });
});
test("cancellation stops before network and conversion", async () => {
  const controller = new AbortController();
  controller.abort();
  context.signal = controller.signal;
  await expect(downloadProposals.execute(args, context)).rejects.toThrow();
  expect(fetch).not.toHaveBeenCalled();
  expect(sandbox.run).not.toHaveBeenCalled();
});

test("separates reserved and missing files, preserves withdrawn status and provenance", async () => {
  const snapshot = await documentCatalog.meetingDocuments();
  documentCatalog.meetingDocuments.mockResolvedValue({
    ...snapshot,
    documents: [
      { ...snapshot.documents[0], status: "withdrawn" },
      {
        ...snapshot.documents[0],
        document: "S2-2604005",
        status: "reserved",
        availability: "reserved",
        downloadUrl: null,
      },
      {
        ...snapshot.documents[0],
        document: "S2-2604006",
        status: "available",
        availability: "missing",
        downloadUrl: null,
      },
    ],
  });
  const result = await downloadProposals.execute(args, context);
  expect(result.code).toBe("DOWNLOAD_PARTIAL");
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(result.data.outputs[0].files[0]).toMatchObject({
    tdoc,
    status: "withdrawn",
    withdrawn: true,
  });
  expect(result.data.pendingDocuments).toEqual([
    expect.objectContaining({ tdoc: "S2-2604005", status: "reserved" }),
  ]);
  expect(result.data.failures).toEqual([
    expect.objectContaining({
      tdoc: "S2-2604006",
      code: "TDOC_ARCHIVE_NOT_LISTED",
    }),
  ]);
  const manifest = JSON.parse(
    await fs.readFile(
      path.join(
        root,
        result.data.outputs[0].directory.replace("/workspace/", ""),
        "tdoc-manifest.json"
      ),
      "utf8"
    )
  );
  expect(manifest).toMatchObject({
    count: 3,
    source: snapshot.source,
    selectionSource: "official-tdoc-list",
    fetchedAt: snapshot.fetchedAt,
  });
  expect(manifest.proposals).toHaveLength(3);
  const record = JSON.parse(
    await fs.readFile(
      path.join(root, result.data.recordPath.replace("/workspace/", "")),
      "utf8"
    )
  );
  expect(record.pendingDocuments).toHaveLength(1);
  expect(record.selectionSnapshots[0].proposals).toHaveLength(3);
  expect(record.failures).toHaveLength(1);
});

test("reserved-only scope is awaiting upload, not completed or a network failure", async () => {
  const snapshot = await documentCatalog.meetingDocuments();
  documentCatalog.meetingDocuments.mockResolvedValue({
    ...snapshot,
    documents: [
      {
        ...snapshot.documents[0],
        status: "reserved",
        availability: "reserved",
        downloadUrl: null,
      },
    ],
  });
  const result = await downloadProposals.execute(args, context);
  expect(result.code).toBe("DOWNLOAD_INCOMPLETE");
  expect(result.data.outputs[0].status).toBe("awaiting_upload");
  expect(result.data.failures).toEqual([]);
  expect(result.data.pendingDocuments).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});

test("fallback still downloads known files but returns the source warning", async () => {
  const snapshot = await documentCatalog.meetingDocuments();
  documentCatalog.meetingDocuments.mockResolvedValue({
    ...snapshot,
    selectionSource: "official-agenda-section",
    warnings: ["TDoc 表不可用，下载范围尚未确认。"],
  });
  const result = await downloadProposals.execute(args, context);
  expect(result.data.outputs[0].files).toHaveLength(1);
  expect(result.code).toBe("DOWNLOAD_INCOMPLETE");
  expect(result.summary).toContain("下载范围尚未确认");
});

test("uses exact listed ZIP case and rejects an archive from another meeting", async () => {
  const url = meeting.source + "Docs/" + tdoc.toLowerCase() + ".zip";
  const result = await downloadOfficialTdoc(parseTdoc(tdoc), context, manager, {
    meetingFolder: meeting.id,
    destinationRoot: "docs",
    archiveUrl: url,
  });
  expect(result.ok).toBe(true);
  expect(fetch.mock.calls[0][0]).toBe(url);
  await expect(
    downloadOfficialTdoc(parseTdoc(tdoc), context, manager, {
      meetingFolder: meeting.id,
      archiveUrl:
        meeting.source.replace("175_", "177_") + "Docs/" + tdoc + ".zip",
    })
  ).rejects.toThrow("不一致");
  expect(fetch).toHaveBeenCalledTimes(1);
});

test("large download results keep structured counts and the complete durable file list", async () => {
  const snapshot = await documentCatalog.meetingDocuments();
  const documents = Array.from({ length: 40 }, (_, index) => ({
    ...snapshot.documents[0],
    document: `S2-${2604000 + index}`,
  }));
  documentCatalog.meetingDocuments.mockResolvedValue({
    ...snapshot,
    documents,
  });
  const directory = path.join(
    root,
    `3gpp/${meeting.id}-23.801-01-20.6.2-KI2/proposal`
  );
  await fs.mkdir(directory, { recursive: true });
  for (const document of documents) {
    await fs.writeFile(
      path.join(directory, document.document + ".docx"),
      "docx"
    );
    await fs.writeFile(
      path.join(directory, document.document + ".md"),
      "markdown"
    );
    await fs.writeFile(
      path.join(directory, document.document + ".receipt.json"),
      JSON.stringify({
        revision: "r1",
        docxSize: 4,
        markdownSize: 8,
        warnings: [],
      })
    );
  }
  const result = await downloadProposals.execute(args, context);
  expect(result.data.outputs[0]).toMatchObject({
    fileCount: 40,
    filesTruncated: true,
  });
  expect(result.data.outputs[0].files).toHaveLength(10);
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(
    downloadProposals.maxResultBytes
  );
  const record = JSON.parse(
    await fs.readFile(
      path.join(root, result.data.recordPath.replace("/workspace/", "")),
      "utf8"
    )
  );
  expect(record.outputs[0].files).toHaveLength(40);
  expect(record.selectionSnapshots[0].proposals).toHaveLength(40);
  expect(fetch).not.toHaveBeenCalled();
});

test.each([
  ["CT1", "TSGC1_165_Incheon", "WG1_mm-cc-sm_ex-CN1", "C1-2600001"],
  ["CT4", "CT4_138_Calgary-2026-11", "WG4_protocollars_ex-CN4", "C4-265041"],
])(
  "accepts the official %s archive path and still rejects another group, meeting or TDoc",
  async (group, folder, directory, document) => {
    const url =
      "https://www.3gpp.org/ftp/tsg_ct/" +
      directory +
      "/" +
      folder +
      "/Docs/" +
      document +
      ".zip";
    fetch.mockImplementation(async () => response(200, document));
    expect(
      (
        await downloadOfficialTdoc(parseTdoc(document), context, manager, {
          meetingFolder: folder,
          destinationRoot: "ct-docs",
          archiveUrl: url,
        })
      ).ok
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    for (const invalid of [
      url.replace(directory, "WG_OTHER"),
      url.replace(folder, folder + "_other"),
      url.replace(document + ".zip", document + "9.zip"),
      url.replace("www.3gpp.org", "example.com"),
    ]) {
      await expect(
        downloadOfficialTdoc(parseTdoc(document), context, manager, {
          meetingFolder: folder,
          destinationRoot: "ct-docs",
          archiveUrl: invalid,
        })
      ).rejects.toThrow();
    }
    expect(fetch).toHaveBeenCalledTimes(1);
  }
);

test.each([
  { agenda_item: "21.2" },
  { work_item: "FS_6G_CPCN_CT" },
  { ki: ["KI21"], agenda_item: "21.2" },
])(
  "CT4 scope %j does not infer a SA2 spec from a warning in the prompt",
  async (scope) => {
    const ctMeeting = {
      id: "CT4_138_Calgary-2026-11",
      number: 138,
      source:
        "https://www.3gpp.org/ftp/tsg_ct/WG4_protocollars_ex-CN4/CT4_138_Calgary-2026-11/",
    };
    catalog.meetings.mockResolvedValue({ meetings: [ctMeeting] });
    context.run.prompt = "CT4 6G 提案。不要套用 SA2 的 TR 23.801-01。";
    const documents = [
      { document: "C4-265041", spec: "29.840", status: "available" },
      { document: "C4-265048", spec: "", status: "withdrawn" },
    ].map((d) => ({
      ...d,
      agenda: "21.2",
      title: "Control plane proposal",
      workItem: "FS_6G_CPCN_CT",
      availability: "listed",
      downloadUrl: ctMeeting.source + "Docs/" + d.document + ".zip",
    }));
    documentCatalog.meetingDocuments.mockResolvedValue({
      source: ctMeeting.source + "Docs/TDoc_List_Meeting_CT4%23138.xlsx",
      docsSource: ctMeeting.source + "Docs/",
      selectionSource: "official-tdoc-list",
      warnings: [],
      unindexedTdocs: [],
      items: [{ value: "21.2", title: "Control Plane [FS_6G_CPCN_CT]" }],
      documents,
    });
    fetch.mockImplementation(async (url) =>
      response(200, String(url).match(/(C4-\d+)\.zip$/)[1])
    );
    const result = await downloadProposals.execute(
      { group: "CT4", meeting: ctMeeting.id, ...scope },
      context
    );
    expect(result.ok).toBe(true);
    expect(result.data.selections[0].count).toBe(2);
    expect(result.data.outputs[0].files.map((f) => f.tdoc)).toEqual([
      "C4-265041",
      "C4-265048",
    ]);
    expect(result.data.outputs[0].files[1].withdrawn).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
    const manifest = JSON.parse(
      await fs.readFile(
        path.join(
          root,
          result.data.outputs[0].directory.replace("/workspace/", ""),
          "tdoc-manifest.json"
        ),
        "utf8"
      )
    );
    expect(manifest.spec).toBeNull();
    expect(manifest.scope.agendaItem).toBe("21.2");
    if (!scope.ki) {
      expect(result.data.outputs[0].ki).toBeNull();
      expect(manifest.scope.type).toBe(
        scope.work_item ? "work_item" : "agenda"
      );
      expect(manifest.agenda_filter).toBeNull();
    }
    expect(
      (
        await downloadProposals.execute(
          { group: "CT4", meeting: ctMeeting.id, ...scope },
          context
        )
      ).data.outputs[0].files.every((f) => f.cached)
    ).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(2);
  }
);

test("scope is required and work items cannot be combined with KI identifiers", async () => {
  for (const scope of [{}, { ki: ["KI21"], work_item: "FS_6G_CPCN_CT" }]) {
    const result = await downloadProposals.execute(
      { group: "CT4", meeting: "CT4#138", ...scope },
      context
    );
    expect(result.code).toBe("INVALID_SCOPE");
  }
  expect(catalog.meetings).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
  expect(
    downloadProposals.schema.safeParse({
      group: "CT4",
      meeting: "CT4#138",
      agenda_item: "21.2",
    }).success
  ).toBe(true);
  expect(
    downloadProposals.schema.safeParse({
      group: "CT4",
      meeting: "CT4#138",
      work_item: "FS_6G_CPCN_CT",
    }).success
  ).toBe(true);
});

test.each([
  { agenda_item: "21.1" },
  { work_item: "FS_6G_NAS_CT", agenda_item: "21.1" },
])(
  "CT1 scope %j accepts official agenda selection without inventing a KI or inferring SA2 specs",
  async (scope) => {
    const ctMeeting = {
      id: "TSGC1_164_Calgary",
      number: 164,
      source:
        "https://www.3gpp.org/ftp/tsg_ct/WG1_mm-cc-sm_ex-CN1/TSGC1_164_Calgary/",
    };
    catalog.meetings.mockResolvedValue({ meetings: [ctMeeting] });
    context.run.prompt = "CT1 6G 文稿；不要套用 SA2 的 TR 23.801-01。";
    const documents = [
      {
        document: "C1-266058",
        agenda: "21.1",
        spec: "24.860",
        workItem: "FS_6G_NAS_CT",
        status: "available",
      },
      {
        document: "C1-266059",
        agenda: "21.1.1",
        spec: "",
        workItem: "",
        status: "revised",
      },
      {
        document: "C1-266103",
        agenda: "21.2",
        spec: "24.861",
        workItem: "FS_6G_MISC_CT",
        status: "available",
      },
    ].map((d) => ({
      ...d,
      title: "Protocol proposal",
      availability: "listed",
      downloadUrl: ctMeeting.source + "Docs/" + d.document + ".zip",
    }));
    documentCatalog.meetingDocuments.mockResolvedValue({
      source: ctMeeting.source + "Docs/TDoc_List_Meeting_CT1%23164.xlsx",
      docsSource: ctMeeting.source + "Docs/",
      selectionSource: "official-tdoc-list",
      warnings: [],
      unindexedTdocs: [],
      items: [
        { value: "21.1", title: "NAS protocol for 6G [FS_6G_NAS_CT]" },
        { value: "21.2", title: "Miscellaneous Functions [FS_6G_MISC_CT]" },
      ],
      documents,
    });
    fetch.mockImplementation(async (url) =>
      response(200, String(url).match(/(C1-\d+)\.zip$/)[1])
    );
    const result = await downloadProposals.execute(
      { group: "CT1", meeting: ctMeeting.id, ...scope },
      context
    );
    expect(result.ok).toBe(true);
    expect(result.data.selections[0].count).toBe(2);
    expect(result.data.outputs[0].ki).toBeNull();
    expect(result.data.outputs[0].files.map((f) => f.tdoc)).toEqual([
      "C1-266058",
      "C1-266059",
    ]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(
      fetch.mock.calls.every(([url]) =>
        String(url).includes("/WG1_mm-cc-sm_ex-CN1/")
      )
    ).toBe(true);
  }
);
