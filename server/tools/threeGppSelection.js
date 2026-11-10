function selectMeeting(meetings, group, input) {
  const value = String(input).trim();
  const exact = meetings.filter((m) =>
    [m.id, m.source, m.source.replace(/\/$/, ""), m.label].includes(value)
  );
  if (exact.length) return exact;
  const match = value.match(new RegExp(`^${group}#(\\d+)$`, "i"));
  if (!match) return [];
  const candidates = meetings.filter((m) => m.number === Number(match[1]));
  const prefix = group.startsWith("SA")
    ? `TSGS${group.slice(2)}`
    : `TSG${group}`;
  const regular = candidates.filter((m) =>
    new RegExp(`^${prefix}_${match[1]}_`, "i").test(m.id)
  );
  return regular.length ? regular : candidates;
}

function selectKiDocuments(agenda, ki, spec, agendaItem) {
  const number = String(ki).match(/^KI\s*#?\s*(\d+(?:\.\d+)*)$/i)?.[1];
  if (!number)
    return { code: "INVALID_KI", error: "KI 必须写成 KI2 或 KI#2。" };
  const pattern = new RegExp(
    `\\b(?:KI|Key\\s+Issue)\\s*#?\\s*${number.replace(/\./g, "\\.")}(?![\\d.]|[A-Za-z])`,
    "i"
  );
  const documents = agenda.documents || [];
  const documentSpecs = (document) =>
    (document.spec || document.title).match(/\b\d{2}\.\d{3}(?:-\d{2})?\b/g) ||
    [];
  let seeds = documents.filter(
    (d) => pattern.test(d.title) && (!spec || documentSpecs(d).includes(spec))
  );
  if (agendaItem) seeds = seeds.filter((d) => d.agenda === agendaItem);
  const sections = [...new Set(seeds.map((d) => d.agenda))];
  if (!agendaItem && sections.length > 1)
    return {
      code: "AMBIGUOUS_KI",
      error:
        "该 KI 对应多个议程项，请指定 spec（TR/TS 编号）和 agenda_item，不能混合下载。",
      candidates: sections.map((section) => ({
        agendaItem: section,
        title: agenda.items?.find((i) => i.value === section)?.title,
        example: seeds.find((d) => d.agenda === section)?.title,
      })),
    };
  // Explicit agenda selection is useful for an empty, upcoming meeting, but
  // never interpret its numeric suffix as the KI number automatically.
  const section = agendaItem || sections[0];
  const heading = agenda.items?.find((i) => i.value === section);
  if (!section || (!heading && !documents.some((d) => d.agenda === section)))
    return {
      code: "KI_SCOPE_NOT_FOUND",
      error:
        "无法从官方提案标题确认该 KI 的议程范围。请使用官方议程指定 agenda_item；不要反复重试同一参数或猜测编号。",
    };
  const selected = documents
    .filter((d) => d.agenda === section)
    .filter((d) => {
      const listedSpecs = documentSpecs(d);
      return !spec || !listedSpecs.length || listedSpecs.includes(spec);
    });
  if (spec && !selected.length && documents.some((d) => d.agenda === section))
    return {
      code: "KI_SCOPE_NOT_FOUND",
      error: "指定议程项中的提案不属于该 TR/TS，请核对 spec 和 agenda_item。",
    };
  return {
    documents: selected,
    agendaItem: section,
    title: heading?.title || "",
    empty: !selected.length,
  };
}

function requestedSpec(explicit, prompt) {
  if (explicit) return explicit.replace(/^(?:TR|TS)\s*/i, "").trim();
  const specs = [
    ...new Set(
      [
        ...String(prompt || "").matchAll(
          /\b(?:TR|TS)\s*(\d{2}\.\d{3}(?:-\d{2})?)/gi
        ),
      ].map((m) => m[1])
    ),
  ];
  return specs.length === 1 ? specs[0] : null;
}
module.exports = { selectMeeting, selectKiDocuments, requestedSpec };
