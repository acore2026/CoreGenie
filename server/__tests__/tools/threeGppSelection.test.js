const {
  selectMeeting,
  selectKiDocuments,
  requestedSpec,
} = require("../../tools/threeGppSelection");
const {
  parseAgendaDocuments,
  parseAgenda,
} = require("../../utils/threeGppCatalog");

test("uses the TDoc Spec column when titles omit it and preserves revisions", () => {
  const base = { agenda: "20.6.2", spec: "23.801-01", source: "Huawei" };
  const agenda = {
    documents: [
      {
        ...base,
        document: "S2-2600001",
        title: "[KI#2] Update",
        status: "revised",
      },
      {
        ...base,
        document: "S2-2600002",
        title: "Interim conclusion",
        status: "withdrawn",
      },
      {
        ...base,
        document: "S2-2600003",
        title: "[KI#2] IMS",
        spec: "23.801-04",
        agenda: "20.10.1",
      },
    ],
    items: [],
  };
  expect(
    selectKiDocuments(agenda, "KI2", "23.801-01").documents.map(
      (d) => d.document
    )
  ).toEqual(["S2-2600001", "S2-2600002"]);
  expect(selectKiDocuments(agenda, "KI2", null).code).toBe("AMBIGUOUS_KI");
  expect(selectKiDocuments(agenda, "KI2", "23.801").code).toBe(
    "KI_SCOPE_NOT_FOUND"
  );
});

const meetings = [
  "TSGS2_175_Dalian_2026-05",
  "TSGS2_175-AH-e_Electronic_2026-06",
].map((id) => ({
  id,
  number: 175,
  source: `https://www.3gpp.org/ftp/tsg_sa/WG2_Arch/${id}/`,
}));
test("regular meeting is resolvable and exact ad-hoc directory/URL remains selectable", () => {
  expect(selectMeeting(meetings, "SA2", "SA2#175")).toEqual([meetings[0]]);
  expect(selectMeeting(meetings, "SA2", meetings[1].id)).toEqual([meetings[1]]);
  expect(selectMeeting(meetings, "SA2", meetings[1].source)).toEqual([
    meetings[1],
  ]);
  expect(selectMeeting(meetings, "SA2", "https://evil.test/")).toEqual([]);
  expect(selectMeeting(meetings, "SA2", "SA2#175e")).toEqual([]);
});
const row = (agenda, tdoc, title, spec = "FS_6G_ARC") =>
  `<tr><td>${agenda}</td><td>${tdoc}</td><td>P-CR</td><td>Approval</td><td>${title}</td><td>Huawei</td><td>Rel-20</td><td>${spec}</td><td>Revision of earlier draft</td><td>revised</td></tr>`;
const html = `<table>${row("20.6.2", "-", "SBA framework")}${row("20.6.2", "S2-2600001", "23.801-01: [KI#2] Initial proposal")}${row("20.6.2", "S2-2600002", "23.801-01: [KI#2] Revised proposal")}${row("20.6.2", "S2-2600003", "Interim conclusion")}${row("20.10.1", "S2-2600004", "23.801-04: [KI#2] Another study", "FS_enIMS_ARC")}</table>`;
test("keeps all TDoc rows and metadata instead of one reference per KI", () => {
  const docs = parseAgendaDocuments(
    html,
    "https://www.3gpp.org/ftp/TdocsByAgenda.htm"
  );
  expect(docs).toHaveLength(4);
  expect(docs[1]).toMatchObject({
    source: "Huawei",
    workItem: "FS_6G_ARC",
    status: "revised",
    comments: "Revision of earlier draft",
  });
  const agenda = { documents: docs, items: parseAgenda(html, "source") };
  expect(selectKiDocuments(agenda, "KI2", null).code).toBe("AMBIGUOUS_KI");
  expect(
    selectKiDocuments(agenda, "KI2", "23.801-01").documents.map(
      (d) => d.document
    )
  ).toEqual(["S2-2600001", "S2-2600002", "S2-2600003"]);
});
test("empty explicit agenda is not a download failure or evidence of a frozen issue", () => {
  const agenda = {
    documents: [],
    items: [{ value: "20.6.2", title: "SBA framework" }],
  };
  expect(selectKiDocuments(agenda, "KI2", "23.801-01", "20.6.2")).toMatchObject(
    { empty: true, documents: [] }
  );
  expect(selectKiDocuments(agenda, "KI2", "23.801-01").code).toBe(
    "KI_SCOPE_NOT_FOUND"
  );
  expect(selectKiDocuments(agenda, "KI2", "23.801-01", "20.9.9").code).toBe(
    "KI_SCOPE_NOT_FOUND"
  );
});
test("does not confuse nested KI or spec prefixes", () => {
  const agenda = {
    documents: [
      {
        document: "S2-2600001",
        agenda: "20.6.2",
        title: "23.801-01 KI#2.1 variant",
      },
      {
        document: "S2-2600002",
        agenda: "20.6.3",
        title: "23.801-04 KI#2 variant",
      },
    ],
    items: [],
  };
  expect(selectKiDocuments(agenda, "KI2", "23.801-01").code).toBe(
    "KI_SCOPE_NOT_FOUND"
  );
  expect(selectKiDocuments(agenda, "KI2", "23.801").code).toBe(
    "KI_SCOPE_NOT_FOUND"
  );
  expect(selectKiDocuments(agenda, "KI2", "23.801-01", "20.6.3").code).toBe(
    "KI_SCOPE_NOT_FOUND"
  );
  expect(requestedSpec(undefined, "KI · TR 23.801-01 V0.8.0")).toBe(
    "23.801-01"
  );
  expect(requestedSpec(undefined, "TR 23.801-01 and TR 23.801-04")).toBeNull();
});

