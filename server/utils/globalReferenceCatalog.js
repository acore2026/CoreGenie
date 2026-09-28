const { createHash, randomUUID } = require("crypto");
const prisma = require("./prisma");
const official = require("./threeGppCatalog");
const SIX_HOURS = 6 * 60 * 60 * 1000;
const MONTH = 30 * 24 * 60 * 60 * 1000;

function referenceKey(group, meetingId) {
  if (
    !official.GROUPS.includes(group) ||
    (meetingId != null &&
      (typeof meetingId !== "string" || !/^[\w. -]{1,200}$/.test(meetingId)))
  )
    throw new Error("无效的工作组或会议标识。");
  return meetingId
    ? `3gpp/agenda/${group}/${meetingId}`
    : `3gpp/meetings/${group}`;
}

function createCatalog(db = prisma, source = official, now = () => new Date()) {
  const table = db.global_reference_entries;
  async function ensure(key) {
    return table.upsert({
      where: { key },
      create: { key, nextRefreshAt: now() },
      update: {},
    });
  }

  async function read(group, meetingId) {
    const key = referenceKey(group, meetingId);
    if (meetingId) {
      const list = await table.findUnique({
        where: { key: referenceKey(group) },
      });
      if (
        !list?.payload ||
        !JSON.parse(list.payload).meetings.some((item) => item.id === meetingId)
      )
        throw new Error("该会议尚未进入共享目录，请先选择已同步的会议。");
    }
    const row = await ensure(key);
    const stale =
      !!row.lastError ||
      (row.lastSuccessAt &&
        now().getTime() > new Date(row.nextRefreshAt).getTime());
    return {
      ...(row.payload
        ? JSON.parse(row.payload)
        : {
            group,
            ...(meetingId ? { meetingId, items: [] } : { meetings: [] }),
          }),
      referenceKey: key,
      revision: row.revision,
      fetchedAt: row.lastSuccessAt?.toISOString() || null,
      nextRefreshAt: row.nextRefreshAt.toISOString(),
      stale: !!stale,
      pending: !row.payload,
      ...(!row.payload
        ? {
            warning:
              "后台正在准备这份共享资料，请稍后重新读取；也可以先手动填写。",
          }
        : stale
          ? { warning: "当前为上次成功同步的共享资料，后台会继续更新。" }
          : {}),
    };
  }

  async function refresh(row) {
    const token = randomUUID();
    const started = now();
    const claim = await table.updateMany({
      where: {
        key: row.key,
        nextRefreshAt: { lte: started },
        OR: [{ leaseUntil: null }, { leaseUntil: { lt: started } }],
      },
      data: {
        leaseToken: token,
        leaseUntil: new Date(started.getTime() + 180000),
        lastAttemptAt: started,
      },
    });
    if (!claim.count) return "skipped";
    const [, kind, group, meetingId] = row.key.split("/");
    try {
      let data;
      let interval = SIX_HOURS;
      if (kind === "meetings") data = await source.meetings(group);
      else {
        const list = await table.findUnique({
          where: { key: referenceKey(group) },
        });
        const meeting =
          list?.payload &&
          JSON.parse(list.payload).meetings.find(
            (item) => item.id === meetingId
          );
        if (!meeting)
          throw new Error("Meeting is no longer in the shared catalog.");
        data = await source.agenda(group, meetingId, { meeting });
        if (meeting.year && meeting.year < started.getUTCFullYear())
          interval = MONTH;
      }
      if (data.stale) throw new Error("Official source returned stale data.");
      const { fetchedAt: _fetched, stale: _stale, ...payload } = data;
      if (kind === "meetings" && !payload.meetings?.length)
        throw new Error("Official meeting list is empty.");
      // An unexpectedly empty agenda must not replace previously useful content.
      if (
        row.payload &&
        kind === "agenda" &&
        !payload.items?.length &&
        JSON.parse(row.payload).items?.length
      )
        throw new Error("Official agenda is temporarily empty.");
      const encoded = JSON.stringify(payload);
      const revision = createHash("sha256").update(encoded).digest("hex");
      const saved = await table.updateMany({
        where: { key: row.key, leaseToken: token },
        data: {
          payload: encoded,
          revision,
          lastSuccessAt: now(),
          nextRefreshAt: new Date(now().getTime() + interval),
          lastError: null,
          leaseToken: null,
          leaseUntil: null,
        },
      });
      if (!saved.count) return "skipped";
      if (kind === "meetings") {
        // Warm recent and upcoming published folders, not all historical agendas.
        const month = `${started.getUTCFullYear()}-${String(started.getUTCMonth() + 1).padStart(2, "0")}`;
        const dated = data.meetings.filter((item) => item.date);
        const recent = dated
          .filter((item) => item.date.slice(0, 7) <= month)
          .slice(-2);
        const upcoming = dated
          .filter((item) => item.date.slice(0, 7) > month)
          .slice(0, 2);
        const selected =
          recent.length || upcoming.length
            ? [...recent, ...upcoming]
            : data.meetings.slice(-2);
        for (const meeting of selected)
          await ensure(referenceKey(group, meeting.id));
      }
      return "updated";
    } catch (error) {
      await table.updateMany({
        where: { key: row.key, leaseToken: token },
        data: {
          lastError: String(error.message).slice(0, 1000),
          nextRefreshAt: new Date(now().getTime() + 15 * 60 * 1000),
          leaseToken: null,
          leaseUntil: null,
        },
      });
      return "retry";
    }
  }

  async function sync() {
    for (const group of source.GROUPS) await ensure(referenceKey(group));
    const rows = await table.findMany({
      where: { nextRefreshAt: { lte: now() } },
      orderBy: { nextRefreshAt: "asc" },
      take: 36,
    });
    const result = { updated: 0, skipped: 0, retry: 0 };
    // Two concurrent requests at most; DB leases also protect multi-instance deployments.
    for (let i = 0; i < rows.length; i += 2) {
      const batch = await Promise.all(rows.slice(i, i + 2).map(refresh));
      for (const status of batch) result[status]++;
    }
    return result;
  }
  return { read, sync, refresh };
}

module.exports = { createCatalog, referenceKey };
