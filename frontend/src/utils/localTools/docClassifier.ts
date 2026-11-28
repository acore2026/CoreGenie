export {
  recognizeDocument,
  extractTdocIdsFromText,
} from "../../../../server/contracts/documentIds.ts";

// The server validates and normalizes the full identifier. Only choose the optional field here.
export function hintKind(input: string): "release" | "meeting" | null {
  const value = input.trim();
  if (/^(?:3GPP\s+)?(?:(?:TS|TR)\s*)?\d/i.test(value)) return "release";
  if (/^(?:S3i|[SCR][P1-6])/i.test(value)) return "meeting";
  return null;
}
