const {
  decodeThreeCharVersion,
  encodeDottedVersion,
  parseSpecNumber,
  recognizeDocument,
  extractTdocIdsFromText,
  groupFromPrefix,
} = require("../contracts/documentIds.ts");

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
  const wgKey = groupFromPrefix(m[1].toUpperCase() + m[2]);
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
 * Normalize a TDoc identifier according to issue #4 F1 rules.
 */
function classifyDocId(rawInput) {
  if (typeof rawInput !== "string" || rawInput.length > 160) {
    throw invalid("请输入规范号、TDoc 编号、RFC 或 IETF Draft 名称。");
  }
  const doc = recognizeDocument(rawInput);
  if (doc?.kind === "tdoc") return { ...doc, wgPath: WG_PATHS[doc.wgKey] };
  if (doc) return doc;
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
