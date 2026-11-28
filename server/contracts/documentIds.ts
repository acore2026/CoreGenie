export function decodeThreeCharVersion(ver: string) {
  const code = String(ver || "")
    .replace(/^-/, "")
    .toLowerCase();
  if (!/^[0-9a-z]{3}$/.test(code)) return undefined;
  return [...code].map((c) => parseInt(c, 36)).join(".");
}

export function encodeDottedVersion(dotted: string) {
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
 * Parse a 3GPP specification number into { series, num, ver, kind, dottedVersion }.
 * Implements the verified decision table from issue #4 F3 plus ProtocolFinder forms.
 */
export function parseSpecNumber(rawInput: string) {
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

export function groupFromPrefix(prefix: string) {
  if (prefix === "S3i") return "SA3LI";
  const family = prefix[0] === "S" ? "SA" : prefix[0] === "R" ? "RAN" : "CT";
  return prefix[1] === "P" ? family : family + prefix[1];
}

export function recognizeDocument(rawInput: string) {
  if (rawInput.length > 160) return null;
  const input = rawInput.trim();
  const id = input
    .replace(/\.(?:zip|docx?|pdf|txt|rar)$/i, "")
    .replace(/\s+/g, "");
  if (/^draft-[a-z0-9]+(?:-[a-z0-9]+)*$/i.test(id))
    return { kind: "ietf-draft" as const, normalizedId: id.toLowerCase() };
  const workshop = id.match(/^SWS-?([0-9a-z_-]+)$/i);
  if (workshop)
    return {
      kind: "workshop" as const,
      normalizedId: "SWS-" + workshop[1].toUpperCase(),
    };
  const rfc = id.match(/^rfc-?(\d{1,6})$/i);
  if (rfc)
    return {
      kind: "rfc" as const,
      normalizedId: "rfc" + rfc[1],
      rfcNumber: rfc[1],
    };
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
      kind: "tdoc" as const,
      normalizedId,
      wgKey: groupFromPrefix(prefix),
      docPrefix: prefix,
    };
  }
  const parsedSpec = parseSpecNumber(input);
  if (parsedSpec)
    return {
      kind: "spec" as const,
      normalizedId: parsedSpec.specId,
      parsedSpec,
    };
  return null;
}

export function extractTdocIdsFromText(text: string): string[] {
  // Keep the order in the message, including when compact and hyphenated IDs are mixed.
  const candidates =
    /(?<![a-z0-9])(?:SWS-?\d{5,8}|(?:S3i|[SCR][P1-6])-?\d{5,8}(?:r\d{1,2})?)(?![a-z0-9])/gi;
  const ids = new Set<string>();
  for (const [candidate] of text.matchAll(candidates)) {
    const doc = recognizeDocument(candidate);
    if (doc) ids.add(doc.normalizedId);
  }
  return [...ids];
}
