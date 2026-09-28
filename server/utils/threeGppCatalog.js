const { load } = require("cheerio");

const GROUPS = [
  "SA",
  "SA1",
  "SA2",
  "SA3",
  "SA4",
  "SA5",
  "SA6",
  "RAN",
  "RAN1",
  "RAN2",
  "RAN3",
  "RAN4",
  "RAN5",
  "CT",
  "CT1",
  "CT3",
  "CT4",
  "CT6",
];
const ORIGIN = "https://www.3gpp.org";
const TTL = 60 * 60 * 1000;
const MAX_BYTES = 8 * 1024 * 1024;
const cache = new Map();
const pending = new Map();
const clean = (value) =>
  String(value || "")
    .replace(/\s+/g, " ")
    .trim();

function officialUrl(value, base = `${ORIGIN}/ftp/`) {
  const url = new URL(value, base);
  if (
    url.origin !== ORIGIN ||
    !url.pathname.startsWith("/ftp/") ||
    url.username ||
    url.password
  )
    throw new Error("只允许读取 3GPP 官方资料目录。");
  url.hash = "";
  return url;
}

async function readOfficial(
  value,
  redirects = 0,
  signal = AbortSignal.timeout(15000)
) {
  const url = officialUrl(value);
  const response = await fetch(url, {
    redirect: "manual",
    signal,
    headers: { "User-Agent": "AnythingLLM-Agent/1.0", Accept: "text/html" },
  });
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    await response.body?.cancel();
    if (redirects >= 3 || !response.headers.get("location"))
      throw new Error("官方资料地址重定向过多。");
    return readOfficial(
      officialUrl(response.headers.get("location"), url).href,
      redirects + 1,
      signal
    );
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(`3GPP 官方网站返回 HTTP ${response.status}。`);
  }
  if (Number(response.headers.get("content-length")) > MAX_BYTES) {
    await response.body?.cancel();
    throw new Error("官方目录或议程超过读取大小限制。");
  }
  let size = 0;
  const chunks = [];
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > MAX_BYTES) throw new Error("官方目录或议程超过读取大小限制。");
    chunks.push(Buffer.from(chunk));
  }
  const html = Buffer.concat(chunks).toString("utf8");
  if (
    !/<(?:html|table|a|p|div)\b/i.test(html) ||
    /<title>[^<]*(?:access denied|authentication|blocked|sign in)/i.test(html)
  )
    throw new Error("官方资料暂时无法读取，请稍后重试或手动填写。");
  return html;
}

async function cached(key, loader) {
  const prior = cache.get(key);
  if (prior && prior.expires > Date.now()) {
    if (prior.error) throw new Error(prior.error);
    return prior.value;
  }
  if (pending.has(key)) return pending.get(key);
  if (pending.size >= 12) throw new Error("正在读取其他会议资料，请稍后重试。");
  const promise = (async () => {
    try {
      const value = {
        ...(await loader()),
        fetchedAt: new Date().toISOString(),
        stale: false,
      };
      cache.set(key, { value, expires: Date.now() + TTL });
      return value;
    } catch (error) {
      if (prior?.value) {
        const value = {
          ...prior.value,
          stale: true,
          warning: "官方资料暂时无法刷新，当前显示上次读取的内容。",
        };
        cache.set(key, { value, expires: Date.now() + 30000 });
        return value;
      }
      cache.set(key, { error: error.message, expires: Date.now() + 30000 });
      throw error;
    } finally {
      pending.delete(key);
      while (cache.size > 128) cache.delete(cache.keys().next().value);
    }
  })();
  pending.set(key, promise);
  return promise;
}

