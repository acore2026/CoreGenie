/* eslint-env jest, node */
jest.mock("../../utils/prisma", () => ({
  announcements: {
    findMany: jest.fn(),
    findFirst: jest.fn(),
    create: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  },
  announcement_reads: { upsert: jest.fn(), findUniqueOrThrow: jest.fn() },
}));
const prisma = require("../../utils/prisma");
const {
  Announcement,
  validateAnnouncement,
  parseId,
} = require("../../models/announcement");
const input = {
  title: "新公告",
  content: "## 更新\n**Markdown**",
  startsAt: "2026-10-08T00:00:00Z",
  expiresAt: "2026-10-09T00:00:00Z",
};
beforeEach(() => {
  jest.resetAllMocks();
  jest.useFakeTimers().setSystemTime(new Date("2026-10-08T12:00:00Z"));
});
afterEach(() => jest.useRealTimers());

it.each([
  { title: " " },
  { content: "" },
  { title: "a".repeat(121) },
  { content: "a".repeat(20001) },
  { startsAt: "bad" },
  { startsAt: 123 },
  { expiresAt: "2026-10-08T00:00:00Z" },
  { expiresAt: "2026-10-07T00:00:00Z" },
])("rejects invalid content or display period: %j", (patch) => {
  expect(() => validateAnnouncement({ ...input, ...patch })).toThrow();
});
it("preserves Markdown and supports an unlimited end date", () => {
  expect(validateAnnouncement({ ...input, expiresAt: "" })).toEqual({
    title: input.title,
    content: input.content,
    startsAt: new Date(input.startsAt),
    expiresAt: null,
  });
});
it.each(["1oops", 0, -1, "1.5", "9007199254740993"])(
  "rejects malformed IDs: %s",
  (id) => expect(() => parseId(id)).toThrow()
);
it("keeps expired notices in the list and applies the exact expiry boundary", async () => {
  prisma.announcements.findMany.mockResolvedValue([
    {
      id: 1,
      startsAt: new Date("2026-10-08T00:00:00Z"),
      expiresAt: new Date(),
      reads: [],
    },
    {
      id: 2,
      startsAt: new Date(),
      expiresAt: null,
      reads: [{ readAt: new Date() }],
    },
  ]);
  const result = await Announcement.list(7);
  expect(result.map((r) => r.status)).toEqual(["expired", "active"]);
  expect(result[0].readAt).toBeNull();
  expect(result[1].readAt).toEqual(new Date());
  expect(prisma.announcements.findMany).toHaveBeenCalledWith(
    expect.objectContaining({
      where: { startsAt: { lte: new Date() } },
      include: {
        reads: { where: { readerKey: "user:7" }, select: { readAt: true } },
      },
    })
  );
  expect(result[0]).not.toHaveProperty("reads");
});
it("only the admin list includes scheduled notices", async () => {
  prisma.announcements.findMany.mockResolvedValue([
    { startsAt: new Date("2026-10-09T00:00:00Z"), expiresAt: null, reads: [] },
  ]);
  expect((await Announcement.list(null, { admin: true }))[0].status).toBe(
    "scheduled"
  );
  expect(prisma.announcements.findMany.mock.calls[0][0].where).toEqual({});
});
it("uses one idempotent read record per account, with a distinct single-user key", async () => {
  prisma.announcements.findFirst.mockResolvedValue({ id: 1 });
  for (const user of [7, 8, null]) await Announcement.markRead("1", user);
  expect(
    prisma.announcement_reads.upsert.mock.calls.map(
      ([args]) => args.create.readerKey
    )
  ).toEqual(["user:7", "user:8", "single-user"]);
  expect(prisma.announcement_reads.upsert.mock.calls[0][0].update).toEqual({});
});
it("does not mark missing or scheduled notices read", async () => {
  prisma.announcements.findFirst.mockResolvedValue(null);
  await expect(Announcement.markRead(1, 7)).rejects.toMatchObject({
    status: 404,
  });
  expect(prisma.announcement_reads.upsert).not.toHaveBeenCalled();
});
it("returns the existing receipt when two tabs mark an announcement read together", async () => {
  prisma.announcements.findFirst.mockResolvedValue({ id: 1 });
  prisma.announcement_reads.upsert.mockRejectedValue({ code: "P2002" });
  const receipt = { readAt: new Date() };
  prisma.announcement_reads.findUniqueOrThrow.mockResolvedValue(receipt);
  await expect(Announcement.markRead(1, 7)).resolves.toEqual(receipt);
  expect(prisma.announcement_reads.findUniqueOrThrow).toHaveBeenCalledWith({
    where: { announcementId_readerKey: { announcementId: 1, readerKey: "user:7" } },
    select: { readAt: true },
  });
});
it("editing preserves existing read receipts and ignores supplied read state", async () => {
  await Announcement.update(1, { ...input, reads: [], readAt: null });
  expect(prisma.announcements.update).toHaveBeenCalledWith({
    where: { id: 1 },
    data: validateAnnouncement(input),
  });
  expect(prisma.announcement_reads.upsert).not.toHaveBeenCalled();
});
