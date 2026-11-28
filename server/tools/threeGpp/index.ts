const shared = require("./shared.ts");
const {
  copyConvertedDeliverable,
  downloadOfficialTdoc,
} = require("./downloadOfficial.ts");
const { downloadProposals } = require("./downloadProposalsTool.ts");
const { resolveMeeting } = require("./resolveMeetingTool.ts");
const { convertMarkdown } = require("./convertMarkdownTool.ts");

module.exports = {
  agendaItemsForKi: shared.agendaItemsForKi,
  meetingNumberFromInput: shared.meetingNumberFromInput,
  copyConvertedDeliverable,
  DIRECTORY_BY_GROUP: shared.DIRECTORY_BY_GROUP,
  GROUP_BY_TDOC_PREFIX: shared.GROUP_BY_TDOC_PREFIX,
  convertMarkdown,
  downloadProposals,
  downloadOfficialTdoc,
  ensureConversionSkill: shared.ensureConversionSkill,
  latestMeeting: shared.latestMeeting,
  meetingFolderPattern: shared.meetingFolderPattern,
  meetingFolders: shared.meetingFolders,
  meetingFoldersForYear: shared.meetingFoldersForYear,
  officialPdfLinks: shared.officialPdfLinks,
  parseTdoc: shared.parseTdoc,
  primaryMeetingFolderPattern: shared.primaryMeetingFolderPattern,
  resolveMeeting,
};