const { selectAgendaDocuments } = require("../../tools/threeGppSelection");
describe("official agenda and work item scopes", () => {
  const agenda = {
    items: [
      { value: "21.2", title: "Control Plane [FS_6G_CPCN_CT]" },
      { value: "21.2.1", title: "Transport" },
      { value: "21.3", title: "User Plane [FS_6G_UPCN_CT]" },
    ],
    documents: [
      {
        document: "C4-265041",
        agenda: "21.2",
        spec: "29.840",
        workItem: "FS_6G_CPCN_CT",
        title: "Protocol proposal",
      },
      { document: "C4-265048", agenda: "21.2", spec: "", title: "Work plan" },
      {
        document: "C4-265049",
        agenda: "21.2.1",
        spec: "29.840",
        title: "Revision",
      },
      {
        document: "C4-265050",
        agenda: "21.20",
        spec: "29.840",
        title: "Different topic",
      },
      {
        document: "C4-265051",
        agenda: "21.3",
        spec: "29.841",
        workItem: "FS_6G_UPCN_CT",
        title: "UP proposal",
      },
    ],
  };
  test("agenda mode includes descendants, missing spec metadata and revisions without matching neighboring prefixes", () => {
    expect(
      selectAgendaDocuments(agenda, null, "21.2").documents.map(
        (d) => d.document
      )
    ).toEqual(["C4-265041", "C4-265048", "C4-265049"]);
    expect(
      selectAgendaDocuments(agenda, null, "21.2.1").documents
    ).toHaveLength(1);
    expect(selectAgendaDocuments(agenda, null, "99").code).toBe(
      "AGENDA_SCOPE_NOT_FOUND"
    );
  });
  test("work item maps from official metadata, never from a KI or a title substring", () => {
    expect(
      selectAgendaDocuments(agenda, null, undefined, "FS_6G_CPCN_CT")
    ).toMatchObject({
      agendaItem: "21.2",
      documents: expect.any(Array),
    });
    expect(
      selectAgendaDocuments(agenda, null, undefined, "fs_6g_cpcn_ct").documents
    ).toHaveLength(3);
    expect(
      selectAgendaDocuments(agenda, null, undefined, "FS_6G_CPCN").code
    ).toBe("WORK_ITEM_SCOPE_NOT_FOUND");
    expect(
      selectAgendaDocuments(agenda, null, "21.3", "FS_6G_CPCN_CT").code
    ).toBe("WORK_ITEM_SCOPE_NOT_FOUND");
    expect(
      selectAgendaDocuments(agenda, null, "21", "FS_6G_CPCN_CT").code
    ).toBe("AMBIGUOUS_WORK_ITEM");
  });
  test("ambiguous work item requires an explicit official agenda scope", () => {
    const duplicated = {
      ...agenda,
      items: [...agenda.items, { value: "22.1", title: "[FS_6G_CPCN_CT]" }],
    };
    expect(
      selectAgendaDocuments(duplicated, null, undefined, "FS_6G_CPCN_CT").code
    ).toBe("AMBIGUOUS_WORK_ITEM");
    expect(
      selectAgendaDocuments(duplicated, null, "21.2", "FS_6G_CPCN_CT").documents
    ).toHaveLength(3);
  });
  test("explicit spec still restricts the scope and an empty official heading stays uncertain", () => {
    expect(
      selectAgendaDocuments(agenda, "29.840", "21.2").documents
    ).toHaveLength(3);
    expect(
      selectAgendaDocuments(
        { ...agenda, documents: [agenda.documents[0]] },
        "23.801-01",
        "21.2"
      ).code
    ).toBe("AGENDA_SCOPE_NOT_FOUND");
    expect(
      selectAgendaDocuments(
        { items: agenda.items, documents: [] },
        null,
        undefined,
        "FS_6G_CPCN_CT"
      )
    ).toMatchObject({ empty: true, documents: [], agendaItem: "21.2" });
  });
});