function links(html, base) {
  const $ = load(html);
  const result = new Map();
  $("a[href]").each((_, el) => {
    try {
      const url = officialUrl($(el).attr("href"), base);
      url.search = "";
      const parent = new URL(base).pathname.replace(/\/$/, "") + "/";
      if (!url.pathname.toLowerCase().startsWith(parent.toLowerCase())) return;
      const tail = decodeURIComponent(
        url.pathname.slice(parent.length)
      ).replace(/\/$/, "");
      if (!tail || tail.includes("/")) return;
      result.set(url.href, {
        url: url.href,
        name: tail,
        text: clean($(el).text()),
      });
    } catch {
      /* Ignore navigation and off-site links. */
    }
  });
  return [...result.values()];
}

function parseMeetings(html, base, group) {
  const prefix = group
    .replace(/^SA/, "S")
    .replace(/^RAN/, "R")
    .replace(/^CT/, "C");
  const folderPrefix = group.startsWith("CT")
    ? `(?:TSG${prefix}|TSG${group}|${group})`
    : `TSG${prefix}`;
  const pattern = new RegExp(
    `^${folderPrefix}[_-](\\d+)([a-z]*)(?:[_-]|$)`,
    "i"
  );
  return links(html, base)
    .flatMap((link) => {
      const match = link.name.match(pattern);
      if (!match) return [];
      // Directory modification time is NOT a meeting date.
      const date = link.name.match(
        /[_-](20\d{2})-(0[1-9]|1[0-2])(?:-([0-3]\d))?(?:$|_)/
      );
      const id = link.name;
      const dateText = date
        ? `${date[1]}-${date[2]}${date[3] ? `-${date[3]}` : ""}`
        : null;
      return [
        {
          id,
          number: Number(match[1]),
          suffix: match[2],
          year: date ? Number(date[1]) : null,
          date: dateText,
          label: `${group}#${match[1]}${match[2]} · ${link.name.replace(pattern, "").replace(/_/g, " ")}`,
          source: link.url.replace(/\/$/, "") + "/",
        },
      ];
    })
    .sort((a, b) => a.number - b.number || a.suffix.localeCompare(b.suffix));
}

async function meetings(group) {
  if (!GROUPS.includes(group)) throw new Error("请选择有效的工作组。");
  return cached(`meetings:${group}`, async () => {
    const family = group.match(/^(SA|RAN|CT)/)[1];
    const base = `${ORIGIN}/ftp/tsg_${family.toLowerCase()}/`;
    const number = group.slice(family.length);
    const pattern = number
      ? new RegExp(`^WG${number}(?:_|$)`, "i")
      : new RegExp(`^TSG_${family}$`, "i");
    const dirs = links(await readOfficial(`${base}?sortby=name`), base).filter(
      (link) => pattern.test(link.name)
    );
    if (dirs.length !== 1)
      throw new Error("未能确定这个工作组的官方资料目录，可先手动填写。");
    const source = dirs[0].url.replace(/\/$/, "") + "/";
    const entries = parseMeetings(
      await readOfficial(`${source}?sortby=name`),
      source,
      group
    );
    if (!entries.length)
      throw new Error("官方目录未返回可识别的会议列表，可先手动填写。");
    return { group, source, meetings: entries };
  });
}

