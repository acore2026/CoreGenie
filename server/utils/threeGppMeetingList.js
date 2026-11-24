const catalog = require("./threeGppCatalog");

// Resolve only an exact meeting and its official list; never accept a client URL.
async function downloadMeetingList(group, meetingId, signal) {
  const data = await catalog.meetings(group);
  const meeting = data.meetings.find((item) => item.id === meetingId);
  if (!meeting) throw new Error("meeting_not_found");
  const root = catalog.links(
    await catalog.readOfficial(meeting.source, 0, signal),
    meeting.source
  );
  const docs = root.filter((link) => /^docs\/?$/i.test(link.name));
  if (docs.length !== 1) throw new Error("list_not_found");
  const source = docs[0].url.replace(/\/$/, "") + "/";
  const links = catalog.links(
    await catalog.readOfficial(source, 0, signal),
    source
  );
  const name = `TDoc_List_Meeting_${group}#${meeting.number}${meeting.suffix || ""}.xlsx`;
  const lists = links.filter(
    (link) => link.name.toLowerCase() === name.toLowerCase()
  );
  if (lists.length !== 1) throw new Error("list_not_found");
  const bytes = await catalog.readOfficialBuffer(lists[0].url, 0, signal);
  return {
    name,
    source: lists[0].url,
    fetchedAt: new Date().toISOString(),
    content: bytes.toString("base64"),
  };
}
module.exports = { downloadMeetingList };
