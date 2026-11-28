const WG_PATHS = Object.freeze({
  SA: "tsg_sa/TSG_SA",
  SA1: "tsg_sa/WG1_Serv",
  SA2: "tsg_sa/WG2_Arch",
  SA3: "tsg_sa/WG3_Security",
  SA4: "tsg_sa/WG4_CODEC",
  SA5: "tsg_sa/WG5_TM",
  SA6: "tsg_sa/WG6_MissionCritical",
  SA3LI: "tsg_sa/WG3_Security/TSGS3_LI",
  CT: "tsg_ct/TSG_CT",
  CT1: "tsg_ct/WG1_mm-cc-sm_ex-CN1",
  CT2: "tsg_ct/WG2_capability_ex-T2",
  CT3: "tsg_ct/WG3_interworking_ex-CN3",
  CT4: "tsg_ct/WG4_protocollars_ex-CN4",
  CT5: "tsg_ct/WG5_osa_ex-CN5",
  CT6: "tsg_ct/WG6_Smartcard_Ex-T3",
  RAN: "tsg_ran/TSG_RAN",
  RAN1: "tsg_ran/WG1_RL1",
  RAN2: "tsg_ran/WG2_RL2",
  RAN3: "tsg_ran/WG3_Iu",
  RAN4: "tsg_ran/WG4_Radio",
  RAN5: "tsg_ran/WG5_Test_ex-T1",
  RAN6: "tsg_ran/WG6_legacyRAN",
});

const ALL_WG_KEYS = Object.freeze(Object.keys(WG_PATHS));

const RELEASE_LADDER = Object.freeze([22, 21, 20, 19, 18, 17, 16, 15]);

function invalid(publicMessage, status = 400) {
  return Object.assign(new Error(publicMessage), { publicMessage, status });
}

function decodeThreeCharVersion(ver) {
  const code = String(ver || "")
    .replace(/^-/, "")
    .toLowerCase();
  if (!/^[0-9a-z]{3}$/.test(code)) return undefined;
  return [...code].map((c) => parseInt(c, 36)).join(".");
}

function encodeDottedVersion(dotted) {
  const parts = String(dotted || "")
    .trim()
    .split(".")
    .map((x) => Number(x));
  if (
    parts.length !== 3 ||
    parts.some((n) => !Number.isInteger(n) || n < 0 || n >= 36)
  )
    return null;
  return "-" + parts.map((n) => n.toString(36)).join("");
}

/**
 * Resolve WG key and 3GPP FTP sub-path from a normalized TDoc ID or WG name.
 */
function resolveWgRoute(input) {
  const raw = String(input || "").trim();
  if (!raw) return null;

  const upper = raw.toUpperCase();
  if (WG_PATHS[upper]) {
    return { wgKey: upper, wgPath: WG_PATHS[upper] };
  }
  if (upper === "SP") return { wgKey: "SA", wgPath: WG_PATHS.SA };
  if (upper === "CP") return { wgKey: "CT", wgPath: WG_PATHS.CT };
  if (upper === "RP") return { wgKey: "RAN", wgPath: WG_PATHS.RAN };

  if (/^S3i/i.test(raw)) {
    return { wgKey: "SA3LI", wgPath: WG_PATHS.SA3LI };
  }
  if (/^SP(?:-|\d)/i.test(raw)) {
    return { wgKey: "SA", wgPath: WG_PATHS.SA };
  }
  if (/^CP(?:-|\d)/i.test(raw)) {
    return { wgKey: "CT", wgPath: WG_PATHS.CT };
  }
  if (/^RP(?:-|\d)/i.test(raw)) {
    return { wgKey: "RAN", wgPath: WG_PATHS.RAN };
  }

  const m = raw.match(/^([SCR])([1-6])(?:-|\d)/i);
  if (!m) return null;
  const family =
    m[1].toUpperCase() === "S"
      ? "SA"
      : m[1].toUpperCase() === "C"
        ? "CT"
        : "RAN";
  const wgKey = `${family}${m[2]}`;
  if (!WG_PATHS[wgKey]) return null;
  return { wgKey, wgPath: WG_PATHS[wgKey] };
}

function tdocPrefixFromWgKey(wgKey) {
  if (wgKey === "SA3LI") return "S3i";
  if (wgKey === "SA") return "SP";
  if (wgKey === "CT") return "CP";
  if (wgKey === "RAN") return "RP";
  return wgKey.replace(/^SA/, "S").replace(/^CT/, "C").replace(/^RAN/, "R");
}

/**
 * Extract conference number from a 3GPP meeting directory name using
 * WG-specific patterns (issue #4 F5).
 */