function parseAgenda(html, source) {
  const $ = load(html);
  $("script, style").remove();
  const entries = new Map();
  const kiReferences = new Map();
  const add = (number, title) => {
    title = clean(title);
    if (
      !/^\d+(?:\.\d+)*\.?$/.test(number) ||
      !title ||
      title === "-" ||
      title.length > 1200
    )
      return;
    number = number.replace(/\.$/, "");
    if (!entries.has(number))
      entries.set(number, {
        value: number,
        title,
        label: `${number} · ${title}`,
        source,
      });
  };
  $("tr").each((_, row) => {
    const cells = $(row)
      .children("td,th")
      .map((_, el) => clean($(el).text()))
      .get();
    if (!cells.length) return;
    // TdocsByAgenda rows: item, TDoc, type, purpose, TITLE. Never treat a TDoc title as a KI definition.
    if (cells.length >= 6) {
      if (cells[1] === "-" && cells[2] === "-") add(cells[0], cells[4]);
      else if (
        /^[SCR][\w]*-\d+/i.test(cells[1]) &&
        /^\d+(?:\.\d+)*$/.test(cells[0])
      ) {
        for (const match of cells[4].matchAll(
          /\b(?:KI|Key\s+Issue)\s*#?\s*(\d+)\b/gi
        )) {
          const value = `ki:${cells[0]}:${match[1]}`;
          if (!kiReferences.has(value))
            kiReferences.set(value, {
              value,
              agendaItem: cells[0],
              label: `KI#${match[1]} · ${cells[0]}（提案标题标记）`,
              source,
              isKeyIssue: true,
              referenceTdoc: cells[1],
              referenceTitle: cells[4],
            });
        }
      }
      return;
    }
    if (cells.length >= 2) add(cells[0], cells[1]);
  });
  if (!entries.size) {
    $("p,h1,h2,h3,h4,h5,li").each((_, el) => {
      const text = clean($(el).text());
      const match = text.match(/^(\d+(?:\.\d+)*\.?)\s+(.+)$/);
      if (match) add(match[1], match[2]);
    });
  }
  const items = [...entries.values()];
  const headings = items.map((item) => {
    const parents = item.value
      .split(".")
      .slice(0, -1)
      .map((_, i, parts) => entries.get(parts.slice(0, i + 1).join("."))?.title)
      .filter(Boolean);
    return {
      ...item,
      description: parents.join(" / "),
      isKeyIssue: /\b(?:KI\s*#?\s*\d+|Key\s+Issues?\b)/i.test(item.title),
    };
  });
  return [...kiReferences.values()]
    .map((item) => ({
      ...item,
      description: `${entries.get(item.agendaItem)?.title || item.agendaItem} / ${item.referenceTdoc}：${item.referenceTitle}（并非 KI 正式定义）`,
    }))
    .concat(headings);
}

async function agenda(group, meetingId, { meeting: snapshotMeeting } = {}) {
  const meeting =
    snapshotMeeting ||
    (await meetings(group)).meetings.find((item) => item.id === meetingId);
  if (!meeting) throw new Error("该会议不在官方列表中，请重新选择。");
  return cached(`agenda:${group}:${meetingId}`, async () => {
    let candidates = links(
      await readOfficial(`${meeting.source}?sortby=name`),
      meeting.source
    );
    let htmlLinks = candidates.filter((link) =>
      /(?:agenda|tdocsbyagenda).*\.html?$/i.test(link.name)
    );
    if (!htmlLinks.length) {
      const folder = candidates.find((link) => /^agenda$/i.test(link.name));
      if (folder) {
        const base = folder.url.replace(/\/$/, "") + "/";
        candidates = links(await readOfficial(`${base}?sortby=name`), base);
        htmlLinks = candidates.filter((link) => /\.html?$/i.test(link.name));
      }
    }
    htmlLinks.sort(
      (a, b) =>
        Number(/tdocsbyagenda/i.test(b.name)) -
          Number(/tdocsbyagenda/i.test(a.name)) ||
        b.name.localeCompare(a.name, "en", { numeric: true })
    );
    for (const link of htmlLinks.slice(0, 3)) {
      const items = parseAgenda(await readOfficial(link.url), link.url);
      if (items.length)
        return {
          group,
          meetingId,
          source: link.url,
          items: items.slice(0, 1000),
        };
    }
    return {
      group,
      meetingId,
      source: meeting.source,
      items: [],
      warning:
        "暂未找到可解析的 HTML 议程。议程可能尚未发布，或仅提供 Word/PDF；可以手动填写 KI 或议程项。",
    };
  });
}

module.exports = {
  GROUPS,
  meetings,
  agenda,
  parseMeetings,
  parseAgenda,
  officialUrl,
  readOfficial,
  cache,
};
