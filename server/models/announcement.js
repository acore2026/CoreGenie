const prisma = require("../utils/prisma");

class AnnouncementError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

function parseId(value) {
  if (!/^[1-9]\d*$/.test(String(value)) || !Number.isSafeInteger(Number(value)))
    throw new AnnouncementError("公告编号无效。");
  return Number(value);
}

function validateAnnouncement(input) {
  const title = typeof input?.title === "string" ? input.title.trim() : "";
  const content =
    typeof input?.content === "string" ? input.content.trim() : "";
  if (!title || title.length > 120)
    throw new AnnouncementError("请填写公告标题，最多 120 字。");
  if (!content || content.length > 20000)
    throw new AnnouncementError("请填写公告内容，最多 20000 字。");
  function date(value, fallback) {
    if (value === null || value === "" || value === undefined) return fallback;
    if (typeof value !== "string" || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value))
      throw new AnnouncementError("公告时间格式无效。");
    const parsed = new Date(value);
    if (!Number.isFinite(parsed.getTime()))
      throw new AnnouncementError("公告时间格式无效。");
    return parsed;
  }
  const startsAt = date(input.startsAt, new Date());
  const expiresAt = date(input.expiresAt, null);
  if (expiresAt && expiresAt <= startsAt)
    throw new AnnouncementError("结束时间必须晚于开始时间。");
  return { title, content, startsAt, expiresAt };
}

function readerKey(userId) {
  return userId == null ? "single-user" : `user:${userId}`;
}

const Announcement = {
  async list(userId, { admin = false } = {}) {
    const now = new Date();
    const rows = await prisma.announcements.findMany({
      where: admin ? {} : { startsAt: { lte: now } },
      orderBy: [{ startsAt: "desc" }, { id: "desc" }],
      include: {
        reads: {
          where: { readerKey: readerKey(userId) },
          select: { readAt: true },
        },
      },
    });
    return rows.map(({ reads, ...item }) => ({
      ...item,
      readAt: reads[0]?.readAt ?? null,
      status:
        item.startsAt > now
          ? "scheduled"
          : item.expiresAt && item.expiresAt <= now
            ? "expired"
            : "active",
    }));
  },
  async create(input) {
    return prisma.announcements.create({ data: validateAnnouncement(input) });
  },
  async update(id, input) {
    return prisma.announcements.update({
      where: { id: parseId(id) },
      data: validateAnnouncement(input),
    });
  },
  async delete(id) {
    return prisma.announcements.delete({ where: { id: parseId(id) } });
  },
  async markRead(id, userId) {
    const announcementId = parseId(id);
    const announcement = await prisma.announcements.findFirst({
      where: { id: announcementId, startsAt: { lte: new Date() } },
      select: { id: true },
    });
    if (!announcement)
      throw new AnnouncementError("公告不存在或尚未发布。", 404);
    const key = readerKey(userId);
    const where = {
      announcementId_readerKey: { announcementId, readerKey: key },
    };
    try {
      return await prisma.announcement_reads.upsert({
        where,
        create: { announcementId, readerKey: key },
        update: {},
        select: { readAt: true },
      });
    } catch (error) {
      // Another tab may create the same read receipt concurrently.
      if (error.code !== "P2002") throw error;
      return prisma.announcement_reads.findUniqueOrThrow({
        where,
        select: { readAt: true },
      });
    }
  },
};

module.exports = {
  Announcement,
  AnnouncementError,
  validateAnnouncement,
  parseId,
};