function extractConferenceNumber(folderName, docPrefix = "") {
  const name = String(folderName || "").trim();
  if (!name) return null;
  const prefix = String(docPrefix || "").trim();

  let match = null;
  if (/^C6$/i.test(prefix)) {
    match = name.match(/CT6.*?['\-_][^0-9]?(\d+)/i);
  } else if (/^S3i$/i.test(prefix)) {
    match = name.match(/.*?['_][^0-9]?(\d+)/i);
  } else if (/^C4$/i.test(prefix)) {
    match = name.match(/.*?['_][^0-9]?(\d+)/i);
  } else {
    match = name.match(/TSG.*?['_][^0-9]?(\d+)/i);
  }

  if (!match) {
    // Fallback for folders like CT1_150 or C4_135 or RAN1_118
    match = name.match(/^(?:TSG)?(?:SA|CT|RAN|[SCR])[P1-6]?[_-](\d+)/i);
  }
  if (!match || !match[1]) return null;
  const num = Number(match[1]);
  return Number.isFinite(num) ? num : null;
}

/**
 * Parse a 3GPP specification number into { series, num, ver, kind, dottedVersion }.
 * Implements the verified decision table from issue #4 F3 plus ProtocolFinder forms.
 */
function parseSpecNumber(rawInput) {
  const input = String(rawInput || "").trim();
  if (!input || input.length > 100) return null;
  const match = input
    .replace(/\.(?:zip|docx?|pdf|rar)$/i, "")
    .match(
      /^(?:3GPP\s+)?(?:(TS|TR)\s*)?(\d{2})\.?(\d{3})([\da-z-]*)(?:\s+v?(\d{1,2}\.\d{1,2}\.\d{1,2}))?$/i
    );
  if (!match) return null;
  const [, type, series, item, tail, dotted] = match;
  const kind = type?.toUpperCase() || null;
  const dottedVersion = dotted?.split(".").map(Number).join(".");
  // Up to two part numbers, followed by an optional base-36 version code.
  const suffix = tail.match(/^((?:-\d{1,2}){0,2})(?:-?([\da-z]{3}))?$/i);
  let num = item;
  let ver = null;
  if (/^\d{2}$/.test(tail)) num += "-" + tail;
  else if (suffix) {
    num += suffix[1];
    if (suffix[2]) {
      let code = suffix[2].toLowerCase();
      if (/^\d{5}0\d{2}$/.test(input)) code = "i" + code.slice(1);
      ver = "-" + code;
    }
  } else return null;
  if (ver && dottedVersion) return null;
  if (!ver && dottedVersion) {
    ver = encodeDottedVersion(dottedVersion);
  }
  const requestedVersion =
    dottedVersion || (ver ? decodeThreeCharVersion(ver) : undefined);
  const specId = `${series}.${num}`;

  return {
    kind,
    series,
    num,
    ver,
    specId,
    compactId: `${series}${num}`,
    requestedVersion,
  };
}

/**
 * Normalize a TDoc identifier according to issue #4 F1 rules.
 */
function classifyDocId(rawInput) {
  if (typeof rawInput !== "string" || rawInput.length > 160) {
    throw invalid("请输入规范号、TDoc 编号、RFC 或 IETF Draft 名称。");
  }
  const input = rawInput.trim();
  const id = input
    .replace(/\.(?:zip|docx?|pdf|txt|rar)$/i, "")
    .replace(/\s+/g, "");
  if (/^draft-[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id))
    return { kind: "ietf-draft", normalizedId: id.toLowerCase() };
  const workshop = id.match(/^SWS-?([0-9a-z_-]+)$/i);
  if (workshop)
    return {
      kind: "workshop",
      normalizedId: "SWS-" + workshop[1].toUpperCase(),
    };
  const rfc = id.match(/^rfc-?(\d{1,6})$/i);
  if (rfc)
    return { kind: "rfc", normalizedId: "rfc" + rfc[1], rfcNumber: rfc[1] };
  const tdoc = id.match(/^(S3i|[SCR][P1-6])-?(\d{5,8})(r\d{1,2})?$/i);
  if (tdoc) {
    const prefix =
      tdoc[1].toLowerCase() === "s3i" ? "S3i" : tdoc[1].toUpperCase();
    const normalizedId =
      prefix +
      (prefix === "S3i" ? "" : "-") +
      tdoc[2] +
      (tdoc[3] || "").toLowerCase();
    return {
      kind: "tdoc",
      normalizedId,
      ...resolveWgRoute(normalizedId),
      docPrefix: prefix,
    };
  }
  const parsedSpec = parseSpecNumber(input);
  if (parsedSpec)
    return { kind: "spec", normalizedId: parsedSpec.specId, parsedSpec };
  throw invalid(
    "无法识别这个编号。请检查输入，例如 23.501、S2-2500105 或 RFC 2697。"
  );
}

function matchSpecFilename(files, spec) {
  const base = spec.compactId.toLowerCase() + "-";
  return (
    files
      .filter((name) => {
        const lower = name.toLowerCase();
        return (
          lower.startsWith(base) &&
          /^[0-9a-z]{3}\.zip$/.test(lower.slice(base.length)) &&
          (!spec.ver ||
            lower === spec.compactId.toLowerCase() + spec.ver + ".zip")
        );
      })
      .sort()
      .pop() || null
  );
}

function extractTdocIdsFromText(text) {
  const input = String(text || "");
  const seen = new Set();
  const result = [];
  const patterns = [
    /\bSWS-\d{5,8}\b/gi,
    /\bS3i\d{5,8}\b/gi,
    /\b(?:SP|CP|RP|[SCR][1-6])-\d{5,8}(?:r\d{1,2})?\b/gi,
    /\b(?:SP|CP|RP|[SCR][1-6])\d{7}(?:r\d{1,2})?\b/gi,
  ];
  for (const regex of patterns) {
    for (const match of input.matchAll(regex)) {
      try {
        const c = classifyDocId(match[0]);
        if (c.kind === "tdoc" || c.kind === "workshop") {
          const key = c.normalizedId.toUpperCase();
          if (!seen.has(key)) {
            seen.add(key);
            result.push(c.normalizedId);
          }
        }
      } catch {
        // Ignore false positives
      }
    }
  }
  return result;
}

module.exports = {
  WG_PATHS,
  ALL_WG_KEYS,
  RELEASE_LADDER,
  invalid,
  decodeThreeCharVersion,
  encodeDottedVersion,
  resolveWgRoute,
  tdocPrefixFromWgKey,
  extractConferenceNumber,
  parseSpecNumber,
  classifyDocId,
  matchSpecFilename,
  extractTdocIdsFromText,
};
